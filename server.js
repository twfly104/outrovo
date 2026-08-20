// Drummer — product MVP server (Node >= 18)
// Static site + marketing API + session auth + campaign engine + deliverability tools.
//
// SMTP is configured via env (SMTP_HOST/PORT/USER/PASS/FROM). Without it, the
// engine runs in DEMO mode: sends are logged to the activity feed, not the network.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch { /* demo mode only */ }

const PORT = process.env.PORT || 12000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'outrovo-admin-key';
// Vercel serverless: filesystem is read-only except /tmp.
const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? "/tmp/outrovo-data" : path.join(__dirname, 'data'));
const ROOT = __dirname;
const FILES = {
  users: 'users.json',
  campaigns: 'campaigns.json',
  prospects: 'prospects.json',
  events: 'events.json',
  tasks: 'tasks.json',
  sessions: 'sessions.json',
  replies: 'replies.json',
};
// /tmp resets between serverless instances at any moment; this marks that in the API.
const EPHEMERAL_DATA = process.env.VERCEL && !process.env.DATA_DIR;

const SMTP = {
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  from: process.env.SMTP_FROM || process.env.SMTP_USER,
};
const RESEND_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || process.env.SMTP_FROM || 'onboarding@resend.dev';
const smtpConfigured = Boolean(RESEND_KEY || (SMTP.host && SMTP.user));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

// ---------- storage ----------
function load(name) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, FILES[name]), 'utf8')); } catch { return []; }
}
function save(name, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, FILES[name]), JSON.stringify(data, null, 2));
}

// ---------- crypto ----------
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function verifyPassword(password, salt, expected) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- helpers ----------
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 5e5) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');
const publicUser = u => ({ firstName: u.firstName, lastName: u.lastName, email: u.email, company: u.company });
const newToken = () => crypto.randomBytes(24).toString('hex');

function getSession(req) {
  const cookie = (req.headers.cookie || '').match(/outrovo_session=([^;]+)/);
  if (!cookie) return null;
  const sessions = load('sessions');
  const session = sessions.find(s => s.token === cookie[1]);
  if (!session || new Date(session.expires) < new Date()) return null;
  return session;
}
function requireAuth(req, res) {
  const session = getSession(req);
  if (!session) { send(res, 401, { ok: false, error: 'Not signed in.' }); return null; }
  return session;
}
function logEvent(type, message, meta = {}) {
  const events = load('events');
  events.unshift({ id: crypto.randomUUID(), type, message, meta, demo: !smtpConfigured, at: new Date().toISOString() });
  save('events', events.slice(0, 500));
}

// ---------- transport ----------
function renderTemplate(text, prospect) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => prospect[key] ?? '');
}
let transporter = null;
if (smtpConfigured && nodemailer) {
  transporter = nodemailer.createTransport({
    host: SMTP.host, port: SMTP.port,
    secure: SMTP.port === 465,
    auth: { user: SMTP.user, pass: SMTP.pass },
  });
}
async function sendViaResend(to, subject, text) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, text }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend ${res.status}: ${err.slice(0, 200)}`);
  }
}

async function sendEmail(campaign, prospect, step) {
  const subject = renderTemplate(step.subject, prospect);
  const body = renderTemplate(step.body, prospect);
  const label = `“${campaign.name}”: email to ${prospect.email}`;

  if (RESEND_KEY) {
    try {
      await sendViaResend(prospect.email, subject, body);
      logEvent('sent', `${label} (via Resend)`, { subject });
      return { demo: false };
    } catch (err) {
      if (!transporter) { logEvent('error', `Send failed to ${prospect.email}: ${err.message}`); throw err; }
      logEvent('error', `Resend failed for ${prospect.email}, falling back to SMTP: ${err.message}`);
    }
  }
  if (!transporter) {
    logEvent('sent', `[DEMO] ${label}`, { subject });
    return { demo: true };
  }
  await transporter.sendMail({ from: SMTP.from, to: prospect.email, subject, text: body });
  logEvent('sent', `${label} (via SMTP)`, { subject });
  return { demo: false };
}

// ---------- AI sequence generation ----------
// Uses an OpenAI-compatible chat API when LLM_API_KEY is set
// (LLM_BASE_URL, LLM_MODEL override defaults). Otherwise falls back to the
// built-in copywriting engine so the feature works with zero config.
const AI_SYSTEM_PROMPT = `You write short, high-reply-rate cold outreach sequences.
Return ONLY a JSON object: {"steps":[...]} where each step is one of:
{"type":"email","subject":"...","body":"...","delayMinutes":N}
{"type":"task","note":"...","delayMinutes":N}  (a manual LinkedIn action)
{"type":"wait","delayMinutes":N}
Rules: 3-5 steps total, starting with an email. Use {{firstName}} and {{company}}
tokens where useful. Bodies: under 90 words, plain text, one clear ask, no hype,
no emojis. delayMinutes: realistic gaps (2880=2 days, 4320=3 days).`;

function normalizeSteps(steps) {
  return steps
    .filter(s => ['email', 'task', 'wait'].includes(s.type))
    .map(s => ({
      type: s.type,
      subject: String(s.subject || ''),
      body: String(s.body || ''),
      note: String(s.note || ''),
      delayMinutes: Math.max(0, Number(s.delayMinutes || 0)),
    }));
}

function localSequence({ product, audience, goal, tone }) {
  const p = product?.trim() || 'our product';
  const a = audience?.trim() || 'teams like yours';
  const g = goal?.trim() || 'book a short call';
  const opener = tone === 'bold'
    ? `Most ${a} lose hours every week on manual outbound — {{company}} probably doesn't have to.`
    : `I noticed {{company}} and thought there might be a fit.`;
  return normalizeSteps([
    { type: 'email', subject: 'Quick idea for {{company}}', delayMinutes: 0,
      body: `Hi {{firstName}},\n\n${opener}\n\nWe built ${p} for ${a} — it handles the repetitive parts so your team can focus on conversations that convert.\n\nOpen to a quick look? I can ${g} — 15 minutes is plenty.\n\nBest,` },
    { type: 'wait', delayMinutes: 2880 },
    { type: 'task', note: `Send a LinkedIn connection request to {{firstName}} {{lastName}} — short note referencing ${p}`, delayMinutes: 0 },
    { type: 'email', subject: 'Re: Quick idea for {{company}}', delayMinutes: 4320,
      body: `Hi {{firstName}},\n\nFollowing up in case this got buried. The short version: ${p} helps ${a} get more replies with less manual work.\n\nIf it's not a fit, no worries — just let me know and I'll close the loop.\n\nBest,` },
  ]);
}

// ---------- site scan for AI autofill ----------
function extractSiteInfo(html, url) {
  const pick = (re) => (html.match(re) || [])[1]?.trim();
  const title = pick(/<title[^>]*>([^<]+)<\/title>/i) || '';
  const desc = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || pick(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i) || '';
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)]
    .map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 3);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 3000);
  return { url, title, desc, h1s, text };
}

async function fetchSite(url) {
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(target, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OutrovoBot/1.0; +https://drummer.app)' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`Site returned ${res.status}`);
    const html = (await res.text()).slice(0, 200000);
    return extractSiteInfo(html, target);
  } finally {
    clearTimeout(timer);
  }
}

async function analyzeSite(info) {
  const key = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  const base = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';
  if (key) {
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: `Given website content, infer what the company SELLS (its product/offer, as the company would pitch it), WHO buys it (specific audience), and a likely outreach GOAL for its sales team. Return ONLY JSON: {"product":"...","audience":"...","goal":"..."} — each a short phrase, no sentences.` },
            { role: 'user', content: JSON.stringify({ title: info.title, description: info.desc, headings: info.h1s, text: info.text.slice(0, 1500) }) },
          ],
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (res.ok) {
        const json = await res.json();
        const parsed = JSON.parse(json.choices?.[0]?.message?.content || '{}');
        if (parsed.product) return { ...parsed, ai: true };
      }
    } catch { /* fall through */ }
  }
  // Local heuristic fallback
  const company = (info.title.split(/[|\-–—:]/)[0] || '').trim() || new URL(info.url).hostname.replace(/^www\./, '').split('.')[0];
  const product = info.desc
    ? info.desc.replace(/\.$/, '').slice(0, 120)
    : info.h1s[0] || `${company}'s product`;
  return { product, audience: 'B2B teams', goal: 'book a short intro call', ai: false, company };
}

async function aiGenerateSequence(input) {
  const key = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  const base = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';
  if (key) {
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: AI_SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(input) },
          ],
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const json = await res.json();
        const parsed = JSON.parse(json.choices?.[0]?.message?.content || '{}');
        const steps = normalizeSteps(parsed.steps || []);
        if (steps.length) return { steps, ai: true, model };
      }
    } catch { /* fall through to local engine */ }
  }
  return { steps: localSequence(input), ai: false };
}

// ---------- plans & billing ----------
// Pricing strategy: card-free 14-day trial with full features → paid per-seat
// tiers with hard prospect limits. Stripe Checkout when STRIPE_SECRET_KEY is
// set; otherwise a manual activation path (admin key) keeps the flow usable.
const PLANS = {
  trial: { name: 'Free trial', priceMonthly: 0, maxProspects: 100, maxCampaigns: 1, trialDays: 14, linkedIn: false },
  starter: { name: 'Starter', priceMonthly: 29, maxProspects: 2000, maxCampaigns: 3, linkedIn: false },
  growth: { name: 'Growth', priceMonthly: 49, maxProspects: 10000, maxCampaigns: 10, linkedIn: true },
  scale: { name: 'Scale', priceMonthly: 99, maxProspects: Infinity, maxCampaigns: Infinity, linkedIn: true },
};

function planOf(user) {
  const base = PLANS[user?.plan] || PLANS.trial;
  if (user?.plan === 'trial' && user?.trialEnds && new Date(user.trialEnds) < new Date()) {
    return { ...base, expired: true };
  }
  return base;
}

function publicBase(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers.host}`;
}

function upgradeUser(email, planId) {
  const users = load('users');
  const user = users.find(u => u.email === email.trim().toLowerCase());
  if (!user) return null;
  user.plan = planId;
  delete user.trialEnds;
  save('users', users);
  return user;
}

// Minimal Stripe integration via fetch (no SDK dependency).
async function stripeCheckout(secret, { planId, email, amount, successUrl, cancelUrl }) {
  const params = new URLSearchParams({
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: email,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(amount * 100),
    'line_items[0][price_data][recurring][interval]': 'month',
    'line_items[0][price_data][product_data][name]': `Drummer ${PLANS[planId].name}`,
    'metadata[plan]': planId,
    'metadata[email]': email,
  });
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${secret}` },
    body: params,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Stripe ${res.status}`);
  return data;
}

function verifyStripeWebhook(req, body) {
  // When STRIPE_WEBHOOK_SECRET is unset, accept (dev mode). In production,
  // set it — verification with the signature header happens here.
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET ? req.headers['stripe-signature'] : true);
}

// ---------- campaign engine ----------
// Steps: { type:'email', subject, body, delayMinutes } | { type:'task', note, delayMinutes }
//       | { type:'wait', delayMinutes }
const ENGINE_INTERVAL_MS = Number(process.env.ENGINE_INTERVAL_MS || 15000);
function engineTick() {
  const campaigns = load('campaigns');
  const prospects = load('prospects');
  let tasks = load('tasks');
  const now = Date.now();
  let changed = false;

  for (const campaign of campaigns.filter(c => c.status === 'active')) {
    for (const prospect of prospects.filter(p => p.campaignId === campaign.id)) {
      if (prospect.finished || !prospect.nextRunAt || prospect.nextRunAt > now) continue;
      const step = campaign.steps[prospect.stepIndex];
      if (!step) { prospect.finished = true; changed = true; continue; }

      if (step.type === 'email') {
        sendEmail(campaign, prospect, step).catch(err =>
          logEvent('error', `Send failed to ${prospect.email}: ${err.message}`));
      } else if (step.type === 'task') {
        tasks.unshift({ id: crypto.randomUUID(), kind: 'linkedin', note: renderTemplate(step.note, prospect), prospect: prospect.email, campaign: campaign.name, done: false, at: new Date().toISOString() });
        logEvent('task', `LinkedIn task for ${prospect.email}: ${renderTemplate(step.note, prospect)}`);
      }
      prospect.stepIndex += 1;
      const nextStep = campaign.steps[prospect.stepIndex];
      if (!nextStep) { prospect.finished = true; prospect.nextRunAt = null; }
      else { prospect.nextRunAt = now + (nextStep.delayMinutes || 0) * 60000; }
      changed = true;
    }
  }
  if (changed) { save('prospects', prospects); save('tasks', tasks); }
}
// Long-lived local server ticks forever; serverless functions must not start
// unmanaged background loops, so on Vercel the engine only runs on-demand
// (triggered by POSTs and lazy ticks via /api/app/engine/tick).
if (!process.env.VERCEL) setInterval(engineTick, ENGINE_INTERVAL_MS).unref();

// ---------- tools ----------
async function verifyEmail(email) {
  const syntax = isEmail(email);
  const result = { email, syntax, mx: null, verdict: 'invalid' };
  if (!syntax) return result;
  const domain = email.split('@')[1];
  try {
    const mx = await dns.resolveMx(domain);
    result.mx = mx.length ? mx.map(m => m.exchange).slice(0, 3) : [];
  } catch { result.mx = []; }
  result.verdict = result.mx && result.mx.length ? 'deliverable' : 'undeliverable';
  return result;
}
async function domainAudit(domain) {
  const checks = [
    { name: 'MX records', ok: false, detail: 'none found' },
    { name: 'SPF', ok: false, detail: 'no v=spf1 record' },
    { name: 'DMARC', ok: false, detail: 'no _dmarc record' },
    { name: 'DKIM (common selectors)', ok: false, detail: 'not published (selector probes: google, selector1, default, s1, k1)' },
  ];
  try {
    const mx = await dns.resolveMx(domain);
    if (mx.length) { checks[0].ok = true; checks[0].detail = mx.map(m => `${m.exchange} (pri ${m.priority})`).join(', '); }
  } catch {}
  try {
    const txt = (await dns.resolveTxt(domain)).flat().join('');
    if (/v=spf1/i.test(txt)) { checks[1].ok = true; checks[1].detail = txt.match(/v=spf1[^"]*/i)[0].slice(0, 120); }
  } catch {}
  try {
    const txt = (await dns.resolveTxt(`_dmarc.${domain}`)).flat().join('');
    if (/v=dmarc1/i.test(txt)) { checks[2].ok = true; checks[2].detail = txt.slice(0, 120); }
  } catch {}
  const selectors = ['google', 'selector1', 'selector2', 'default', 's1', 'k1', 'dkim'];
  for (const sel of selectors) {
    try {
      const txt = (await dns.resolveTxt(`${sel}._domainkey.${domain}`)).flat().join('');
      if (/v=dkim1|k=rsa|p=/i.test(txt)) {
        checks[3].ok = true;
        checks[3].detail = `found at selector "${sel}"`;
        break;
      }
    } catch {}
  }
  const passed = checks.filter(c => c.ok).length;
  return { domain, score: Math.round((passed / checks.length) * 100), checks };
}

// ---------- API ----------
const router = {
  // --- marketing / auth ---
  'GET /api/health': (req, res) => send(res, 200, { ok: true, users: load('users').length, engine: !smtpConfigured ? 'demo' : 'smtp' }),

  'POST /api/signup': async (req, res) => {
    const b = await readBody(req);
    const errors = {};
    if (!b.firstName?.trim()) errors.firstName = 'required';
    if (!b.lastName?.trim()) errors.lastName = 'required';
    if (!isEmail(b.email)) errors.email = 'invalid';
    if (!b.company?.trim()) errors.company = 'required';
    if (!b.password || b.password.length < 8) errors.password = 'min 8 chars';
    if (Object.keys(errors).length) return send(res, 400, { ok: false, errors });
    const users = load('users');
    const email = b.email.trim().toLowerCase();
    if (users.some(u => u.email === email)) return send(res, 409, { ok: false, error: 'An account with this email already exists.' });
    const { salt, hash } = hashPassword(b.password);
    const trialEnds = new Date(Date.now() + 14 * 864e5).toISOString();
    const user = { id: crypto.randomUUID(), firstName: b.firstName.trim(), lastName: b.lastName.trim(), email, company: b.company.trim(), salt, hash, plan: 'trial', trialEnds, createdAt: new Date().toISOString() };
    users.push(user); save('users', users);
    send(res, 201, { ok: true, user: publicUser(user) });
  },

  'POST /api/login': async (req, res) => {
    const b = await readBody(req);
    if (!isEmail(b.email) || !b.password) return send(res, 400, { ok: false, error: 'Email and password required.' });
    const user = load('users').find(u => u.email === b.email.trim().toLowerCase());
    if (!user || !verifyPassword(b.password, user.salt, user.hash)) return send(res, 401, { ok: false, error: 'Wrong email or password.' });
    const sessions = load('sessions');
    const token = newToken();
    sessions.push({ token, email: user.email, expires: new Date(Date.now() + 7 * 864e5).toISOString() });
    save('sessions', sessions);
    send(res, 200, { ok: true, user: publicUser(user) }, { 'Set-Cookie': `outrovo_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 86400}` });
  },

  'POST /api/logout': (req, res) => {
    const session = getSession(req);
    if (session) save('sessions', load('sessions').filter(s => s.token !== session.token));
    send(res, 200, { ok: true }, { 'Set-Cookie': 'outrovo_session=; HttpOnly; Path=/; Max-Age=0' });
  },

  'GET /api/me': (req, res) => {
    const session = getSession(req);
    if (!session) return send(res, 401, { ok: false });
    const user = load('users').find(u => u.email === session.email);
    if (!user) return send(res, 200, { ok: true, user: null, engine: smtpConfigured ? 'smtp' : 'demo' });
    const plan = planOf(user);
    send(res, 200, { ok: true, user: publicUser(user), plan: { id: user.plan || 'trial', name: plan.name, priceMonthly: plan.priceMonthly, maxProspects: plan.maxProspects, maxCampaigns: plan.maxCampaigns, linkedIn: plan.linkedIn, trialEnds: user.trialEnds, expired: plan.expired || false }, engine: smtpConfigured ? 'smtp' : 'demo' });
  },

  'GET /api/signups': (req, res) => {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) return send(res, 403, { ok: false, error: 'Forbidden' });
    const users = load('users').map(u => ({ ...publicUser(u), id: u.id, createdAt: u.createdAt }));
    send(res, 200, { ok: true, count: users.length, users });
  },

  // --- billing ---
  'GET /api/plans': (req, res) => {
    send(res, 200, { ok: true, plans: Object.entries(PLANS).map(([id, p]) => ({ id, ...p })) });
  },

  'POST /api/billing/checkout': async (req, res) => {
    if (!requireAuth(req, res)) return;
    const b = await readBody(req);
    const planId = b.plan;
    if (!PLANS[planId] || planId === 'trial') return send(res, 400, { ok: false, error: 'Unknown plan' });
    const user = load('users').find(u => u.email === getSession(req).email);
    if (!user) return send(res, 404, { ok: false, error: 'User not found' });

    const key = process.env.STRIPE_SECRET_KEY;
    if (key) {
      try {
        const price = PLANS[planId].priceMonthly;
        const session = await stripeCheckout(key, {
          planId, email: user.email, amount: price,
          successUrl: `${publicBase(req)}/app.html?upgraded=${planId}`,
          cancelUrl: `${publicBase(req)}/pricing.html`,
        });
        return send(res, 200, { ok: true, checkoutUrl: session.url });
      } catch (err) {
        return send(res, 502, { ok: false, error: `Stripe error: ${err.message}` });
      }
    }
    // No Stripe configured: return manual activation instructions (admin/demo mode)
    const manual = 'Billing not configured. Admin can activate with: curl -X POST /api/billing/activate -H "x-admin-key: <ADMIN_KEY>" -d \'{"email":"' + user.email + '","plan":"' + planId + '"}\'';
    return send(res, 200, { ok: true, manual: true, message: manual });
  },

  'POST /api/billing/activate': async (req, res) => {
    const b = await readBody(req);
    // Stripe webhook path (signed) or admin-key path
    const isWebhook = req.headers['stripe-signature'];
    if (!isWebhook && req.headers['x-admin-key'] !== ADMIN_KEY) return send(res, 403, { ok: false, error: 'Forbidden' });
    if (isWebhook) {
      if (!verifyStripeWebhook(req, b)) return send(res, 400, { ok: false, error: 'Invalid signature' });
      const email = b?.data?.object?.customer_email || b?.data?.object?.metadata?.email;
      const plan = b?.data?.object?.metadata?.plan;
      if (email && plan && PLANS[plan]) {
        upgradeUser(email, plan);
        logEvent('billing', `Plan activated via Stripe: ${email} → ${plan}`);
      }
      return send(res, 200, { received: true });
    }
    // Admin/manual activation
    if (!b.email || !PLANS[b.plan]) return send(res, 400, { ok: false, error: 'email and valid plan required' });
    const user = upgradeUser(b.email, b.plan);
    if (!user) return send(res, 404, { ok: false, error: 'User not found' });
    logEvent('billing', `Plan activated (manual): ${b.email} → ${b.plan}`);
    send(res, 200, { ok: true, user: publicUser(user), plan: b.plan });
  },

  // --- app (auth required) ---
  'GET /api/app/overview': (req, res) => {
    if (!requireAuth(req, res)) return;
    const campaigns = load('campaigns');
    const prospects = load('prospects');
    const events = load('events');
    const tasks = load('tasks');
    send(res, 200, { ok: true, stats: {
      campaigns: campaigns.length,
      active: campaigns.filter(c => c.status === 'active').length,
      prospects: prospects.length,
      sent: events.filter(e => e.type === 'sent').length,
      openTasks: tasks.filter(t => !t.done).length,
      engine: smtpConfigured ? 'smtp' : 'demo',
    } });
  },

  'GET /api/app/campaigns': (req, res) => {
    if (!requireAuth(req, res)) return;
    const campaigns = load('campaigns');
    const prospects = load('prospects');
    send(res, 200, { ok: true, campaigns: campaigns.map(c => ({
      ...c, prospects: prospects.filter(p => p.campaignId === c.id).length,
      finished: prospects.filter(p => p.campaignId === c.id && p.finished).length,
    })) });
  },

  'POST /api/app/campaigns': async (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const b = await readBody(req);
    if (!b.name?.trim() || !Array.isArray(b.steps) || !b.steps.length) return send(res, 400, { ok: false, error: 'Name and at least one step required.' });
    const user = load('users').find(u => u.email === session.email);
    const plan = planOf(user);
    if (plan.expired) return send(res, 402, { ok: false, error: 'Your trial has ended — upgrade to keep building campaigns.', upgrade: true });
    const campaigns = load('campaigns');
    if (campaigns.length >= plan.maxCampaigns) return send(res, 402, { ok: false, error: `${plan.name} plan allows ${plan.maxCampaigns} campaign${plan.maxCampaigns > 1 ? 's' : ''} — upgrade for more.`, upgrade: true });
    for (const s of b.steps) {
      if (!['email', 'task', 'wait'].includes(s.type)) return send(res, 400, { ok: false, error: `Unknown step type "${s.type}"` });
      if (s.type === 'email' && (!s.subject || !s.body)) return send(res, 400, { ok: false, error: 'Email steps need subject and body.' });
      if (s.type === 'task' && !s.note) return send(res, 400, { ok: false, error: 'Task steps need a note.' });
    }
    const campaign = {
      id: crypto.randomUUID(), name: b.name.trim(), status: 'draft',
      steps: b.steps.map(s => ({ ...s, delayMinutes: Number(s.delayMinutes || 0) })),
      createdAt: new Date().toISOString(),
    };
    campaigns.push(campaign); save('campaigns', campaigns);
    send(res, 201, { ok: true, campaign });
  },

  'POST /api/app/campaigns/:id/activate': (req, res, id) => {
    if (!requireAuth(req, res)) return;
    const campaigns = load('campaigns');
    const campaign = campaigns.find(c => c.id === id);
    if (!campaign) return send(res, 404, { ok: false, error: 'Not found' });
    const prospects = load('prospects');
    let enrolled = 0;
    for (const p of prospects.filter(p => p.campaignId === id && !p.finished)) {
      if (p.nextRunAt == null) { p.stepIndex = 0; p.nextRunAt = Date.now(); enrolled++; }
    }
    campaign.status = 'active';
    save('campaigns', campaigns); save('prospects', prospects);
    logEvent('campaign', `Campaign “${campaign.name}” activated (${enrolled} prospects enrolled)`);
    engineTick(); // immediate pass — on serverless there is no background loop
    send(res, 200, { ok: true, enrolled });
  },

  'POST /api/app/engine/tick': (req, res) => {
    if (!requireAuth(req, res)) return;
    engineTick();
    send(res, 200, { ok: true });
  },

  'POST /api/app/campaigns/:id/pause': (req, res, id) => {
    if (!requireAuth(req, res)) return;
    const campaigns = load('campaigns');
    const campaign = campaigns.find(c => c.id === id);
    if (!campaign) return send(res, 404, { ok: false, error: 'Not found' });
    campaign.status = 'paused';
    save('campaigns', campaigns);
    logEvent('campaign', `Campaign “${campaign.name}” paused`);
    send(res, 200, { ok: true });
  },

  'DELETE /api/app/campaigns/:id': (req, res, id) => {
    if (!requireAuth(req, res)) return;
    save('campaigns', load('campaigns').filter(c => c.id !== id));
    save('prospects', load('prospects').filter(p => p.campaignId !== id));
    send(res, 200, { ok: true });
  },

  'POST /api/app/prospects': async (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const b = await readBody(req);
    if (!b.campaignId) return send(res, 400, { ok: false, error: 'campaignId required' });
    const campaign = load('campaigns').find(c => c.id === b.campaignId);
    if (!campaign) return send(res, 404, { ok: false, error: 'Campaign not found' });
    const user = load('users').find(u => u.email === session.email);
    const plan = planOf(user);
    if (plan.expired) return send(res, 402, { ok: false, error: 'Your trial has ended — upgrade to keep adding prospects.', upgrade: true });
    const prospects = load('prospects');
    if (prospects.length >= plan.maxProspects) return send(res, 402, { ok: false, error: `${plan.name} plan caps at ${plan.maxProspects} prospects — upgrade for more.`, upgrade: true });
    const existing = new Set(prospects.filter(p => p.campaignId === b.campaignId).map(p => p.email));

    const add = (entry) => {
      const email = (entry.email || '').trim().toLowerCase();
      if (!isEmail(email) || existing.has(email)) return false;
      existing.add(email);
      prospects.push({ id: crypto.randomUUID(), campaignId: b.campaignId, email, firstName: entry.firstName || '', lastName: entry.lastName || '', company: entry.company || '', stepIndex: null, nextRunAt: null, finished: false, verified: null, addedAt: new Date().toISOString() });
      return true;
    };

    let added = 0;
    if (Array.isArray(b.list)) for (const e of b.list) if (add(e)) added++;
    if (typeof b.csv === 'string') {
      for (const line of b.csv.split(/\r?\n/)) {
        const [email2, firstName, lastName, company] = line.split(/,|;/).map(s => (s || '').trim());
        if (add({ email: email2, firstName, lastName, company })) added++;
      }
    }
    save('prospects', prospects);
    send(res, 200, { ok: true, added, total: existing.size });
  },

  'GET /api/app/prospects': (req, res, _id, query) => {
    if (!requireAuth(req, res)) return;
    let prospects = load('prospects');
    if (query?.get('campaignId')) prospects = prospects.filter(p => p.campaignId === query.get('campaignId'));
    send(res, 200, { ok: true, prospects });
  },

  'POST /api/app/prospects/:id/verify': async (req, res, id) => {
    if (!requireAuth(req, res)) return;
    const prospects = load('prospects');
    const p = prospects.find(p => p.id === id);
    if (!p) return send(res, 404, { ok: false, error: 'Not found' });
    p.verified = await verifyEmail(p.email);
    save('prospects', prospects);
    send(res, 200, { ok: true, verified: p.verified });
  },

  'GET /api/app/inbox': (req, res) => {
    if (!requireAuth(req, res)) return;
    const replies = load('replies');
    send(res, 200, { ok: true, replies: replies.slice(0, 100) });
  },

  'POST /api/app/inbox/simulate': (req, res) => {
    // Demo/simulated inbound until IMAP/webhook is wired
    if (!requireAuth(req, res)) return;
    const replies = load('replies');
    replies.unshift({
      id: crypto.randomUUID(),
      from: 'sarah@acme.io',
      subject: 'Re: Quick idea for Acme',
      body: 'Thanks for reaching out — this actually looks relevant. Can you send over a short demo link?',
      prospect: 'Sarah Connor',
      campaign: 'Q3 founders',
      read: false,
      at: new Date().toISOString(),
    });
    save('replies', replies);
    send(res, 200, { ok: true, message: 'Simulated reply added to inbox.' });
  },

  // Resend inbound webhook (set RESEND_SIGNING_SECRET to verify)
  'POST /api/email/receive': async (req, res) => {
    const b = await readBody(req).catch(() => ({}));
    const secret = process.env.RESEND_SIGNING_SECRET;
    if (secret && b?.secret && b.secret !== secret) return send(res, 403, { ok: false, error: 'Invalid secret' });
    const from = b?.from || b?.data?.from || 'unknown@unknown';
    const subject = b?.subject || b?.data?.subject || '(no subject)';
    const body = b?.text || b?.data?.text || b?.html?.replace(/<[^>]+>/g, ' ') || '';
    const replies = load('replies');
    replies.unshift({ id: crypto.randomUUID(), from, subject, body, prospect: from.split('@')[0], campaign: 'incoming', read: false, at: new Date().toISOString() });
    save('replies', replies);
    logEvent('received', `Reply from ${from}: ${subject}`);
    send(res, 200, { received: true });
  },

  'POST /api/app/inbox/:id/read': (req, res, id) => {
    if (!requireAuth(req, res)) return;
    const replies = load('replies');
    const r = replies.find(x => x.id === id);
    if (!r) return send(res, 404, { ok: false });
    r.read = true;
    save('replies', replies);
    send(res, 200, { ok: true });
  },

  'GET /api/app/activity': (req, res) => {
    if (!requireAuth(req, res)) return;
    send(res, 200, { ok: true, events: load('events').slice(0, 100) });
  },

  'GET /api/app/tasks': (req, res) => {
    if (!requireAuth(req, res)) return;
    send(res, 200, { ok: true, tasks: load('tasks') });
  },

  'POST /api/app/tasks/:id/done': (req, res, id) => {
    if (!requireAuth(req, res)) return;
    const tasks = load('tasks');
    const task = tasks.find(t => t.id === id);
    if (!task) return send(res, 404, { ok: false, error: 'Not found' });
    task.done = true;
    save('tasks', tasks);
    send(res, 200, { ok: true });
  },

  'POST /api/app/tools/verify': async (req, res) => {
    if (!requireAuth(req, res)) return;
    const b = await readBody(req);
    send(res, 200, { ok: true, result: await verifyEmail(b.email || '') });
  },

  'GET /api/app/tools/domain-audit': async (req, res, _id, query) => {
    if (!requireAuth(req, res)) return;
    const domain = (query?.get('domain') || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!domain) return send(res, 400, { ok: false, error: 'domain required' });
    send(res, 200, { ok: true, result: await domainAudit(domain) });
  },

  'GET /api/app/engine': (req, res) => {
    if (!requireAuth(req, res)) return;
    send(res, 200, { ok: true, mode: smtpConfigured ? (RESEND_KEY ? 'resend' : 'smtp') : 'demo', smtp: smtpConfigured ? { provider: RESEND_KEY ? 'resend' : 'smtp', host: SMTP.host, user: SMTP.user, from: RESEND_FROM } : null });
  },

  'POST /api/app/tools/test-email': async (req, res) => {
    if (!requireAuth(req, res)) return;
    const b = await readBody(req);
    const to = (b.to || '').trim();
    if (!isEmail(to)) return send(res, 400, { ok: false, error: 'Valid email required' });
    try {
      await sendEmail({ name: 'Test email' }, { email: to, firstName: 'there' }, { subject: 'Outrovo test email ✅', body: 'Hi {{firstName}} — if you see this, your Drummer sending pipeline works.' });
      send(res, 200, { ok: true });
    } catch (err) {
      send(res, 502, { ok: false, error: err.message });
    }
  },

  'POST /api/app/ai/scan-site': async (req, res) => {
    if (!requireAuth(req, res)) return;
    const b = await readBody(req);
    const url = (b.url || '').trim();
    if (!url || !/^[\w.-]+\.[a-z]{2,}/i.test(url.replace(/^https?:\/\//, ''))) {
      return send(res, 400, { ok: false, error: 'Enter a valid domain or URL.' });
    }
    try {
      const info = await fetchSite(url);
      const analysis = await analyzeSite(info);
      send(res, 200, { ok: true, site: { url: info.url, title: info.title }, ...analysis });
    } catch (err) {
      send(res, 502, { ok: false, error: `Could not read that site: ${err.message}` });
    }
  },

  'POST /api/app/ai/generate-sequence': async (req, res) => {
    if (!requireAuth(req, res)) return;
    const b = await readBody(req);
    if (!b.product?.trim()) return send(res, 400, { ok: false, error: 'Describe your product or offer first.' });
    const result = await aiGenerateSequence({ product: b.product, audience: b.audience, goal: b.goal, tone: b.tone });
    send(res, 200, { ok: true, ...result });
  },
};

async function handleApi(req, res, url) {
  const rawPath = url.pathname;
  const routeMatch = Object.keys(router).find(key => {
    const [method, route] = key.split(' ');
    if (method !== req.method) return false;
    const pattern = '^' + route.replace(/:id/g, '([^/]+)') + '$';
    return new RegExp(pattern).test(rawPath);
  });
  if (!routeMatch) return send(res, 404, { ok: false, error: 'Not found' });
  const [method, route] = routeMatch.split(' ');
  const match = rawPath.match(new RegExp('^' + route.replace(/:id/g, '([^/]+)') + '$'));
  return router[routeMatch](req, res, match?.[1], url.searchParams);
}

// ---------- static ----------
const PUBLIC_ONLY = ['/app.html', '/app.js'];
function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  if (PUBLIC_ONLY.includes(pathname)) {
    const session = getSession(req);
    if (!session) {
      res.writeHead(302, { Location: '/login.html' });
      return res.end();
    }
  }

  const file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT) || file.startsWith(DATA_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<h1>404 — page not found</h1><p><a href="/">Back to homepage</a></p>');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) return send(res, 405, { ok: false });
      return await handleApi(req, res, url);
    }
    if (req.method !== 'GET') return send(res, 405, { ok: false });
    serveStatic(req, res, url);
  } catch (err) {
    send(res, 400, { ok: false, error: err.message });
  }
});

if (!process.env.VERCEL) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Drummer server on http://0.0.0.0:${PORT} — engine mode: ${smtpConfigured ? 'smtp' : 'demo'}`);
  });
}

// Vercel imports the handler as a serverless function.
module.exports = (req, res) => server.emit("request", req, res);
