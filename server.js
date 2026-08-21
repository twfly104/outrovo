// Outrovo — product MVP server (Node >= 18)
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
// No default admin key: admin endpoints stay locked until ADMIN_KEY is set.
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const adminOk = req => {
  const k = req.headers['x-admin-key'] || '';
  return ADMIN_KEY.length > 0 && k.length === ADMIN_KEY.length &&
    crypto.timingSafeEqual(Buffer.from(k), Buffer.from(ADMIN_KEY));
};
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
  senders: 'senders.json',
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
const publicUser = u => ({ firstName: u.firstName, lastName: u.lastName, email: u.email, company: u.company, owner: u.owner || null, whiteLabel: u.whiteLabel || null });
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

// ---------- sender accounts (multi-inbox) ----------
// Per-user sender inboxes with load-balanced rotation, per-inbox daily caps,
// and warmup ramp-up. App passwords are encrypted at rest with AES-256-GCM;
// the key comes from DATA_KEY (falling back to ADMIN_KEY).
const SENDER_KEY = crypto.createHash('sha256')
  .update(process.env.DATA_KEY || `${ADMIN_KEY}:outrovo-sender-keys`)
  .digest(); // 32-byte key

const PROVIDER_PRESETS = {
  gmail:     { host: 'smtp.gmail.com',       port: 465, note: 'Gmail / Google Workspace — use an App Password (myaccount.google.com/apppasswords).' },
  microsoft: { host: 'smtp.office365.com',   port: 587, note: 'Microsoft 365 / Outlook — password or app password for the mailbox.' },
  custom:    { host: '',                     port: 587, note: 'Enter any SMTP host.' },
};

// Cap ramps up by this many extra emails per active day while warmup is on.
const WARMUP_RAMP_INCREMENT = Number(process.env.WARMUP_RAMP_INCREMENT || 5);
const WARMUP_DEFAULT_START = 5;
const MAX_SPINTAX_DEPTH = 10;

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SENDER_KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}
function decryptSecret(stored) {
  const [v, iv, tag, data] = String(stored || '').split('.');
  if (v !== 'v1' || !iv || !tag || !data) return '';
  const decipher = crypto.createDecipheriv('aes-256-gcm', SENDER_KEY, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

// Env-configured gateway (RESEND / legacy SMTP) acts as an implicit sender so
// existing deployments keep working; it belongs to everyone ("*").
function gatewaySender() {
  if (RESEND_KEY) return { id: '__gateway__', owner: '*', provider: 'resend', email: RESEND_FROM, fromName: '', resend: true, status: 'active', dailyLimit: Infinity };
  if (SMTP.host && SMTP.user) return { id: '__gateway__', owner: '*', provider: 'custom', email: SMTP.from, fromName: '', host: SMTP.host, port: SMTP.port, user: SMTP.user, pass: SMTP.pass || '', status: 'active', dailyLimit: Infinity };
  return null;
}

function engineMode(ownerEmail) {
  if (ownerEmail && load('senders').some(s => s.owner === ownerEmail && s.status === 'active')) return 'multi-inbox';
  return smtpConfigured ? 'smtp' : 'demo';
}

function ownerSenders(email) {
  return load('senders')
    .filter(s => s.owner === email && s.status === 'active')
    .map(s => ({ ...s, pass: s.encPass ? decryptSecret(s.encPass) : '' }));
}

function publicSender(s) {
  const { encPass, pass, ...rest } = s;
  return { ...rest, hasPassword: Boolean(encPass || pass) };
}

function senderDisplayName(s) {
  return s.fromName ? `${s.fromName} <${s.email}>` : s.email;
}

// ---------- warmup & rotation ----------
function senderDailyCap(s) {
  const limit = Number(s.dailyLimit || 50);
  if (s.warmup && s.warmup.enabled) {
    const startCap = Number(s.warmup.startCap || WARMUP_DEFAULT_START);
    const ramp = Math.max(0, Number(s.warmup.rampDays || 0));
    return Math.min(limit, startCap + ramp * WARMUP_RAMP_INCREMENT);
  }
  return limit;
}

function senderUsedToday(s) {
  const today = new Date().toISOString().slice(0, 10);
  return s.sentLog?.date === today ? s.sentLog.count : 0;
}

// Round-robin across warming inboxes interleaved with ready ones: warm
// inboxes still get picks (small caps), and every pick cycles, so no single
// account carries the load. Returns null when every inbox is capped for today.
function pickSender(ownerEmail, prospect) {
  const pool = [
    ...ownerSenders(ownerEmail).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    gatewaySender(),
  ].filter(Boolean);
  if (!pool.length) return null;
  const seed = Array.from(String(prospect.email).replace(/[^a-z0-9]/gi, ''))
    .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  for (let i = 0; i < pool.length; i++) {
    const s = pool[(seed + i) % pool.length];
    if (senderUsedToday(s) < senderDailyCap(s)) return s;
  }
  return null;
}

function recordSend(sender) {
  if (sender.resend) return; // env gateway counts are not tracked
  const senders = load('senders');
  const row = senders.find(x => x.id === sender.id);
  if (!row) return;
  const today = new Date().toISOString().slice(0, 10);
  row.sentLog = { date: today, count: senderUsedToday(row) + 1 };
  if (row.warmup?.enabled && row.warmup.lastRampDay !== today) {
    row.warmup.rampDays = Number(row.warmup.rampDays || 0) + 1;
    row.warmup.lastRampDay = today;
  }
  save('senders', senders);
}

// ---------- suppression list & one-click unsubscribe ----------
// Google/Yahoo require one-click unsubscribe for bulk senders (RFC 8058).
// Each user carries a suppression list; every campaign email gets a
// List-Unsubscribe header + footer link signed with an HMAC token.
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://outrovo.onrender.com').replace(/\/$/, '');
const UNSUB_KEY = crypto.createHash('sha256')
  .update(`${process.env.DATA_KEY || ADMIN_KEY}:outrovo-unsub`)
  .digest();

function unsubToken(ownerEmail, prospectEmail) {
  return crypto.createHmac('sha256', UNSUB_KEY)
    .update(`${ownerEmail}|${prospectEmail}`)
    .digest('base64url');
}

function unsubUrl(ownerEmail, prospectEmail) {
  const q = new URLSearchParams({ u: ownerEmail, e: prospectEmail, t: unsubToken(ownerEmail, prospectEmail) });
  return `${PUBLIC_URL}/api/unsubscribe?${q}`;
}

function suppressionList(ownerEmail) {
  const user = load('users').find(u => u.email === ownerEmail);
  return user?.suppressed || [];
}

function isSuppressed(ownerEmail, email) {
  return suppressionList(ownerEmail).some(s => s.email === email);
}

function suppressEmail(ownerEmail, email, reason = 'unsubscribe') {
  const users = load('users');
  const user = users.find(u => u.email === ownerEmail);
  if (!user) return false;
  user.suppressed = user.suppressed || [];
  if (!user.suppressed.some(s => s.email === email)) {
    user.suppressed.push({ email, reason, at: new Date().toISOString() });
    save('users', users);
    logEvent('unsubscribe', `${email} opted out (${reason})`);
    fireWebhooks(ownerEmail, 'unsubscribe', { email, reason });
    // Stop any in-flight sequences for this prospect across the owner's campaigns.
    const ownerCampaigns = new Set(load('campaigns').filter(c => c.owner === ownerEmail).map(c => c.id));
    const prospects = load('prospects');
    let touched = 0;
    for (const p of prospects) {
      if (ownerCampaigns.has(p.campaignId) && p.email === email && !p.finished) {
        p.finished = true; p.nextRunAt = null; p.suppressed = true; touched++;
      }
    }
    if (touched) save('prospects', prospects);
  }
  return true;
}

// ---------- campaign pacing ----------
// Per-campaign daily cap + send window in the campaign's timezone. Outside
// the window or past the cap, prospects are deferred — never failed.
function hourInTz(tz) {
  try {
    return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz || 'UTC' }).format(new Date()));
  } catch {
    return new Date().getUTCHours();
  }
}

function campaignWindowOk(campaign) {
  const start = Number(campaign.sendWindowStart ?? 9);
  const end = Number(campaign.sendWindowEnd ?? 17);
  if (start === end) return true; // window disabled
  const hour = hourInTz(campaign.timezone);
  return start < end ? (hour >= start && hour < end) : (hour >= start || hour < end);
}

function campaignUsedToday(campaign) {
  const today = new Date().toISOString().slice(0, 10);
  return campaign.sentLog?.date === today ? campaign.sentLog.count : 0;
}

function campaignDailyCap(campaign) {
  return Math.max(1, Number(campaign.dailyCap || 25));
}

function recordCampaignSend(campaignId, bounced = false) {
  if (!campaignId) return;
  const campaigns = load('campaigns');
  const c = campaigns.find(x => x.id === campaignId);
  if (!c) return;
  const today = new Date().toISOString().slice(0, 10);
  c.sentLog = { date: today, count: campaignUsedToday(c) + 1 };
  c.sentCount = Number(c.sentCount || 0) + 1;
  if (bounced) c.bounceCount = Number(c.bounceCount || 0) + 1;
  save('campaigns', campaigns);
}

// ---------- bounce classification ----------
// 5xx / permanent SMTP errors → hard bounce: stop the sequence for this
// prospect. 4xx / transient → soft: retry a few times before giving up.
const HARD_BOUNCE_RE = /\b5\d\d\b|user unknown|does not exist|mailbox unavailable|no such user|invalid recipient|recipient rejected|mailbox not found/i;
const SOFT_BOUNCE_RE = /\b4\d\d\b|try again|temporarily|rate limit|greylist|throttl/i;
const SOFT_RETRY_MS = Number(process.env.SOFT_RETRY_MS || 30 * 60000);
const SOFT_MAX_RETRIES = 3;

function classifySendError(err) {
  const text = `${err?.responseCode || ''} ${err?.message || err}`;
  if (HARD_BOUNCE_RE.test(text)) return 'hard';
  if (SOFT_BOUNCE_RE.test(text)) return 'soft';
  return 'unknown';
}

// ---------- agency: client accounts & consolidated billing ----------
// A user can act as an agency: invite client accounts (owner: agencyEmail)
// and scope every view/action to the active workspace. Billable seats roll
// up to the agency.
function clientsOf(agencyEmail) {
  return load('users').filter(u => u.owner === agencyEmail);
}
function workspaceEmail(req) {
  const session = getSession(req);
  if (!session) return null;
  const actAs = req.headers['x-outrovo-as'];
  if (!actAs) return session.email;
  const target = load('users').find(u => u.email === String(actAs).toLowerCase());
  return target && target.owner === session.email ? target.email : session.email;
}
function agencyStats(agencyEmail) {
  const campaigns = load('campaigns');
  const prospects = load('prospects');
  const senders = load('senders');
  return clientsOf(agencyEmail).map(c => {
    const mine = campaigns.filter(x => x.owner === c.email);
    const ids = new Set(mine.map(x => x.id));
    const myProspects = prospects.filter(p => ids.has(p.campaignId));
    const plan = planOf(c);
    return {
      email: c.email, name: `${c.firstName} ${c.lastName}`, company: c.company,
      plan: plan.name, planId: c.plan || 'trial', trialEnds: c.trialEnds, expired: plan.expired || false,
      campaigns: mine.length, active: mine.filter(x => x.status === 'active').length,
      prospects: myProspects.length,
      sent: mine.reduce((acc, x) => acc + Number(x.sentCount || 0), 0),
      bounces: myProspects.filter(p => p.bounced).length,
      inboxes: senders.filter(s => s.owner === c.email && s.status === 'active').length,
      createdAt: c.createdAt,
    };
  });
}

// ---------- conditional branching ----------
// Email steps can carry branchNext: { onReplied: 'label', onClicked: 'label',
// onNoReply: 'label' }. Step labels give the engine a jump table. Missing
// labels fall through to the next step in order.
function resolveNextIndex(campaign, prospect) {
  const step = campaign.steps[prospect.stepIndex];
  let label = null;
  if (step?.branchNext && typeof step.branchNext === 'object') {
    if (prospect.replied && step.branchNext.onReplied) label = step.branchNext.onReplied;
    else if (prospect.clicked && step.branchNext.onClicked) label = step.branchNext.onClicked;
    else if (!prospect.replied && step.branchNext.onNoReply) label = step.branchNext.onNoReply;
  }
  if (label) {
    const idx = campaign.steps.findIndex(s => s.label === label && s.type !== 'branch-anchor');
    if (idx >= 0) return idx;
  }
  return prospect.stepIndex + 1;
}

// ---------- A/B testing ----------
// Email steps may carry variantB: { subject, body } — variant A is the step's
// own subject/body. Assignment is deterministic per prospect+step (stable
// across retries) and recorded on prospect.abLog for the results endpoint.
function pickVariant(step, prospect) {
  if (!step.variantB || !step.variantB.subject || !step.variantB.body) return { key: 'A', subject: step.subject, body: step.body };
  prospect.abLog = prospect.abLog || {};
  const k = String(prospect.stepIndex);
  if (!prospect.abLog[k]) {
    const h = crypto.createHash('sha1').update(`${prospect.id}:${k}`).digest()[0];
    prospect.abLog[k] = h % 2 === 0 ? 'A' : 'B';
  }
  const key = prospect.abLog[k];
  return key === 'B' ? { key, subject: step.variantB.subject, body: step.variantB.body } : { key, subject: step.subject, body: step.body };
}

function abResultsFor(campaign, prospects) {
  const rows = [];
  campaign.steps.forEach((step, i) => {
    if (step.type !== 'email' || !step.variantB) return;
    const inCampaign = prospects.filter(p => p.campaignId === campaign.id && p.abLog && p.abLog[String(i)]);
    const a = inCampaign.filter(p => p.abLog[String(i)] === 'A');
    const b = inCampaign.filter(p => p.abLog[String(i)] === 'B');
    const stat = arr => ({ sent: arr.length, replied: arr.filter(p => p.replied).length, clicked: arr.filter(p => p.clicked).length });
    const sa = stat(a), sb = stat(b);
    const rate = s => (s.sent ? Math.round((s.replied / s.sent) * 1000) / 10 : 0);
    rows.push({
      stepIndex: i, label: step.label || `Step ${i + 1}`,
      variantA: { subject: step.subject, ...sa, replyRate: rate(sa) },
      variantB: { subject: step.variantB.subject, ...sb, replyRate: rate(sb) },
      winner: sa.sent >= 10 && sb.sent >= 10 ? (rate(sa) >= rate(sb) ? 'A' : 'B') : null,
    });
  });
  return rows;
}

// ---------- reply intent (Smart Unibox) ----------
const INTENT_LABELS = ['interested', 'not_interested', 'question', 'out_of_office', 'unsubscribe', 'bounce', 'neutral'];
async function classifyIntent(reply) {
  const text = `Subject: ${reply.subject}\n\n${String(reply.body || '').slice(0, 1200)}`;
  const key = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (key) {
    try {
      const base = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const model = process.env.LLM_MODEL || 'gpt-4o-mini';
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Categorize a cold-outreach reply into exactly one label. Respond with only the label, one of: ' + INTENT_LABELS.join(', ') + '. unsubscribe means an opt-out request. bounce means an auto-reply delivery failure. out_of_office means an auto-responder.' },
            { role: 'user', content: text },
          ],
          temperature: 0, max_tokens: 12,
        }),
      });
      const data = await res.json();
      const label = (data.choices?.[0]?.message?.content || '').trim().toLowerCase().replace(/[^a-z_]/g, '');
      if (INTENT_LABELS.includes(label)) return label;
    } catch {}
  }
  // Heuristic fallback so the Unibox works with zero LLM config.
  const t = text.toLowerCase();
  if (/out of (the )?office|auto-?reply|on vacation|returning on|limited access to email/.test(t)) return 'out_of_office';
  if (/undeliverable|delivery (has )?failed|mail delivery (failed|subsystem)|550 |5\.1\.1/.test(t)) return 'bounce';
  if (/unsubscribe|remove me|stop emailing|opt.?out|take me off|don't (email|contact) me/.test(t)) return 'unsubscribe';
  if (/(not|no) interested|not a (good )?fit|we're (all )?set|pass\b|don't reach out/.test(t)) return 'not_interested';
  if (/\?\s*$|how (much|does)|what (does|is)|can you (send|share)|pricing|demo\?/.test(t) || t.includes('?')) return 'question';
  if (/(yes|sounds good|let's (talk|chat|book)|interested|send (over|me)|book a|schedule a|tell me more|love to)/.test(t)) return 'interested';
  return 'neutral';
}

// ---------- enrichment (Apollo / Hunter / Dropcontact) ----------
function enrichmentProvider() {
  if (process.env.APOLLO_API_KEY) return 'apollo';
  if (process.env.HUNTER_API_KEY) return 'hunter';
  if (process.env.DROPCONTACT_API_KEY) return 'dropcontact';
  return null;
}
async function callEnrichment(email, name = {}) {
  const provider = enrichmentProvider();
  const domain = (email.split('@')[1] || '').toLowerCase();
  const base = { email, provider: provider || 'builtin', at: new Date().toISOString() };
  if (provider === 'apollo') {
    const res = await fetch('https://api.apollo.io/api/v1/people/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': process.env.APOLLO_API_KEY },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error(`Apollo ${res.status}`);
    const p = (await res.json())?.person || {};
    return { ...base, firstName: p.first_name || name.firstName, lastName: p.last_name || name.lastName,
      company: p.organization?.name || '', title: p.title || '', linkedinUrl: p.linkedin_url || '',
      city: p.city || '', seniority: p.seniority || '', departments: p.departments || [] };
  }
  if (provider === 'hunter') {
    const q = new URLSearchParams({ email, api_key: process.env.HUNTER_API_KEY });
    const res = await fetch(`https://api.hunter.io/v2/email-verifier?${q}`);
    if (!res.ok) throw new Error(`Hunter ${res.status}`);
    const d = (await res.json())?.data || {};
    return { ...base, firstName: d.first_name || name.firstName, lastName: d.last_name || name.lastName,
      company: d.company || '', title: d.position || '', linkedinUrl: d.linkedin_url || '',
      hunterStatus: d.status || '', hunterScore: d.score ?? null };
  }
  if (provider === 'dropcontact') {
    const res = await fetch('https://api.dropcontact.io/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Access-Token': process.env.DROPCONTACT_API_KEY },
      body: JSON.stringify({ data: [{ email }] }),
    });
    if (!res.ok) throw new Error(`Dropcontact ${res.status}`);
    const d = (await res.json())?.data?.[0] || {};
    return { ...base, firstName: d.first_name || name.firstName, lastName: d.last_name || name.lastName,
      company: d.company || '', title: d.job || '', linkedinUrl: d.linkedin || '' };
  }
  // No paid key: derive from MX records + public Gravatar profile so the UI
  // still works and the UI labels which mode answered.
  const enriched = { ...base };
  if (!name.firstName && !enriched.firstName) {
    const [local] = email.split('@');
    const parts = local.split(/[._-]+/).filter(Boolean);
    if (parts.length >= 2) { enriched.firstName = cap(parts[0]); enriched.lastName = cap(parts[1]); }
  }
  try {
    const mx = await dns.resolveMx(domain);
    enriched.mx = mx.map(m => m.exchange).slice(0, 2);
  } catch { enriched.mx = []; }
  const h = crypto.createHash('md5').update(email).digest('hex');
  try {
    const g = await fetch(`https://www.gravatar.com/${h}.json`, { headers: { 'User-Agent': 'OutrovoBot/1.0' } });
    if (g.ok) {
      const e = (await g.json())?.entry?.[0] || {};
      if (!enriched.firstName && e.name?.givenName) { enriched.firstName = e.name.givenName; enriched.lastName = e.name.familyName || ''; }
      if (!enriched.company && e.currentLocation) enriched.city = e.currentLocation;
    }
  } catch {}
  return enriched;
}
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

// ---------- lead finder (Apollo / Hunter / builtin guess+verify) ----------
function leadFinderProvider() {
  if (process.env.APOLLO_API_KEY) return 'apollo';
  if (process.env.HUNTER_API_KEY) return 'hunter';
  return null;
}
const LEAD_SOURCES = ['apollo', 'hunter', 'builtin'];
function leadFinderSourceOrder() {
  const p = leadFinderProvider();
  return p ? [p, 'builtin'] : ['builtin'];
}

async function apolloSearchLeads(f, perPage) {
  const key = process.env.APOLLO_API_KEY;
  const pageSize = Math.min(100, Math.max(10, perPage * 3));
  const body = {
    page: 1, per_page: pageSize,
    q_keywords: f.keywords || undefined,
    person_titles: f.title ? [f.title] : undefined,
    organization_num_employees_ranges: f.size ? [f.size] : undefined,
    person_locations: f.location ? [f.location] : undefined,
    contact_email_status: ['verified'],
  };
  const res = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': key },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Apollo search ${res.status}`);
  const data = await res.json();
  const people = [...(data.people || []), ...(data.contacts || [])];
  const seen = new Set();
  return people.map(p => {
    const email = (p.email || '').trim().toLowerCase();
    return {
      email, source: 'apollo',
      firstName: p.first_name || '', lastName: p.last_name || '',
      company: p.organization?.name || p.organization_name || '',
      title: p.title || '', linkedinUrl: p.linkedin_url || '',
      emailStatus: p.email_status || '',
    };
  }).filter(l => {
    if (!isEmail(l.email) || l.emailStatus === 'bounced') return false;
    if (seen.has(l.email)) return false;
    seen.add(l.email);
    return true;
  });
}

async function hunterSearchLeads(f, perPage) {
  const key = process.env.HUNTER_API_KEY;
  // One domain per Hunter call — split multi-domain input into separate calls.
  const domains = (f.keywords || '')
    .split(/[,\s]+/).map(s => s.trim().replace(/^@/, '').replace(/^https?:\/\//, '').split('/')[0])
    .filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)).slice(0, 5);
  if (!domains.length) return [];
  const out = [];
  for (const domain of domains) {
    // Free plan caps at 10 results per domain search; more is rejected.
    const q = new URLSearchParams({ domain, api_key: key, limit: String(Math.min(10, perPage)) });
    const res = await fetch(`https://api.hunter.io/v2/domain-search?${q}`);
    if (!res.ok) throw new Error(`Hunter search ${res.status}`);
    const payload = await res.json();
    if (payload?.errors?.length) throw new Error(`Hunter: ${payload.errors[0].details || 'API error'}`);
    const data = payload?.data || {};
    for (const e of data.emails || []) {
      out.push({
        email: (e.value || '').trim().toLowerCase(), source: 'hunter',
        firstName: e.first_name || '', lastName: e.last_name || '',
        company: data.organization || domain, title: e.position || '',
        linkedinUrl: e.linkedin || '', emailStatus: e.confidence >= 50 ? 'verified' : '',
      });
    }
  }
  return out.filter(l => isEmail(l.email));
}

const GENERIC_LOCALS = new Set(['info', 'contact', 'hello', 'support', 'sales', 'team', 'office', 'mail', 'admin', 'no-reply', 'noreply']);
function guessEmailPatterns(first, last, domain) {
  const f = (first || '').toLowerCase().replace(/[^a-z]/g, '');
  const l = (last || '').toLowerCase().replace(/[^a-z]/g, '');
  const d = (domain || '').toLowerCase().trim();
  if (!f || !d) return [];
  const pats = l
    ? [`${f}@${d}`, `${f}.${l}@${d}`, `${f[0]}${l}@${d}`, `${f}${l}@${d}`, `${f[0]}.${l}@${d}`]
    : [`${f}@${d}`];
  return [...new Set(pats)];
}

async function builtinSearchLeads(f, perPage, sessionEmail) {
  // Free source: user supplies target domains (e.g. acme.com, orbcall.io);
  // we crawl the site's public pages for published emails, then MX-verify.
  const domains = (f.keywords || '')
    .split(/[,\s]+/).map(s => s.trim().replace(/^@/, '').replace(/^https?:\/\//, '').split('/')[0])
    .filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)).slice(0, 5);
  if (!domains.length) return [];
  const out = [];
  for (const domain of domains) {
    const found = new Set();
    for (const path of ['', '/about', '/contact', '/team']) {
      if (found.size >= 10) break;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(`https://${domain}${path}`, {
          signal: ctrl.signal, redirect: 'follow',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OutrovoLeadFinder/1.0)' },
        });
        clearTimeout(timer);
        if (!res.ok) continue;
        const html = await res.text();
        const matches = html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
        for (const m of matches) {
          const e = m.toLowerCase();
          if (!e.endsWith('@' + domain)) continue;
          if (GENERIC_LOCALS.has(e.split('@')[0])) continue;
          if (/\.(png|jpg|jpeg|gif|webp|svg|css|js)$/.test(e)) continue;
          found.add(e);
        }
      } catch { /* unreachable site — skip */ }
    }
    for (const email of found) {
      const local = email.split('@')[0];
      const parts = local.split(/[._-]+/).filter(Boolean);
      out.push({
        email, source: 'builtin',
        firstName: parts.length ? cap(parts[0]) : '', lastName: parts.length > 1 ? cap(parts[1]) : '',
        company: domain, title: f.title || '', linkedinUrl: '', emailStatus: '',
      });
      if (out.length >= perPage * 6) break;
    }
    if (out.length >= perPage * 6) break;
  }
  return out;
}

async function verifyLeadBatch(leads, limit) {
  // MX-verify in small parallel batches; keep deliverables first.
  const ok = [], unsure = [], bad = [];
  const queue = leads.slice(0, limit * 3);
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const l = queue.shift();
      try {
        const v = await verifyEmail(l.email);
        const verdict = v.verdict === 'deliverable' ? 'valid' : (v.mx?.length ? 'unknown' : 'invalid');
        const enriched = { ...l, verified: verdict };
        if (verdict === 'valid') ok.push(enriched);
        else if (verdict === 'unknown') unsure.push(enriched);
        else bad.push(enriched);
      } catch { unsure.push({ ...l, verified: 'unknown' }); }
    }
  });
  await Promise.all(workers);
  return [...ok, ...unsure];
}

async function searchLeads(f, perPage, sessionEmail) {
  const order = leadFinderSourceOrder();
  const errors = [];
  let leads = [];
  for (const src of order) {
    try {
      if (src === 'apollo') leads = await apolloSearchLeads(f, perPage);
      else if (src === 'hunter') leads = await hunterSearchLeads(f, perPage);
      else leads = await builtinSearchLeads(f, perPage, sessionEmail);
      if (leads.length) break;
    } catch (err) { errors.push(`${src}: ${err.message}`); }
  }
  // Filter out emails already in any of this user's campaigns or suppressed
  const campaigns = load('campaigns').filter(c => c.owner === sessionEmail);
  const campaignIds = new Set(campaigns.map(c => c.id));
  const existing = new Set(load('prospects').filter(p => campaignIds.has(p.campaignId)).map(p => p.email));
  leads = leads.filter(l => !existing.has(l.email) && !isSuppressed(sessionEmail, l.email));
  leads = leads.filter(l => !GENERIC_LOCALS.has(l.email.split('@')[0]));
  if (!leads.length) return { leads: [], provider: null, errors };
  const verified = await verifyLeadBatch(leads, perPage);
  return { leads: verified.slice(0, perPage), provider: leads[0].source, errors };
}

// ---------- lead finder autopilot ----------
// Saved search criteria that runs once per UTC day inside the engine tick:
// finds fresh leads, keeps only MX-verified deliverables, and auto-enrolls
// them into the chosen campaign. Daily cap + monthly quota guards prevent
// silent credit burn; the first run of each day logs an activity event.
const AUTOPILOT_MAX_DAILY = 10;
function leadFinderAutopilot(user) {
  const ap = user.leadFinderAutopilot;
  if (!ap || !ap.enabled || !ap.campaignId || !ap.keywords?.trim()) return null;
  return ap;
}

async function autopilotRun() {
  const users = load('users');
  const today = new Date().toISOString().slice(0, 10);
  let changed = false;
  for (const user of users) {
    const ap = leadFinderAutopilot(user);
    if (!ap) continue;
    if (ap.lastRunDate === today) continue;
    const plan = planOf(user);
    ap.lastRunDate = today;
    changed = true;
    if (plan.expired) { ap.lastNote = 'Trial expired — autopilot paused.'; continue; }
    const usage = leadFinderUsage(user, plan);
    if (usage.used >= usage.quota) { ap.lastNote = `Monthly quota reached (${usage.quota}). Autopilot resumes next month.`; continue; }
    const dailyCap = Math.min(Math.max(1, Number(ap.dailyLimit) || 5), AUTOPILOT_MAX_DAILY);
    const limit = Math.min(dailyCap, usage.quota - usage.used);
    try {
      const found = await searchLeads({
        keywords: ap.keywords.slice(0, 200), title: (ap.title || '').slice(0, 120),
        size: ap.size || '', location: (ap.location || '').slice(0, 120),
      }, limit, user.email);
      user.leadFinder.used = usage.used + Math.min(found.leads.length, limit);
      // Guardrail: only auto-enroll MX-verified deliverables — never risk
      // the sender's domain reputation on unknown/invalid addresses.
      const validOnly = found.leads.filter(l => l.verified === 'valid');
      const result = validOnly.length ? enrollLeads(user.email, ap.campaignId, validOnly) : { added: 0 };
      ap.lastNote = `${result.added || 0} new lead${result.added === 1 ? '' : 's'} auto-enrolled from ${found.leads.length} found into "${result.campaignName || 'your campaign'}"`;
      if (!result.added) logEvent('lead-finder', `Autopilot: ${ap.lastNote}`, { owner: user.email });
      // Wake new prospects immediately if the campaign is already active.
      const camp = load('campaigns').find(c => c.id === ap.campaignId && c.owner === user.email);
      if (camp && camp.status === 'active' && result.added) {
        const prospects = load('prospects');
        let woke = false;
        for (const p of prospects.filter(p => p.campaignId === camp.id && !p.finished && p.nextRunAt == null)) {
          p.stepIndex = 0; p.nextRunAt = Date.now(); woke = true;
        }
        if (woke) save('prospects', prospects);
      }
    } catch (err) {
      ap.lastNote = `Autopilot error: ${err.message}`;
    }
  }
  if (changed) save('users', users);
}

function leadFinderUsage(user, plan) {
  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  if (!user.leadFinder || user.leadFinder.month !== monthKey) {
    user.leadFinder = { month: monthKey, used: 0 };
  }
  return { used: user.leadFinder.used, quota: plan.leadFinderCredits ?? 100, month: monthKey };
}

function enrollLeads(sessionEmail, campaignId, leads) {
  const campaign = load('campaigns').find(c => c.id === campaignId && c.owner === sessionEmail);
  if (!campaign) return { error: 'Campaign not found' };
  const user = load('users').find(u => u.email === sessionEmail);
  const plan = planOf(user);
  const prospects = load('prospects');
  const existing = new Set(prospects.filter(p => p.campaignId === campaignId).map(p => p.email));
  const ownerCampaignIds = new Set(load('campaigns').filter(c => c.owner === sessionEmail).map(c => c.id));
  let added = 0, skippedSuppressed = 0;
  for (const l of leads) {
    if (prospects.filter(p => ownerCampaignIds.has(p.campaignId)).length >= plan.maxProspects) break;
    const email = (l.email || '').trim().toLowerCase();
    if (!isEmail(email) || existing.has(email)) continue;
    if (isSuppressed(sessionEmail, email)) { skippedSuppressed++; continue; }
    existing.add(email);
    prospects.push({
      id: crypto.randomUUID(), campaignId, email,
      firstName: l.firstName || '', lastName: l.lastName || '', company: l.company || '',
      customVars: { title: l.title || '', linkedin: l.linkedinUrl || '', source: `leadfinder:${l.source || 'builtin'}` },
      stepIndex: null, nextRunAt: null, finished: false,
      verified: l.verified === 'valid' ? 'valid' : (l.verified || null), addedAt: new Date().toISOString(),
    });
    added++;
  }
  save('prospects', prospects);
  logEvent('lead-finder', `${added} Lead Finder prospects added to “${campaign.name}”`, { campaign: campaign.name, added });
  return { added, skippedSuppressed, campaignName: campaign.name };
}

// ---------- CRM / automation webhooks ----------
// user.integrations: [{ url, provider, secret, events[] }]. Events fan out
// to matching webhooks (Zapier catch hooks, HubSpot/Pipedrive workflow
// webhooks, or any endpoint). Failures are logged, never block the engine.
const INTEGRATION_EVENTS = ['sent', 'bounce', 'unsubscribe', 'reply', 'task', 'campaign'];
async function fireWebhooks(ownerEmail, eventType, payload) {
  const user = load('users').find(u => u.email === ownerEmail);
  const hooks = (user?.integrations || []).filter(i => i.url && (i.events?.includes(eventType) || !i.events?.length));
  for (const hook of hooks) {
    try {
      const body = JSON.stringify({ event: eventType, provider: hook.provider || 'webhook', at: new Date().toISOString(), data: payload });
      const headers = { 'Content-Type': 'application/json', 'User-Agent': 'Outrovo-Webhooks/1.0' };
      if (hook.secret) headers['X-Outrovo-Signature'] = crypto.createHmac('sha256', hook.secret).update(body).digest('hex');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      await fetch(hook.url, { method: 'POST', headers, body, signal: controller.signal });
      clearTimeout(timer);
    } catch (err) {
      logEvent('error', `Webhook delivery failed (${hook.provider || hook.url}): ${err.message}`);
    }
  }
}

// ---------- LinkedIn task safety ----------
// Daily action budget per user (human-safe pacing), spread across a work
// window. External autopilots close the loop via a signed callback endpoint.
const LINKEDIN_DAILY_BUDGET = Number(process.env.LINKEDIN_DAILY_BUDGET || 20);
const LINKEDIN_SPREAD_HOURS = Number(process.env.LINKEDIN_SPREAD_HOURS || 6);

function linkedinBudget(user) {
  return Math.max(1, Number(user?.linkedinBudget || LINKEDIN_DAILY_BUDGET));
}

function linkedinUsedToday(ownerEmail) {
  const today = new Date().toISOString().slice(0, 10);
  return load('tasks').filter(t => t.owner === ownerEmail && (t.at || '').slice(0, 10) === today).length;
}

function integrationTokenOk(token) {
  if (!token) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return load('users').find(u => u.integrationTokenHash && u.integrationTokenHash === hash) || null;
}

// ---------- spintax & personalization ----------
// Spintax: {Hi|Hello|Hey} spins one variant, supports nesting. Guards against
// pathological input with a depth limit. Deterministic per prospect + template
// so previews match sends.
function spinSeed(text, prospect) {
  let h = 0;
  const src = `${prospect.email}|${text}`;
  for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) | 0;
  return () => { h = (h * 1103515245 + 12345) | 0; return (h >>> 16) / 65536; };
}

function applySpintax(text, prospect, depth = 0) {
  if (depth > MAX_SPINTAX_DEPTH || !text.includes('{')) return text;
  const rand = spinSeed(text, prospect);
  const out = text.replace(/\{([^{}]*)\}/g, (match, inner) => {
    if (!inner.includes('|') || /\{\{/.test(match)) return match; // leave {{vars}} alone
    const options = inner.split('|');
    return options[Math.floor(rand() * options.length)];
  });
  return /\{[^{}]*\|/.test(out) ? applySpintax(out, prospect, depth + 1) : out;
}

// {{firstName}}-style templating over any prospect field (built-in + custom
// CSV columns), then spintax.
function personalize(text, prospect) {
  return applySpintax(renderTemplate(text, prospect), prospect);
}

// ---------- transport ----------
function renderTemplate(text, prospect) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => prospect[key] ?? prospect.customVars?.[key] ?? '');
}
let transporter = null;
if (smtpConfigured && nodemailer) {
  transporter = nodemailer.createTransport({
    host: SMTP.host, port: SMTP.port,
    secure: SMTP.port === 465,
    auth: { user: SMTP.user, pass: SMTP.pass },
  });
}
async function sendViaResend(to, subject, text, from = RESEND_FROM, headers = null) {
  const payload = { from, to: [to], subject, text };
  if (headers) payload.headers = headers;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend ${res.status}: ${err.slice(0, 200)}`);
  }
}

function senderTransport(sender) {
  if (!nodemailer || !sender.host) return null;
  return nodemailer.createTransport({
    host: sender.host,
    port: sender.port,
    secure: Number(sender.port) === 465,
    auth: { user: sender.user || sender.email, pass: sender.pass || '' },
  });
}

// Send one campaign step to one prospect through the rotation.
// opts.sender picks a specific inbox (test-email), opts.fallback is the
// legacy env SMTP transport kept for backward compatibility.
async function sendEmail(campaign, prospect, step, opts = {}) {
  const variant = pickVariant(step, prospect);
  const subject = personalize(variant.subject, prospect);
  // Compliance footer + List-Unsubscribe headers on real campaign sends
  // (skipped for the test-email tool, which passes campaign.id undefined).
  const withUnsub = Boolean(campaign.id && campaign.owner);
  const link = withUnsub ? unsubUrl(campaign.owner, prospect.email) : null;
  const body = personalize(variant.body, prospect)
    + (withUnsub ? `\n\n—\nDon't want these emails? Unsubscribe: ${link}` : '');
  const unsubHeaders = withUnsub ? {
    'List-Unsubscribe': `<${link}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  } : null;
  const label = `“${campaign.name}”: email to ${prospect.email}`;

  let sender = opts.sender || null;
  if (!sender) {
    sender = campaign.owner ? pickSender(campaign.owner, prospect) : gatewaySender();
    if (!sender) {
      const hasAny = campaign.owner && (ownerSenders(campaign.owner).length || gatewaySender());
      const err = new Error(hasAny
        ? 'All sender inboxes hit their daily cap — paused until tomorrow.'
        : 'No sender inbox connected — add one in Settings → Sender accounts.');
      logEvent('error', `${label}: ${err.message}`);
      throw err;
    }
  }

  if (sender.resend) {
    await sendViaResend(prospect.email, subject, body, senderDisplayName(sender), unsubHeaders);
    recordCampaignSend(campaign.id);
    logEvent('sent', `${label} (via Resend)`, { subject, sender: sender.email });
    if (campaign.owner) fireWebhooks(campaign.owner, 'sent', { email: prospect.email, campaign: campaign.name, subject, sender: sender.email });
    return { demo: false, sender: sender.email };
  }

  // Explicit sender with own host → its transport; legacy env gateway falls
  // back to the shared transport handed to this function; nothing → demo.
  const senderHasSmtp = Boolean(sender.host && nodemailer);
  const t = senderHasSmtp ? senderTransport(sender) : opts.fallback || null;
  if (!t) {
    logEvent('sent', `[DEMO] ${label}`, { subject, sender: sender.email });
    return { demo: true, sender: sender.email };
  }
  const from = senderHasSmtp ? senderDisplayName(sender) : (SMTP.from || senderDisplayName(sender));
  await t.sendMail({ from, to: prospect.email, subject, text: body, headers: unsubHeaders || undefined });
  recordSend(sender);
  recordCampaignSend(campaign.id);
  logEvent('sent', `${label} (via ${sender.email})`, { subject, sender: sender.email });
  if (campaign.owner) fireWebhooks(campaign.owner, 'sent', { email: prospect.email, campaign: campaign.name, subject, sender: sender.email });
  return { demo: false, sender: sender.email };
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
  // JSON-LD @type often declares the org's industry (e.g. "FinancialService").
  const ldTypes = [...html.matchAll(/"@type"\s*:\s*"([^"]+)"/gi)]
    .map(m => m[1]).filter(t => !/^(WebSite|WebPage|BreadcrumbList|Article|NewsArticle|FAQPage|Organization|Corporation|LocalBusiness|SearchAction|SiteNavigationElement|ItemList|VideoObject|ImageObject)$/i.test(t))
    .slice(0, 3);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 3000);
  return { url, title, desc, h1s, ldTypes, text };
}

async function fetchSite(url) {
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(target, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OutrovoBot/1.0; +https://github.com/twfly104/outrovo)',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`Site returned ${res.status}`);
    const html = (await res.text()).slice(0, 200000);
    return extractSiteInfo(html, target);
  } finally {
    clearTimeout(timer);
  }
}
// Infer an ideal-customer profile (ICP) from a company website. LLM when
// configured, heuristic regexes otherwise. Size values match the lead-finder
// form's select options exactly (e.g. '11,50') or the select ignores them.

// Company size must match the UI select's option values exactly
// (e.g. "11,50") or the select ignores it.
function normSize(s) {
  const n = parseInt(String(s || '').replace(/[^\d]/g, '').slice(-4), 10);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n <= 10) return '1,10';
  if (n <= 50) return '11,50';
  if (n <= 200) return '51,200';
  if (n <= 500) return '201,500';
  if (n <= 1000) return '501,1000';
  return '1001,10000';
}

// Buyer-persona guesses for the heuristic ICP scan, ordered by ICP value.
// The persona actually buying depends on company size: founders buy at small
// companies, functional heads at larger ones.
const BUYER_PERSONAS = [
  { title: 'head of sales', re: /\b(head of sales|sales director|vp sales|chief revenue|sales team|sales leaders|revenue team)s?\b/ },
  { title: 'head of marketing', re: /\b(head of marketing|marketing director|cmo|vp marketing|marketing team|growth team)s?\b/ },
  { title: 'head of product', re: /\b(head of product|product manager|cpo|vp product|product team)s?\b/ },
  { title: 'head of engineering', re: /\b(head of engineering|cto|vp engineering|engineering manager|engineering team|developer)s?\b/ },
  { title: 'head of data', re: /\b(head of data|chief data officer|data team|ml engineers?|ai team|data science)s?\b/ },
  { title: 'head of operations', re: /\b(head of operations|coo|operations team|ops team)s?\b/ },
];

function heuristicIcp(info, domain, extraText) {
  const high = (info.title + ' ' + info.desc + ' ' + info.h1s.join(' ') + ' ' + info.ldTypes.join(' ')).toLowerCase();
  const text = (high + ' ' + info.text + ' ' + extraText).toLowerCase();

  // Keywords: infer the target market from what the company sells, not the
  // company's own domain (searching scale.com would return the user's own
  // employees, not their customers). Specific cues (security, fintech,
  // ecommerce…) are listed before generic ones (saas, software, marketing)
  // so specificity wins. JSON-LD @type often names the industry outright.
  const INDUSTRY_CUES = [
    ['generative ai', 'AI startups'], ['artificial intelligence', 'AI startups'],
    ['machine learning', 'AI startups'], ['llm', 'AI startups'],
    ['data labeling', 'AI startups'],
    ['fintech', 'fintech startups'], ['payments', 'fintech startups'],
    ['banking', 'fintech startups'], ['insurance', 'insurance companies'],
    ['ecommerce', 'ecommerce brands'], ['e-commerce', 'ecommerce brands'],
    ['retail', 'ecommerce brands'], ['logistics', 'logistics companies'],
    ['security', 'cybersecurity companies'], ['health', 'healthcare companies'],
    ['medical', 'healthcare companies'], ['real estate', 'real estate agencies'],
    ['legal', 'law firms'], ['recruit', 'recruiting agencies'],
    ['staffing', 'recruiting agencies'], ['education', 'education companies'],
    ['saas', 'SaaS startups'], ['software', 'SaaS startups'],
    ['marketing', 'marketing agencies'], ['agency', 'marketing agencies'],
    ['ai ', 'AI startups'],
  ];
  const seen = new Set();
  const industries = [];
  const pushIndustry = (kw) => { if (!seen.has(kw) && industries.length < 3) { seen.add(kw); industries.push(kw); } };
  for (const t of info.ldTypes) {
    const spaced = String(t).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    for (const [cue, kw] of INDUSTRY_CUES) if (spaced.includes(cue)) pushIndustry(kw);
  }
  for (const [cue, kw] of INDUSTRY_CUES) if (high.includes(cue)) pushIndustry(kw);
  for (const [cue, kw] of INDUSTRY_CUES) { if (industries.length >= 2) break; if (text.includes(cue)) pushIndustry(kw); }
  // Last resort: the scanned domain — builtin/Hunter search treats keywords
  // as domains, and its own employees are still better than an empty form.
  const keywords = industries.join(', ') || domain;

  // Job title: look for who the site sells to, else fall back by company size.
  let title = '';
  for (const p of BUYER_PERSONAS) { if (p.re.test(text)) { title = p.title; break; } }

  // Company size: explicit language only — inferred before title fallback.
  let size = '';
  if (/\b(enterprise|fortune 500|global enterprises|multinational|enterprise-grade)\b/.test(text)) size = '1001,10000';
  else if (/\b(solo|freelance|indie|bootstrap|solopreneur)s?\b/.test(text)) size = '1,10';
  else if (/\b(mid-market|smb|small business|startup|scale-up|early-stage)s?\b/.test(text)) size = '11,50';
  if (!title) title = size === '1001,10000' ? 'head of sales' : 'founder';

  // Location: contact/about pages carry the real HQ city; homepage claims
  // like "trusted worldwide" must not win over an actual address.
  const US_CITY = /\b(new york|san francisco|silicon valley|austin|boston|chicago|los angeles|seattle|miami|denver|atlanta)\b/;
  const UK_CITY = /\b(london|manchester|edinburgh)\b/;
  const EU_CITY = /\b(berlin|paris|amsterdam|dublin|barcelona|stockholm|lisbon|madrid)\b/;
  const ASIA_CITY = /\b(singapore|hong kong|tokyo|sydney|bangalore|bengaluru|mumbai|delhi)\b/;
  let location = '';
  if (US_CITY.test(extraText)) location = 'United States';
  else if (UK_CITY.test(extraText)) location = 'United Kingdom';
  else if (EU_CITY.test(extraText)) location = 'Europe';
  else if (ASIA_CITY.test(extraText)) location = 'Asia';
  else if (/\b(united states|us-based|u\.s\.|america)\b/.test(extraText)) location = 'United States';
  else if (US_CITY.test(text)) location = 'United States';
  else if (/\b(uk|united kingdom|britain)\b/.test(extraText) || UK_CITY.test(text)) location = 'United Kingdom';
  else if (EU_CITY.test(text) || /\beurope\b/.test(extraText)) location = 'Europe';
  else if (ASIA_CITY.test(text) || /\b(asia|apac|japan|australia|india)\b/.test(extraText)) location = 'Asia';

  return { keywords, title, size, location };
}

// Fetch /about and /contact (best-effort) for HQ address and team-size cues
// the homepage rarely carries. Merged lowercase text, '' on failure.
async function fetchAboutContactText(domain) {
  const parts = [];
  for (const p of ['/about', '/contact', '/company']) {
    try {
      const extra = await fetchSite(`https://${domain}${p}`);
      parts.push(extra.title + ' ' + extra.desc + ' ' + extra.text);
    } catch { /* page missing — skip */ }
  }
  return parts.join(' ').toLowerCase().slice(0, 6000);
}

async function inferIcpFromSite(domain) {
  let info;
  try {
    info = await fetchSite(domain);
  } catch {
    return null;
  }

  const key = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (key) {
    try {
      const base = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const model = process.env.LLM_MODEL || 'gpt-4o-mini';
      const llmRes = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'You help sales teams find their ideal customer profile (ICP). Given a company website, infer who the company SELLS TO — its customers, not the company itself. Fill lead-finder fields: keywords (the target market, industry, or complementary companies to search — NEVER the company\'s own domain), title (typical buyer job title), size (typical customer company size bucket like "11-50" or "1001-10000"), location (typical geography). Return ONLY JSON: {"keywords":"...","title":"...","size":"...","location":"..."} — each a short phrase, no sentences. Keep keywords to 2-4 words.' },
            { role: 'user', content: JSON.stringify({ url: info.url, title: info.title, description: info.desc, headings: info.h1s, types: info.ldTypes, text: info.text.slice(0, 2000) }) },
          ],
          temperature: 0.3, max_tokens: 120,
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (!llmRes.ok) throw new Error(`LLM ${llmRes.status}`);
      const llmData = await llmRes.json();
      const raw = llmData.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(raw);
      const prefill = {
        keywords: (parsed.keywords || '').slice(0, 200),
        title: (parsed.title || '').slice(0, 120),
        size: normSize(parsed.size),
        location: (parsed.location || '').slice(0, 120),
      };
      // Reject an LLM fill that just echoes the scanned site — searching it
      // would return the user's own employees instead of their customers.
      const bareDomain = String(domain).toLowerCase().replace(/^www\./, '');
      const kwNorm = prefill.keywords.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '').trim();
      if (kwNorm === bareDomain) prefill.keywords = '';
      if (prefill.keywords) return { prefill, source: 'llm', siteTitle: info.title };
    } catch { /* LLM failed — fall through to heuristic */ }
  }

  try {
    const extraText = await fetchAboutContactText(domain);
    return { prefill: heuristicIcp(info, domain, extraText), source: 'heuristic', siteTitle: info.title };
  } catch {
    return null;
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
  trial: { name: 'Free trial', priceMonthly: 0, maxProspects: 100, maxCampaigns: 1, trialDays: 14, leadFinderCredits: 25, linkedIn: false, agency: false, whiteLabel: false },
  starter: { name: 'Starter', priceMonthly: 29, maxProspects: 2000, maxCampaigns: 3, leadFinderCredits: 100, linkedIn: false, agency: false, whiteLabel: false },
  growth: { name: 'Growth', priceMonthly: 49, maxProspects: 10000, maxCampaigns: 10, leadFinderCredits: 1000, linkedIn: true, agency: false, whiteLabel: false },
  scale: { name: 'Scale', priceMonthly: 99, maxProspects: Infinity, maxCampaigns: Infinity, leadFinderCredits: 10000, linkedIn: true, agency: false, whiteLabel: true },
  agency: { name: 'Agency', priceMonthly: 249, maxProspects: Infinity, maxCampaigns: Infinity, leadFinderCredits: 10000, linkedIn: true, agency: true, whiteLabel: true },
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
    'line_items[0][price_data][product_data][name]': `Outrovo ${PLANS[planId].name}`,
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
// When all sender inboxes are capped, prospects retry after this long instead
// of failing the step.
const CAP_RETRY_MS = Number(process.env.CAP_RETRY_MS || 3600000);
function engineTick() {
  const campaigns = load('campaigns');
  const prospects = load('prospects');
  let tasks = load('tasks');
  const now = Date.now();
  let changed = false;

  for (const campaign of campaigns.filter(c => c.status === 'active')) {
    const owner = campaign.owner ? load('users').find(u => u.email === campaign.owner) : null;
    const inWindow = campaignWindowOk(campaign);
    // Sends are dispatched async, so the on-disk counter lags within a tick.
    // Count in-flight dispatches too, otherwise a burst blows past the cap.
    let dispatchedThisTick = 0;
    for (const prospect of prospects.filter(p => p.campaignId === campaign.id)) {
      if (prospect.finished || !prospect.nextRunAt || prospect.nextRunAt > now) continue;
      const step = campaign.steps[prospect.stepIndex];
      if (!step) { prospect.finished = true; changed = true; continue; }

      if (step.type === 'email') {
        // Opted out since enrollment → stop quietly.
        if (campaign.owner && isSuppressed(campaign.owner, prospect.email)) {
          prospect.finished = true; prospect.nextRunAt = null; prospect.suppressed = true;
          changed = true;
          continue;
        }
        // Replied prospects: exit the sequence UNLESS this step explicitly
        // routes replies into a hot-follow-up branch (event-driven). The
        // reroute consumes the event, then re-checks the sequence continues
        // from the routed position (not an infinite hot-step loop).
        if (prospect.replied && !prospect.branchConsumedReply) {
          const hotLabel = step.branchNext?.onReplied;
          const hotIdx = hotLabel ? campaign.steps.findIndex(s => s.label === hotLabel) : -1;
          if (hotIdx >= 0) {
            prospect.stepIndex = hotIdx;
            prospect.branchConsumedReply = true;
            prospect.nextRunAt = now;
            changed = true;
            continue;
          }
          prospect.finished = true; prospect.nextRunAt = null;
          changed = true;
          continue;
        }
        if (prospect.replied && prospect.branchConsumedReply) {
          // After the hot step, treat replies the same as no-reply for
          // subsequent routing — otherwise every later step exits early.
          prospect.replied = false;
        }
        // Campaign pacing: outside the send window or past the daily cap →
        // defer, don't fail.
        if (!inWindow || campaignUsedToday(campaign) + dispatchedThisTick >= campaignDailyCap(campaign)) {
          prospect.nextRunAt = now + CAP_RETRY_MS;
          changed = true;
          continue;
        }
        const sender = campaign.owner ? pickSender(campaign.owner, prospect) : gatewaySender();
        if (!sender) {
          // Every inbox capped for today: retry this prospect later, keep step.
          prospect.nextRunAt = now + CAP_RETRY_MS;
          changed = true;
          continue;
        }
        dispatchedThisTick++;
        sendEmail(campaign, prospect, step).catch(err => {
          const kind = classifySendError(err);
          if (kind === 'hard') {
            prospect.bounced = { kind: 'hard', at: new Date().toISOString(), reason: err.message.slice(0, 200) };
            prospect.finished = true; prospect.nextRunAt = null;
            recordCampaignSend(campaign.id, true);
            logEvent('bounce', `Hard bounce: ${prospect.email} — sequence stopped`, { reason: err.message.slice(0, 200) });
            if (campaign.owner) fireWebhooks(campaign.owner, 'bounce', { email: prospect.email, campaign: campaign.name, reason: err.message.slice(0, 200) });
          } else if (kind === 'soft' && Number(prospect.softRetries || 0) < SOFT_MAX_RETRIES) {
            // stepIndex already advanced below — rewind so the retry re-runs
            // this email step rather than skipping ahead.
            prospect.stepIndex -= 1;
            prospect.softRetries = Number(prospect.softRetries || 0) + 1;
            prospect.nextRunAt = Date.now() + SOFT_RETRY_MS;
            logEvent('soft-bounce', `Soft bounce: ${prospect.email} — retry ${prospect.softRetries}/${SOFT_MAX_RETRIES} in 30 min`);
          } else {
            logEvent('error', `Send failed to ${prospect.email}: ${err.message}`);
          }
          save('prospects', load('prospects').map(p => p.id === prospect.id ? prospect : p));
        });
      } else if (step.type === 'task') {
        // LinkedIn safety: plan gate + daily action budget (owner-scoped;
        // legacy ownerless campaigns keep the old unguarded behavior).
        // Over budget → defer the prospect, never drop the task.
        const plan = owner ? planOf(owner) : null;
        if (plan && !plan.linkedIn) {
          logEvent('task', `LinkedIn step skipped for ${prospect.email} — ${plan.name} plan has no LinkedIn actions`);
        } else if (campaign.owner && linkedinUsedToday(campaign.owner) >= linkedinBudget(owner)) {
          prospect.nextRunAt = now + CAP_RETRY_MS;
          changed = true;
          continue;
        } else {
          // Paced surfacing: the task becomes due at a random point within the
          // spread window instead of instantly, so action patterns stay human.
          const dueAt = now + Math.round(Math.random() * LINKEDIN_SPREAD_HOURS * 3600000);
          tasks.unshift({
            id: crypto.randomUUID(), kind: 'linkedin', taskKind: step.taskKind || 'connect',
            note: personalize(step.note, prospect), prospect: prospect.email,
            campaign: campaign.name, owner: campaign.owner || null,
            done: false, dueAt, at: new Date().toISOString(),
          });
          logEvent('task', `LinkedIn task for ${prospect.email}: ${personalize(step.note, prospect)}`);
        }
      }
      // Event-driven branching: after this step executes, engagement events
      // captured since it sent re-route the prospect to a labeled step.
      // Missing events/labels fall through to the next step in order.
      if (step.branchNext && typeof step.branchNext === 'object') {
        prospect.stepIndex = resolveNextIndex(campaign, prospect);
      } else {
        prospect.stepIndex += 1;
      }
      const nextStep = campaign.steps[prospect.stepIndex];
      if (!nextStep) { prospect.finished = true; prospect.nextRunAt = null; }
      else {
        // Organic spread: +/- 20% jitter on step delays so sends don't fire
        // in machine-tight bursts.
        const delay = (nextStep.delayMinutes || 0) * 60000;
        prospect.nextRunAt = now + Math.round(delay * (0.8 + Math.random() * 0.4));
      }
      changed = true;
    }
  }
  if (changed) { save('prospects', prospects); save('tasks', tasks); }
  autopilotRun().catch(() => {});
}
// Long-lived local server ticks forever; serverless functions must not start
// unmanaged background loops, so on Vercel the engine only runs on-demand
// (triggered by POSTs and lazy ticks via /api/app/engine/tick).
if (!process.env.VERCEL) setInterval(engineTick, ENGINE_INTERVAL_MS).unref();

// ---------- tools ----------
async function verifyEmail(email) {
  const syntax = isEmail(email);
  const result = { email, syntax, mx: null, verdict: 'invalid', catchAll: null };
  if (!syntax) return result;
  const domain = email.split('@')[1];
  try {
    const mx = await dns.resolveMx(domain);
    result.mx = mx.length ? mx.map(m => m.exchange).slice(0, 3) : [];
  } catch { result.mx = []; }
  result.verdict = result.mx && result.mx.length ? 'deliverable' : 'undeliverable';
  // Catch-all heuristic: probe a randomized nonexistent local part against
  // the primary MX. Accepting everything → the domain accepts any mailbox,
  // so per-address verdicts are unreliable (accept-all).
  if (result.mx?.length && nodemailer) {
    try {
      const mxHost = (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority)[0]?.exchange;
      const sock = await smtpProbe(mxHost, domain, `oc-probe-${crypto.randomBytes(8).toString('hex')}@${domain}`);
      result.catchAll = sock === true ? true : sock === false ? false : null;
    } catch { result.catchAll = null; }
  }
  return result;
}

// Minimal SMTP RCPT probe with hard timeouts. Returns true = accepted
// (catch-all), false = rejected (550), null = inconclusive.
function smtpProbe(mxHost, domain, probeAddress) {
  return new Promise(resolve => {
    const net = require('net');
    const sock = net.createConnection(25, mxHost);
    let stage = 0; // 0 connect, 1 ehlo, 2 mailfrom, 3 rcpt
    const done = v => { try { sock.destroy(); } catch {} resolve(v); };
    const timer = setTimeout(() => done(null), 5000);
    const finish = v => { clearTimeout(timer); done(v); };
    sock.setEncoding('utf8');
    sock.on('data', data => {
      const code = data.slice(0, 3);
      if (stage === 0) { sock.write(`EHLO ${domain}\r\n`); stage = 1; }
      else if (stage === 1) { sock.write(`MAIL FROM:<verify@${domain}>\r\n`); stage = 2; }
      else if (stage === 2) { sock.write(`RCPT TO:<${probeAddress}>\r\n`); stage = 3; }
      else if (stage === 3) { finish(code.startsWith('2') ? true : code.startsWith('5') ? false : null); }
    });
    sock.on('error', () => finish(null));
  });
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
    // Onboarding diagnostic: audit the signup domain right away so the first
    // settings visit shows a ready result instead of a spinner.
    domainAudit(email.split('@')[1])
      .then(result => logEvent('domain-audit', `Domain check for ${result.domain}: score ${result.score}/100`, { score: result.score, checks: result.checks }))
      .catch(() => {});
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
    if (!user) return send(res, 200, { ok: true, user: null, engine: engineMode(session?.email) });
    const plan = planOf(user);
    send(res, 200, { ok: true, user: publicUser(user), plan: { id: user.plan || 'trial', name: plan.name, priceMonthly: plan.priceMonthly, maxProspects: plan.maxProspects, maxCampaigns: plan.maxCampaigns, linkedIn: plan.linkedIn, trialEnds: user.trialEnds, expired: plan.expired || false }, engine: engineMode(session?.email) });
  },

  'GET /api/signups': (req, res) => {
    if (!adminOk(req)) return send(res, 403, { ok: false, error: 'Forbidden' });
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
    if (!isWebhook && !adminOk(req)) return send(res, 403, { ok: false, error: 'Forbidden' });
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

  // --- one-click unsubscribe (public, HMAC-signed) ---
  // GET = link click from a mail client/browser, POST = RFC 8058 one-click
  // from the mailbox provider's unsubscribe button.
  'GET /api/unsubscribe': (req, res, _id, query) => {
    const u = (query?.get('u') || '').toLowerCase();
    const e = (query?.get('e') || '').toLowerCase();
    const t = query?.get('t') || '';
    const okToken = u && e && t === unsubToken(u, e);
    if (okToken) suppressEmail(u, e, 'unsubscribe-link');
    const title = okToken ? "You've been unsubscribed" : 'Invalid unsubscribe link';
    const msg = okToken
      ? `${e} will no longer receive emails from this sender.`
      : 'This link is invalid or has expired. Ask the sender to remove you manually.';
    res.writeHead(okToken ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
      <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f7f7f8;color:#0b0c0e}
      .card{background:#fff;border:1px solid #e4e6ea;border-radius:16px;padding:40px;max-width:420px;text-align:center}</style></head>
      <body><div class="card"><h1 style="font-size:1.3rem">${title}</h1><p>${msg}</p></div></body></html>`);
  },

  'POST /api/unsubscribe': async (req, res, _id, query) => {
    const b = await readBody(req).catch(() => ({}));
    const u = (query?.get('u') || b.u || '').toLowerCase();
    const e = (query?.get('e') || b.e || '').toLowerCase();
    const t = query?.get('t') || b.t || '';
    if (!u || !e || t !== unsubToken(u, e)) return send(res, 403, { ok: false, error: 'Invalid token' });
    suppressEmail(u, e, 'one-click');
    send(res, 200, { ok: true });
  },

  // --- suppression list management ---
  'GET /api/app/suppression': (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    send(res, 200, { ok: true, suppressed: suppressionList(session.email) });
  },

  'POST /api/app/suppression': async (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const b = await readBody(req);
    const email = (b.email || '').trim().toLowerCase();
    if (!isEmail(email)) return send(res, 400, { ok: false, error: 'Valid email required.' });
    suppressEmail(session.email, email, 'manual');
    send(res, 200, { ok: true, suppressed: suppressionList(session.email) });
  },

  'DELETE /api/app/suppression/:id': (req, res, id) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const email = decodeURIComponent(id).toLowerCase();
    const users = load('users');
    const user = users.find(u => u.email === session.email);
    if (!user) return send(res, 404, { ok: false });
    user.suppressed = (user.suppressed || []).filter(s => s.email !== email);
    save('users', users);
    send(res, 200, { ok: true });
  },

  // --- agency: client accounts & consolidated billing ---
  'GET /api/app/agency/clients': (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const user = load('users').find(u => u.email === session.email);
    if (!planOf(user).agency) return send(res, 403, { ok: false, error: 'Agency plan required.' });
    const clients = agencyStats(session.email);
    const agencyPlan = planOf(user);
    send(res, 200, {
      ok: true,
      clients,
      billing: {
        agencyPlan: agencyPlan.name, agencyPrice: agencyPlan.priceMonthly,
        seats: clients.length,
        clientMrr: clients.reduce((acc, c) => acc + Number(PLANS[c.planId]?.priceMonthly || 0), 0),
        seatChargeMonthly: clients.length * 49,
        consolidatedTotal: agencyPlan.priceMonthly + clients.length * 49,
      },
    });
  },

  'POST /api/app/agency/clients': async (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const agencyUser = load('users').find(u => u.email === session.email);
    if (!planOf(agencyUser).agency) return send(res, 403, { ok: false, error: 'Agency plan required.' });
    const b = await readBody(req);
    const email = (b.email || '').trim().toLowerCase();
    if (!isEmail(email) || !b.firstName?.trim() || !b.company?.trim()) return send(res, 400, { ok: false, error: 'firstName, company and a valid email are required.' });
    const users = load('users');
    if (users.some(u => u.email === email)) return send(res, 409, { ok: false, error: 'That email already has an account.' });
    const password = b.password && b.password.length >= 8 ? b.password : `ov-${crypto.randomBytes(6).toString('hex')}`;
    const { salt, hash } = hashPassword(password);
    const planId = PLANS[b.plan] && b.plan !== 'trial' ? b.plan : 'trial';
    const client = {
      id: crypto.randomUUID(), firstName: b.firstName.trim(), lastName: (b.lastName || '').trim(),
      email, company: b.company.trim(), salt, hash, plan: planId,
      trialEnds: planId === 'trial' ? new Date(Date.now() + 14 * 864e5).toISOString() : null,
      owner: session.email, whiteLabel: b.whiteLabel && typeof b.whiteLabel === 'object' ? b.whiteLabel : null,
      createdAt: new Date().toISOString(),
    };
    users.push(client); save('users', users);
    logEvent('agency', `Client account created: ${email} (${client.company})`);
    send(res, 201, { ok: true, client: { email, name: `${client.firstName} ${client.lastName}`.trim(), company: client.company, plan: planId, tempPassword: b.password ? undefined : password } });
  },

  'POST /api/app/agency/clients/:id/plan': async (req, res, id) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const agencyUser = load('users').find(u => u.email === session.email);
    if (!planOf(agencyUser).agency) return send(res, 403, { ok: false, error: 'Agency plan required.' });
    const b = await readBody(req);
    if (!PLANS[b.plan]) return send(res, 400, { ok: false, error: 'Unknown plan' });
    const users = load('users');
    const client = users.find(u => u.email === decodeURIComponent(id).toLowerCase() && u.owner === session.email);
    if (!client) return send(res, 404, { ok: false, error: 'Client not found' });
    client.plan = b.plan;
    client.trialEnds = null;
    save('users', users);
    logEvent('billing', `Client ${client.email} → ${PLANS[b.plan].name} (billed to agency)`);
    send(res, 200, { ok: true, client: { email: client.email, plan: b.plan } });
  },

  'DELETE /api/app/agency/clients/:id': (req, res, id) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const email = decodeURIComponent(id).toLowerCase();
    const users = load('users');
    const client = users.find(u => u.email === email && u.owner === session.email);
    if (!client) return send(res, 404, { ok: false, error: 'Client not found' });
    const keep = { ...client, owner: null }; // orphan, don't delete their data
    save('users', users.map(u => u.email === email ? keep : u));
    logEvent('agency', `Client detached: ${email}`);
    send(res, 200, { ok: true });
  },

  // --- white-label: CNAME + logo + branded reporting ---
  'POST /api/app/white-label': async (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const users = load('users');
    const user = users.find(u => u.email === session.email);
    if (!user) return send(res, 404, { ok: false });
    if (!planOf(user).whiteLabel) return send(res, 403, { ok: false, error: 'White-label requires Scale or Agency plan.' });
    const b = await readBody(req);
    user.whiteLabel = {
      brandName: (b.brandName || '').trim().slice(0, 60),
      logoUrl: (b.logoUrl || '').trim().slice(0, 500),
      cname: (b.cname || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').slice(0, 120),
      accentColor: /^#[0-9a-f]{6}$/i.test(b.accentColor || '') ? b.accentColor : null,
      updatedAt: new Date().toISOString(),
    };
    save('users', users);
    send(res, 200, { ok: true, whiteLabel: user.whiteLabel });
  },

  // Branded, shareable report. ?token= (agency's admin key via header) OR
  // session auth as the owner. ?c=<clientEmail> picks one client (agency).
  'GET /api/reports/branded': (req, res, _id, query) => {
    const session = getSession(req);
    const adminHeader = req.headers['x-admin-key'];
    let ownerEmail = session?.email || null;
    if (!ownerEmail && adminHeader && adminOk(req)) {
      ownerEmail = (query?.get('u') || '').toLowerCase() || null;
    }
    if (!ownerEmail) return send(res, 401, { ok: false });
    const clientFilter = (query?.get('c') || '').toLowerCase() || null;
    const user = load('users').find(u => u.email === ownerEmail);
    const wl = user?.whiteLabel || {};
    const brand = wl.brandName || user?.company || 'Outrovo';
    const campaigns = load('campaigns');
    const prospects = load('prospects');
    const targets = clientFilter && clientsOf(ownerEmail).some(c => c.email === clientFilter)
      ? [clientFilter] : [ownerEmail, ...clientsOf(ownerEmail).map(c => c.email)];
    const rows = targets.map(owner => {
      const mine = campaigns.filter(c => c.owner === owner);
      const ids = new Set(mine.map(c => c.id));
      const mineProspects = prospects.filter(p => ids.has(p.campaignId));
      return {
        owner,
        campaigns: mine.length, active: mine.filter(c => c.status === 'active').length,
        prospects: mineProspects.length,
        sent: mine.reduce((a, c) => a + Number(c.sentCount || 0), 0),
        bounced: mineProspects.filter(p => p.bounced).length,
        replied: mineProspects.filter(p => p.replied).length,
      };
    });
    const accent = wl.accentColor || '#f97316';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${brand} — outreach report</title>
<style>body{font-family:system-ui,sans-serif;background:#f7f7f8;margin:0;padding:40px;color:#0b0c0e}
.wrap{max-width:760px;margin:0 auto}.brand{display:flex;align-items:center;gap:12px;margin-bottom:24px}
.brand img{height:36px}.card{background:#fff;border:1px solid #e4e6ea;border-radius:16px;padding:24px;margin-bottom:16px}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #e4e6ea;font-size:0.92rem}
th{color:#8a9199;font-weight:600}.pill{background:${accent};color:#fff;padding:2px 10px;border-radius:999px;font-size:0.75rem;font-weight:700}
h1{font-size:1.4rem;margin:0}</style></head><body><div class="wrap">
<div class="brand">${wl.logoUrl ? `<img src="${wl.logoUrl}" alt="${brand}">` : ''}<h1>${brand} — outreach report</h1><span class="pill">${new Date().toISOString().slice(0, 10)}</span></div>
${rows.map(r => `<div class="card"><h3 style="margin-top:0">${r.owner}</h3><table>
<tr><th>Campaigns</th><th>Active</th><th>Prospects</th><th>Sent</th><th>Bounced</th><th>Replies</th></tr>
<tr><td>${r.campaigns}</td><td>${r.active}</td><td>${r.prospects}</td><td>${r.sent}</td><td>${r.bounced}</td><td>${r.replied}</td></tr></table></div>`).join('')}
</div></body></html>`);
  },

  // --- enrichment ---
  'POST /api/app/prospects/:id/enrich': async (req, res, id) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const prospects = load('prospects');
    const p = prospects.find(x => x.id === id);
    if (!p) return send(res, 404, { ok: false, error: 'Not found' });
    try {
      const enriched = await callEnrichment(p.email, { firstName: p.firstName, lastName: p.lastName });
      p.enriched = enriched;
      if (enriched.firstName && !p.firstName) p.firstName = enriched.firstName;
      if (enriched.lastName && !p.lastName) p.lastName = enriched.lastName;
      if (enriched.company && !p.company) p.company = enriched.company;
      save('prospects', prospects);
      send(res, 200, { ok: true, enriched });
    } catch (err) {
      send(res, 502, { ok: false, error: err.message });
    }
  },

  'POST /api/app/campaigns/:id/enrich-all': async (req, res, id) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const prospects = load('prospects');
    const mine = prospects.filter(p => p.campaignId === id && !p.enriched);
    let done = 0, failed = 0;
    for (const p of mine.slice(0, 50)) { // batch cap per call
      try {
        p.enriched = await callEnrichment(p.email, { firstName: p.firstName, lastName: p.lastName });
        if (p.enriched.firstName && !p.firstName) p.firstName = p.enriched.firstName;
        if (p.enriched.lastName && !p.lastName) p.lastName = p.enriched.lastName;
        if (p.enriched.company && !p.company) p.company = p.enriched.company;
        done++;
      } catch { failed++; }
    }
    save('prospects', prospects);
    send(res, 200, { ok: true, enriched: done, failed, remaining: mine.length - done - failed, provider: enrichmentProvider() || 'builtin' });
  },

  // --- pre-sequence verification gate (incl. catch-all) ---
  'POST /api/app/campaigns/:id/verify-all': async (req, res, id) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const b = await readBody(req).catch(() => ({}));
    const prospects = load('prospects');
    const mine = prospects.filter(p => p.campaignId === id && !p.finished);
    let deliverable = 0, undeliverable = 0, acceptAll = 0, checked = 0;
    for (const p of mine.slice(0, 100)) { // batch cap per call
      const v = await verifyEmail(p.email);
      p.verified = v;
      checked++;
      if (v.verdict === 'deliverable' && v.catchAll !== true) deliverable++;
      else if (v.catchAll === true) acceptAll++;
      else undeliverable++;
      // Gate: undeliverable addresses are pulled out of the sequence before
      // it runs. Accept-all stays in but is flagged risky.
      if (v.verdict !== 'deliverable') { p.finished = true; p.nextRunAt = null; p.skipped = 'undeliverable'; }
    }
    save('prospects', prospects);
    logEvent('verify', `Verification gate: ${checked} checked → ${deliverable} ok, ${acceptAll} accept-all, ${undeliverable} removed`);
    send(res, 200, { ok: true, checked, deliverable, acceptAll, undeliverable });
  },

  // --- click tracking (feeds conditional branches) ---
  'GET /api/t/:id': (req, res, id, query) => {
    const url = (query?.get('u') || '').trim();
    if (!/^https?:\/\//i.test(url)) return send(res, 400, { ok: false, error: 'url required' });
    const prospects = load('prospects');
    const p = prospects.find(x => x.id === id);
    if (p) {
      p.clicks = p.clicks || [];
      p.clicks.push({ url, at: new Date().toISOString() });
      p.clicked = true;
      save('prospects', prospects);
      logEvent('click', `${p.email} clicked ${url.slice(0, 80)}`);
      const campaign = load('campaigns').find(c => c.id === p.campaignId);
      if (campaign?.owner) fireWebhooks(campaign.owner, 'click', { email: p.email, url, campaign: campaign.name });
    }
    res.writeHead(302, { Location: url });
    res.end();
  },

  // --- AI context-aware reply drafts ---
  'POST /api/app/inbox/:id/draft': async (req, res, id) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const b = await readBody(req).catch(() => ({}));
    const replies = load('replies');
    const reply = replies.find(r => r.id === id && (!r.owner || r.owner === session.email));
    if (!reply) return send(res, 404, { ok: false, error: 'Not found' });
    const user = load('users').find(u => u.email === session.email);
    const key = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
    let draft, source = 'heuristic';
    if (key) {
      try {
        const base = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const model = process.env.LLM_MODEL || 'gpt-4o-mini';
        const r = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model, temperature: 0.7, max_tokens: 220,
            messages: [
              { role: 'system', content: `You write short, human cold-outreach replies on behalf of ${user?.firstName || 'the sender'} at ${user?.company || 'their company'}. Reply to the prospect's message directly, keep it under 90 words, no fluff, one clear next step. Intent of their reply: ${reply.intent || 'unknown'}.` },
              { role: 'user', content: `Their reply:\nSubject: ${reply.subject}\n${String(reply.body || '').slice(0, 1000)}\n\nInstruction: ${b.instruction || 'draft a reply'}` },
            ],
          }),
        });
        const data = await r.json();
        draft = data.choices?.[0]?.message?.content?.trim();
        if (draft) source = 'llm';
      } catch {}
    }
    if (!draft) {
      // Heuristic draft by intent — the UI labels which mode answered.
      const name = reply.prospect?.split(' ')[0] || 'there';
      const byIntent = {
        interested: `Hi ${name},\n\nGreat — glad it resonated. Here's a link to grab 15 minutes on my calendar: [booking link]. If easier, happy to send a short loom first.\n\nBest,\n${user?.firstName || ''}`,
        question: `Hi ${name},\n\nGood question — short answer: [answer]. Happy to walk you through it live; 15 minutes is plenty. What does your week look like?\n\nBest,\n${user?.firstName || ''}`,
        not_interested: `Hi ${name},\n\nTotally understand — thanks for the quick reply. I'll close the loop on my end. If priorities change, the door's open.\n\nBest,\n${user?.firstName || ''}`,
        out_of_office: `Hi ${name},\n\nNo rush — I'll follow up when you're back. Enjoy the time off!\n\nBest,\n${user?.firstName || ''}`,
        neutral: `Hi ${name},\n\nThanks for getting back to me. Quick context: we help teams like ${user?.company || 'yours'} with [value prop]. Worth a 15-minute look?\n\nBest,\n${user?.firstName || ''}`,
      };
      draft = byIntent[reply.intent] || byIntent.neutral;
    }
    reply.draft = { text: draft, source, at: new Date().toISOString() };
    save('replies', replies);
    send(res, 200, { ok: true, draft, source });
  },

  // --- CRM / automation integrations (outbound webhooks) ---
  'GET /api/app/integrations/webhooks': (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const user = load('users').find(u => u.email === session.email);
    const hooks = (user?.integrations || []).map(i => ({ ...i, secret: i.secret ? '•••' : null }));
    send(res, 200, { ok: true, webhooks: hooks, events: INTEGRATION_EVENTS });
  },

  'POST /api/app/integrations/webhooks': async (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const b = await readBody(req);
    if (!/^https?:\/\//i.test(b.url || '')) return send(res, 400, { ok: false, error: 'Webhook URL required (HTTPS for production, HTTP only allowed for localhost testing).' });
    const users = load('users');
    const user = users.find(u => u.email === session.email);
    if (!user) return send(res, 404, { ok: false });
    user.integrations = user.integrations || [];
    if (user.integrations.length >= 10) return send(res, 400, { ok: false, error: 'Max 10 webhooks.' });
    const hook = {
      id: crypto.randomUUID(),
      provider: ['hubspot', 'pipedrive', 'salesforce', 'zapier'].includes(b.provider) ? b.provider : 'webhook',
      url: b.url.trim(),
      secret: b.secret ? String(b.secret).slice(0, 100) : null,
      events: Array.isArray(b.events) && b.events.length ? b.events.filter(e => INTEGRATION_EVENTS.includes(e)) : [...INTEGRATION_EVENTS, 'click'],
      createdAt: new Date().toISOString(),
    };
    user.integrations.push(hook);
    save('users', users);
    send(res, 201, { ok: true, webhook: { ...hook, secret: hook.secret ? '•••' : null } });
  },

  'DELETE /api/app/integrations/webhooks/:id': (req, res, id) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const users = load('users');
    const user = users.find(u => u.email === session.email);
    if (!user) return send(res, 404, { ok: false });
    user.integrations = (user.integrations || []).filter(i => i.id !== id);
    save('users', users);
    send(res, 200, { ok: true });
  },

  'POST /api/app/integrations/webhooks/:id/test': async (req, res, id) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const user = load('users').find(u => u.email === session.email);
    const hook = (user?.integrations || []).find(i => i.id === id);
    if (!hook) return send(res, 404, { ok: false, error: 'Not found' });
    try {
      const body = JSON.stringify({ event: 'test', provider: hook.provider, at: new Date().toISOString(), data: { message: 'Outrovo webhook test', user: session.email } });
      const headers = { 'Content-Type': 'application/json', 'User-Agent': 'Outrovo-Webhooks/1.0' };
      if (hook.secret) headers['X-Outrovo-Signature'] = crypto.createHmac('sha256', hook.secret).update(body).digest('hex');
      const r = await fetch(hook.url, { method: 'POST', headers, body });
      send(res, 200, { ok: true, status: r.status });
    } catch (err) {
      send(res, 502, { ok: false, error: err.message });
    }
  },

  // --- app (auth required) ---
  // --- lead finder ---
  'GET /api/app/lead-finder/status': (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const users = load('users');
    const user = users.find(u => u.email === session.email);
    const plan = planOf(user);
    const usage = leadFinderUsage(user, plan);
    const users2 = load('users');
    const idx = users2.findIndex(u => u.email === session.email);
    if (idx >= 0) { users2[idx].leadFinder = user.leadFinder; save('users', users2); }
    // Seed the form: the signup domain audit (hunter.io / company website)
    // is reused as a "search my own market" hint when autopilot hasn't been
    // configured yet.
    const seed = user.leadFinderAutopilot?.keywords
      ? null
      : { keywords: (session.email.split('@')[1] || '').slice(0, 120) };
    send(res, 200, {
      ok: true, provider: leadFinderProvider() || 'builtin',
      used: usage.used, quota: usage.quota, month: usage.month,
      autopilot: user.leadFinderAutopilot || null, seed,
    });
  },

  // Scan the user's own website (from their signup email domain) and infer
  // their ICP: keywords, job title, company size, location.
  'GET /api/app/lead-finder/prefill': async (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const domain = session.email.split('@')[1] || '';
    if (!domain) return send(res, 200, { ok: true, prefill: null });
    const result = await inferIcpFromSite(domain);
    send(res, 200, { ok: true, ...(result || { prefill: null }) });
  },

  // Same inference, but for an arbitrary URL the user pastes into the
  // "Your company website" field next to ✦ Scan & fill in Lead Finder.
  'POST /api/app/lead-finder/scan-fill': async (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const body = await readBody(req);
    const rawUrl = String(body?.url || '').trim().slice(0, 300);
    if (!rawUrl) return send(res, 400, { ok: false, error: 'Enter your company website first.' });
    const domain = rawUrl.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(domain)) {
      return send(res, 400, { ok: false, error: 'That does not look like a website — try yourcompany.com' });
    }
    try {
      const result = await inferIcpFromSite(domain);
      if (!result || !result.prefill?.keywords) {
        return send(res, 502, { ok: false, error: 'Could not read that site — check the URL or fill manually.' });
      }
      send(res, 200, { ok: true, ...result });
    } catch {
      send(res, 502, { ok: false, error: 'Could not read that site — check the URL or fill manually.' });
    }
  },

  'PUT /api/app/lead-finder/autopilot': async (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const b = await readBody(req);
    const users = load('users');
    const user = users.find(u => u.email === session.email);
    if (!user) return send(res, 404, { ok: false, error: 'User not found' });
    const enabled = !!b.enabled;
    const ap = {
      enabled,
      keywords: (b.keywords || user.leadFinderAutopilot?.keywords || '').slice(0, 200),
      title: (b.title || user.leadFinderAutopilot?.title || '').slice(0, 120),
      size: b.size || user.leadFinderAutopilot?.size || '',
      location: (b.location || user.leadFinderAutopilot?.location || '').slice(0, 120),
      campaignId: b.campaignId || user.leadFinderAutopilot?.campaignId || '',
      dailyLimit: Math.min(Math.max(1, parseInt(b.dailyLimit, 10) || user.leadFinderAutopilot?.dailyLimit || 5), AUTOPILOT_MAX_DAILY),
      lastRunDate: user.leadFinderAutopilot?.lastRunDate || null,
      lastNote: user.leadFinderAutopilot?.lastNote || null,
    };
    if (enabled) {
      if (!ap.keywords.trim()) return send(res, 400, { ok: false, error: 'Enter target domains or keywords for the autopilot search.' });
      const campaign = load('campaigns').find(c => c.id === ap.campaignId && c.owner === session.email);
      if (!campaign) return send(res, 400, { ok: false, error: 'Choose one of your campaigns for auto-enrollment.' });
    }
    user.leadFinderAutopilot = ap;
    save('users', users);
    logEvent('lead-finder', enabled ? `Lead Finder autopilot ON — up to ${ap.dailyLimit} verified leads/day` : 'Lead Finder autopilot off');
    send(res, 200, { ok: true, autopilot: ap });
  },

  'POST /api/app/lead-finder/search': async (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const b = await readBody(req);
    const limit = Math.min(25, Math.max(1, parseInt(b.limit, 10) || 10));
    const users = load('users');
    const user = users.find(u => u.email === session.email);
    const plan = planOf(user);
    if (plan.expired) return send(res, 402, { ok: false, error: 'Your trial has ended — upgrade to use Lead Finder.', upgrade: true });
    const usage = leadFinderUsage(user, plan);
    if (usage.used >= usage.quota) {
      return send(res, 402, { ok: false, error: `Lead Finder quota reached (${usage.quota}/month on ${plan.name}). Upgrade for more credits.`, upgrade: true, used: usage.used, quota: usage.quota });
    }
    const filters = {
      keywords: (b.keywords || '').slice(0, 200),
      title: (b.title || '').slice(0, 120),
      size: (b.size || '').slice(0, 40),
      location: (b.location || '').slice(0, 120),
    };
    try {
      const found = await searchLeads(filters, limit, session.email);
      // Charge one credit per returned lead, capped by remaining quota.
      const charge = Math.min(found.leads.length, Math.max(0, usage.quota - usage.used));
      const users2 = load('users');
      const idx = users2.findIndex(u => u.email === session.email);
      if (idx >= 0) {
        const u2 = users2[idx];
        const usage2 = leadFinderUsage(u2, plan);
        u2.leadFinder.used = usage2.used + charge;
        save('users', users2);
        found.used = u2.leadFinder.used;
        found.quota = usage2.quota;
      }
      send(res, 200, { ok: true, ...found });
    } catch (err) {
      send(res, 502, { ok: false, error: `Lead Finder failed: ${err.message}` });
    }
  },

  'POST /api/app/lead-finder/enroll': async (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const b = await readBody(req);
    if (!b.campaignId || !Array.isArray(b.leads) || !b.leads.length) {
      return send(res, 400, { ok: false, error: 'campaignId and leads[] required' });
    }
    const user = load('users').find(u => u.email === session.email);
    const plan = planOf(user);
    if (plan.expired) return send(res, 402, { ok: false, error: 'Your trial has ended — upgrade to keep adding prospects.', upgrade: true });
    const result = enrollLeads(session.email, b.campaignId, b.leads.slice(0, 100));
    if (result.error) return send(res, 404, { ok: false, error: result.error });
    send(res, 200, { ok: true, ...result });
  },

  'GET /api/app/overview': (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const campaigns = load('campaigns');
    const prospects = load('prospects');
    const replies = load('replies');
    const tasks = load('tasks');
    const mine = campaigns.filter(c => c.owner === session.email);
    const mineIds = new Set(mine.map(c => c.id));
    const myProspects = mineIds.size ? prospects.filter(p => mineIds.has(p.campaignId)) : prospects;
    send(res, 200, { ok: true, stats: {
      campaigns: mine.length || campaigns.length,
      active: (mine.length ? mine : campaigns).filter(c => c.status === 'active').length,
      prospects: myProspects.length,
      sent: mine.reduce((acc, c) => acc + Number(c.sentCount || 0), 0) || load('events').filter(e => e.type === 'sent').length,
      replies: replies.filter(r => !r.owner || r.owner === session.email).length,
      bounces: myProspects.filter(p => p.bounced).length,
      openTasks: tasks.filter(t => !t.done && (!t.owner || t.owner === session.email)).length,
      engine: engineMode(session.email),
    } });
  },

  'GET /api/app/campaigns': (req, res) => {
    if (!requireAuth(req, res)) return;
    const campaigns = load('campaigns');
    const prospects = load('prospects');
    send(res, 200, { ok: true, campaigns: campaigns.map(c => ({
      ...c, prospects: prospects.filter(p => p.campaignId === c.id).length,
      finished: prospects.filter(p => p.campaignId === c.id && p.finished).length,
      bounced: prospects.filter(p => p.campaignId === c.id && p.bounced).length,
      sentToday: campaignUsedToday(c),
      capToday: campaignDailyCap(c),
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
    if (campaigns.filter(c => c.owner === session.email).length >= plan.maxCampaigns) return send(res, 402, { ok: false, error: `${plan.name} plan allows ${plan.maxCampaigns} campaign${plan.maxCampaigns > 1 ? 's' : ''} — upgrade for more.`, upgrade: true });
    for (const s of b.steps) {
      if (!['email', 'task', 'wait'].includes(s.type)) return send(res, 400, { ok: false, error: `Unknown step type "${s.type}"` });
      if (s.type === 'email' && (!s.subject || !s.body)) return send(res, 400, { ok: false, error: 'Email steps need subject and body.' });
      if (s.type === 'task' && !s.note) return send(res, 400, { ok: false, error: 'Task steps need a note.' });
      if (s.variantB && (!s.variantB.subject || !s.variantB.body)) return send(res, 400, { ok: false, error: 'A/B variant B needs both subject and body.' });
    }
    const campaign = {
      id: crypto.randomUUID(), name: b.name.trim(), status: 'draft', owner: session.email,
      steps: b.steps.map(s => ({ ...s, delayMinutes: Number(s.delayMinutes || 0) })),
      dailyCap: Math.max(1, Math.min(500, Number(b.dailyCap || 25))),
      sendWindowStart: Math.max(0, Math.min(23, Number(b.sendWindowStart ?? 9))),
      sendWindowEnd: Math.max(0, Math.min(23, Number(b.sendWindowEnd ?? 17))),
      timezone: typeof b.timezone === 'string' && b.timezone ? b.timezone : 'UTC',
      sentCount: 0, bounceCount: 0,
      createdAt: new Date().toISOString(),
    };
    campaigns.push(campaign); save('campaigns', campaigns);
    send(res, 201, { ok: true, campaign });
  },

  'GET /api/app/campaigns/:id/ab-results': (req, res, id) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const campaign = load('campaigns').find(c => c.id === id && c.owner === session.email);
    if (!campaign) return send(res, 404, { ok: false, error: 'Campaign not found' });
    send(res, 200, { ok: true, results: abResultsFor(campaign, load('prospects')) });
  },

  'PATCH /api/app/campaigns/:id': async (req, res, id) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const campaigns = load('campaigns');
    const c = campaigns.find(x => x.id === id && x.owner === session.email);
    if (!c) return send(res, 404, { ok: false, error: 'Not found' });
    const b = await readBody(req);
    if (b.dailyCap != null) c.dailyCap = Math.max(1, Math.min(500, Number(b.dailyCap)));
    if (b.sendWindowStart != null) c.sendWindowStart = Math.max(0, Math.min(23, Number(b.sendWindowStart)));
    if (b.sendWindowEnd != null) c.sendWindowEnd = Math.max(0, Math.min(23, Number(b.sendWindowEnd)));
    if (typeof b.timezone === 'string') c.timezone = b.timezone || 'UTC';
    save('campaigns', campaigns);
    send(res, 200, { ok: true, campaign: c });
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

  // --- sender accounts (multi-inbox rotation + warmup) ---
  'GET /api/app/senders': (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const senders = load('senders').filter(s => s.owner === session.email).map(s => {
      const pub = publicSender(s);
      pub.usedToday = senderUsedToday(s);
      pub.capToday = senderDailyCap(s);
      if (s.warmup?.enabled) pub.warmup = { ...s.warmup, isWarming: pub.capToday < Number(s.dailyLimit || 50) };
      return pub;
    });
    send(res, 200, { ok: true, senders, gateway: gatewaySender() ? { email: gatewaySender().email, resend: Boolean(RESEND_KEY) } : null });
  },

  'POST /api/app/senders': async (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const b = await readBody(req);
    const provider = PROVIDER_PRESETS[b.provider] ? b.provider : 'custom';
    const fromEmail = (b.email || '').trim().toLowerCase();
    if (!isEmail(fromEmail)) return send(res, 400, { ok: false, error: 'Valid sender email required.' });
    const host = (b.host || PROVIDER_PRESETS[provider].host || '').trim();
    const port = Number(b.port || PROVIDER_PRESETS[provider].port || 587);
    if (!host) return send(res, 400, { ok: false, error: 'SMTP host required.' });
    if (!b.pass) return send(res, 400, { ok: false, error: 'Password / app password required.' });
    const senders = load('senders');
    if (senders.some(s => s.owner === session.email && s.email === fromEmail)) {
      return send(res, 409, { ok: false, error: 'This inbox is already connected.' });
    }
    const record = {
      id: crypto.randomUUID(),
      owner: session.email,
      provider,
      email: fromEmail,
      fromName: (b.fromName || '').trim(),
      host, port,
      user: (b.user || fromEmail).trim(),
      encPass: encryptSecret(String(b.pass)),
      dailyLimit: Math.max(1, Math.min(500, Number(b.dailyLimit || 50))),
      status: 'active',
      sentLog: { date: new Date().toISOString().slice(0, 10), count: 0 },
      createdAt: new Date().toISOString(),
    };
    if (b.warmup) record.warmup = { enabled: true, startCap: Math.max(1, Number(b.startCap || WARMUP_DEFAULT_START)), rampDays: 0, lastRampDay: null, startedAt: new Date().toISOString() };
    senders.push(record); save('senders', senders);
    logEvent('sender', `Sender inbox connected: ${fromEmail}${record.warmup ? ' (warmup on)' : ''}`);
    send(res, 201, { ok: true, sender: publicSender(record) });
  },

  'PATCH /api/app/senders/:id': async (req, res, id) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const senders = load('senders');
    const s = senders.find(x => x.id === id && x.owner === session.email);
    if (!s) return send(res, 404, { ok: false, error: 'Not found' });
    const b = await readBody(req);
    if (b.dailyLimit != null) s.dailyLimit = Math.max(1, Math.min(500, Number(b.dailyLimit)));
    if (b.fromName != null) s.fromName = String(b.fromName).trim();
    if (b.pass) s.encPass = encryptSecret(String(b.pass));
    if (b.host) s.host = String(b.host).trim();
    if (b.port) s.port = Number(b.port);
    if (b.warmup === true && !s.warmup?.enabled) s.warmup = { enabled: true, startCap: WARMUP_DEFAULT_START, rampDays: 0, lastRampDay: null, startedAt: new Date().toISOString() };
    if (b.warmup === false) delete s.warmup;
    save('senders', senders);
    send(res, 200, { ok: true, sender: publicSender(s) });
  },

  'DELETE /api/app/senders/:id': (req, res, id) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const senders = load('senders');
    const s = senders.find(x => x.id === id && x.owner === session.email);
    if (!s) return send(res, 404, { ok: false, error: 'Not found' });
    save('senders', senders.filter(x => x.id !== id));
    logEvent('sender', `Sender inbox removed: ${s.email}`);
    send(res, 200, { ok: true });
  },

  // Preview personalization + spintax without sending anything.
  'POST /api/app/tools/preview-spintax': async (req, res) => {
    if (!requireAuth(req, res)) return;
    const b = await readBody(req);
    const prospect = {
      email: (b.email || 'sarah@acme.io').trim().toLowerCase(),
      firstName: b.firstName || 'Sarah', lastName: b.lastName || 'Connor',
      company: b.company || 'Acme Inc.', ...(b.customVars && typeof b.customVars === 'object' ? b.customVars : {}),
    };
    send(res, 200, { ok: true, subject: personalize(b.subject || '', prospect), body: personalize(b.body || '', prospect) });
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
    const ownerCampaignIds = new Set(load('campaigns').filter(c => c.owner === session.email).map(c => c.id));
    if (prospects.filter(p => ownerCampaignIds.has(p.campaignId)).length >= plan.maxProspects) return send(res, 402, { ok: false, error: `${plan.name} plan caps at ${plan.maxProspects} prospects — upgrade for more.`, upgrade: true });
    const existing = new Set(prospects.filter(p => p.campaignId === b.campaignId).map(p => p.email));

    const BUILTIN_COLS = { email: 'email', 'first name': 'firstName', firstname: 'firstName', first_name: 'firstName', 'last name': 'lastName', lastname: 'lastName', last_name: 'lastName', company: 'company' };

    let skippedSuppressed = 0;
    const add = (entry) => {
      const email = (entry.email || '').trim().toLowerCase();
      if (!isEmail(email)) return false;
      if (isSuppressed(session.email, email)) { skippedSuppressed++; return false; }
      if (existing.has(email)) return false;
      existing.add(email);
      prospects.push({
        id: crypto.randomUUID(), campaignId: b.campaignId, email,
        firstName: entry.firstName || '', lastName: entry.lastName || '', company: entry.company || '',
        customVars: entry.customVars && typeof entry.customVars === 'object' ? entry.customVars : {},
        stepIndex: null, nextRunAt: null, finished: false, verified: null, addedAt: new Date().toISOString(),
      });
      return true;
    };

    let added = 0;
    const importedNames = new Set();
    if (Array.isArray(b.list)) for (const e of b.list) if (add(e)) added++;
    if (typeof b.csv === 'string') {
      const lines = b.csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      // Optional header row: if the first line contains "email" as a column
      // label (not an email address), map columns by name; extras become
      // custom variables usable as {{tokens}} in steps.
      let header = null;
      const firstCols = (lines[0] || '').split(/,|;/).map(s => (s || '').trim().toLowerCase());
      if (firstCols.length > 1 && firstCols.includes('email') && !isEmail(firstCols[firstCols.indexOf('email')])) {
        header = firstCols;
        lines.shift();
      }
      for (const line of lines) {
        const cols = line.split(/,|;/).map(s => (s || '').trim());
        if (header) {
          const entry = { customVars: {} };
          header.forEach((col, i) => {
            const target = BUILTIN_COLS[col];
            if (target) entry[target] = cols[i] || '';
            else if (cols[i]) {
              const key = col.replace(/[^a-z0-9_]/g, '');
              if (key) entry.customVars[key] = cols[i];
            }
          });
          if (add(entry)) { added++; Object.keys(entry.customVars).forEach(k => importedNames.add(k)); }
        } else {
          const [email2, firstName, lastName, company] = cols;
          if (add({ email: email2, firstName, lastName, company })) added++;
        }
      }
    }
    save('prospects', prospects);
    send(res, 200, { ok: true, added, total: existing.size, customVars: [...importedNames], skippedSuppressed });
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
    const session = requireAuth(req, res);
    if (!session) return;
    const replies = load('replies').filter(r => !r.owner || r.owner === session.email);
    send(res, 200, { ok: true, replies: replies.slice(0, 100) });
  },

  'POST /api/app/inbox/simulate': (req, res) => {
    // Demo/simulated inbound until IMAP/webhook is wired
    const session = requireAuth(req, res);
    if (!session) return;
    const replies = load('replies');
    replies.unshift({
      id: crypto.randomUUID(),
      from: 'sarah@acme.io',
      subject: 'Re: Quick idea for Acme',
      body: 'Thanks for reaching out — this actually looks relevant. Can you send over a short demo link?',
      prospect: 'Sarah Connor',
      campaign: 'Q3 founders',
      owner: session.email,
      read: false,
      at: new Date().toISOString(),
    });
    save('replies', replies);
    send(res, 200, { ok: true, message: 'Simulated reply added to inbox.' });
  },

  // Inbound reply webhook — Resend inbound (set RESEND_SIGNING_SECRET) or any
  // generic mail hook. A matched reply stops the prospect's sequence.
  'POST /api/email/receive': async (req, res) => {
    const b = await readBody(req).catch(() => ({}));
    const secret = process.env.RESEND_SIGNING_SECRET;
    if (secret && b?.secret && b.secret !== secret) return send(res, 403, { ok: false, error: 'Invalid secret' });
    const fromRaw = b?.from || b?.data?.from || 'unknown@unknown';
    const from = (fromRaw.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [fromRaw])[0].toLowerCase();
    const subject = b?.subject || b?.data?.subject || '(no subject)';
    const body = b?.text || b?.data?.text || b?.html?.replace(/<[^>]+>/g, ' ') || '';

    // Match the reply to a prospect and stop their sequence.
    const campaigns = load('campaigns');
    const prospects = load('prospects');
    const prospect = prospects.find(p => p.email === from);
    let owner = null, campaignName = 'incoming', prospectName = from.split('@')[0];
    if (prospect) {
      const campaign = campaigns.find(c => c.id === prospect.campaignId);
      owner = campaign?.owner || null;
      campaignName = campaign?.name || 'incoming';
      prospectName = [prospect.firstName, prospect.lastName].filter(Boolean).join(' ') || prospectName;
      if (!prospect.replied) {
        prospect.replied = true;
        prospect.repliedAt = new Date().toISOString();
        prospect.finished = true;
        prospect.nextRunAt = null;
        save('prospects', prospects);
        logEvent('reply', `${from} replied in “${campaignName}” — sequence stopped`);
      }
    }
    // Smart Unibox: categorize intent (LLM or heuristic) and auto-suppress
    // opt-out requests even if they never clicked the unsubscribe link.
    const intent = await classifyIntent({ subject, body });
    const reply = { id: crypto.randomUUID(), from, subject, body, prospect: prospectName, campaign: campaignName, owner, intent, read: false, at: new Date().toISOString() };
    const replies = load('replies');
    replies.unshift(reply);
    save('replies', replies);
    if (owner && intent === 'unsubscribe') suppressEmail(owner, from, 'intent-unsubscribe');
    if (owner) fireWebhooks(owner, 'reply', { from, subject, intent, campaign: campaignName });
    if (!prospect) logEvent('received', `Reply from ${from}: ${subject}`);
    send(res, 200, { received: true, matched: Boolean(prospect), intent });
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
    const session = requireAuth(req, res);
    if (!session) return;
    const user = load('users').find(u => u.email === session.email);
    const now = Date.now();
    const tasks = load('tasks').filter(t => !t.owner || t.owner === session.email);
    send(res, 200, {
      ok: true,
      tasks,
      linkedin: {
        usedToday: linkedinUsedToday(session.email),
        budget: linkedinBudget(user),
        dueNow: tasks.filter(t => !t.done && t.kind === 'linkedin' && (!t.dueAt || t.dueAt <= now)).length,
        scheduled: tasks.filter(t => !t.done && t.kind === 'linkedin' && t.dueAt && t.dueAt > now).length,
      },
    });
  },

  // User-level sending/LinkedIn preferences.
  'POST /api/app/settings': async (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const b = await readBody(req);
    const users = load('users');
    const user = users.find(u => u.email === session.email);
    if (!user) return send(res, 404, { ok: false });
    if (b.linkedinBudget != null) user.linkedinBudget = Math.max(1, Math.min(100, Number(b.linkedinBudget)));
    save('users', users);
    send(res, 200, { ok: true, linkedinBudget: linkedinBudget(user) });
  },

  // --- LinkedIn autopilot bridge ---
  // Generate/revoke a per-user integration token (shown once, stored hashed).
  'POST /api/app/integrations/token': (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const token = `ovk_${crypto.randomBytes(24).toString('base64url')}`;
    const users = load('users');
    const user = users.find(u => u.email === session.email);
    if (!user) return send(res, 404, { ok: false });
    user.integrationTokenHash = crypto.createHash('sha256').update(token).digest('hex');
    save('users', users);
    logEvent('integration', 'LinkedIn autopilot token generated');
    send(res, 200, { ok: true, token, callbackUrl: `${PUBLIC_URL}/api/integrations/linkedin/callback` });
  },

  'DELETE /api/app/integrations/token': (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const users = load('users');
    const user = users.find(u => u.email === session.email);
    if (user) { delete user.integrationTokenHash; save('users', users); }
    send(res, 200, { ok: true });
  },

  'GET /api/app/integrations/status': (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const user = load('users').find(u => u.email === session.email);
    send(res, 200, { ok: true, hasToken: Boolean(user?.integrationTokenHash), callbackUrl: `${PUBLIC_URL}/api/integrations/linkedin/callback` });
  },

  // Autopilot callback: PhantomBuster/Zapier/etc. report task outcomes.
  // --- MCP (Model Context Protocol, streamable HTTP) ---
  // Auth: Authorization: Bearer <integration token> or x-integration-token.
  // JSON-RPC 2.0: initialize, tools/list, tools/call. Generate a token in
  // Settings → LinkedIn autopilot bridge → Generate integration token.
  'POST /api/mcp': async (req, res) => {
    const auth = req.headers.authorization || '';
    const token = req.headers['x-integration-token'] || (auth.startsWith('Bearer ') ? auth.slice(7) : '');
    const user = integrationTokenOk(token);
    if (!user) return send(res, 403, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Invalid integration token' } });
    const b = await readBody(req).catch(() => ({}));
    const rpc = (result, id) => send(res, 200, { jsonrpc: '2.0', id: id ?? null, result });
    const rpcErr = (code, message, id) => send(res, 200, { jsonrpc: '2.0', id: id ?? null, error: { code, message } });

    const TOOLS = [
      { name: 'overview_stats', description: 'Aggregate stats: campaigns, prospects, sends, replies, bounces, open to-dos.', inputSchema: { type: 'object', properties: {} } },
      { name: 'list_campaigns', description: 'List campaigns with status, step count, prospect counts, daily cap.', inputSchema: { type: 'object', properties: {} } },
      { name: 'ab_results', description: 'A/B test results for a campaign: per-step variant sends, replies, reply rates, winner.', inputSchema: { type: 'object', properties: { campaignId: { type: 'string' } }, required: ['campaignId'] } },
      { name: 'add_prospect', description: 'Add a prospect to a campaign (suppression-checked).', inputSchema: { type: 'object', properties: { campaignId: { type: 'string' }, email: { type: 'string' }, firstName: { type: 'string' }, lastName: { type: 'string' }, company: { type: 'string' } }, required: ['campaignId', 'email'] } },
      { name: 'list_replies', description: 'Most recent inbox replies with intent classification.', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
    ];

    if (b.method === 'initialize') {
      return rpc({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'outrovo', version: '1.0.0' } }, b.id);
    }
    if (b.method === 'notifications/initialized') return send(res, 202, { ok: true });
    if (b.method === 'tools/list') return rpc({ tools: TOOLS }, b.id);
    if (b.method === 'tools/call') {
      const { name, arguments: args = {} } = b.params || {};
      const wrap = data => rpc({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }, b.id);
      const ownerCampaigns = () => load('campaigns').filter(c => c.owner === user.email);
      if (name === 'overview_stats') {
        const campaigns = ownerCampaigns();
        const ids = new Set(campaigns.map(c => c.id));
        const prospects = load('prospects').filter(p => ids.has(p.campaignId));
        const replies = load('replies').filter(r => !r.owner || r.owner === user.email);
        return wrap({
          campaigns: campaigns.length, active: campaigns.filter(c => c.status === 'active').length,
          prospects: prospects.length, sent: campaigns.reduce((n, c) => n + (c.sentCount || 0), 0),
          replies: replies.length, bounces: prospects.filter(p => p.bounced).length,
        });
      }
      if (name === 'list_campaigns') {
        const prospects = load('prospects');
        return wrap(ownerCampaigns().map(c => ({
          id: c.id, name: c.name, status: c.status, steps: c.steps.length,
          prospects: prospects.filter(p => p.campaignId === c.id).length,
          sent: c.sentCount || 0, bounced: c.bounceCount || 0,
          abTests: c.steps.filter(s => s.variantB).length,
        })));
      }
      if (name === 'ab_results') {
        const campaign = ownerCampaigns().find(c => c.id === args.campaignId);
        if (!campaign) return rpcErr(-32602, 'Campaign not found', b.id);
        return wrap(abResultsFor(campaign, load('prospects')));
      }
      if (name === 'add_prospect') {
        const campaign = ownerCampaigns().find(c => c.id === args.campaignId);
        if (!campaign) return rpcErr(-32602, 'Campaign not found', b.id);
        const email = (args.email || '').trim().toLowerCase();
        if (!isEmail(email)) return rpcErr(-32602, 'Valid email required', b.id);
        if (isSuppressed(user.email, email)) return rpcErr(-32602, 'Address is suppressed', b.id);
        const prospects = load('prospects');
        if (prospects.some(p => p.campaignId === campaign.id && p.email === email)) return rpcErr(-32602, 'Already in this campaign', b.id);
        prospects.push({
          id: crypto.randomUUID(), campaignId: campaign.id, email,
          firstName: args.firstName || '', lastName: args.lastName || '', company: args.company || '',
          customVars: { source: 'mcp' }, stepIndex: null, nextRunAt: null, finished: false,
          verified: null, addedAt: new Date().toISOString(),
        });
        save('prospects', prospects);
        logEvent('mcp', `Prospect ${email} added to “${campaign.name}” via MCP`);
        return wrap({ ok: true, email, campaign: campaign.name });
      }
      if (name === 'list_replies') {
        const limit = Math.min(50, Math.max(1, Number(args.limit) || 10));
        return wrap(load('replies').filter(r => !r.owner || r.owner === user.email).slice(0, limit)
          .map(r => ({ from: r.from, subject: r.subject, intent: r.intent, at: r.at })));
      }
      return rpcErr(-32601, `Unknown tool "${name}"`, b.id);
    }
    return rpcErr(-32601, `Unknown method "${b.method}"`, b.id);
  },

  // Auth: x-integration-token header or ?token=. Body:
  //   { taskId } | { prospect, campaign? }  +  outcome: done|failed|connected|replied, note?
  'POST /api/integrations/linkedin/callback': async (req, res, _id, query) => {
    const b = await readBody(req).catch(() => ({}));
    const token = req.headers['x-integration-token'] || query?.get('token') || b.token;
    const user = integrationTokenOk(token);
    if (!user) return send(res, 403, { ok: false, error: 'Invalid integration token' });
    const outcome = ['done', 'failed', 'connected', 'replied'].includes(b.outcome) ? b.outcome : 'done';

    const tasks = load('tasks');
    let task = b.taskId
      ? tasks.find(t => t.id === b.taskId && t.owner === user.email)
      : tasks.find(t => !t.done && t.owner === user.email && t.prospect === (b.prospect || '').toLowerCase());
    if (task) {
      task.done = outcome !== 'failed';
      task.outcome = outcome;
      task.doneAt = new Date().toISOString();
      if (b.note) task.note = `${task.note} — ${String(b.note).slice(0, 200)}`;
      save('tasks', tasks);
    }

    // A LinkedIn reply means the prospect engaged — stop their email sequence.
    const prospectEmail = (b.prospect || task?.prospect || '').toLowerCase();
    if (outcome === 'replied' && prospectEmail) {
      const email = prospectEmail;
      const ownerCampaigns = new Set(load('campaigns').filter(c => c.owner === user.email).map(c => c.id));
      const prospects = load('prospects');
      let touched = false;
      for (const p of prospects) {
        if (ownerCampaigns.has(p.campaignId) && p.email === email && !p.finished) {
          p.replied = true; p.finished = true; p.nextRunAt = null; touched = true;
        }
      }
      if (touched) save('prospects', prospects);
    }

    logEvent('linkedin', `Autopilot: ${outcome}${task ? ` — ${task.prospect}` : b.prospect ? ` — ${b.prospect}` : ''}${b.note ? ` (${String(b.note).slice(0, 120)})` : ''}`);
    send(res, 200, { ok: true, matched: Boolean(task) });
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
    const session = requireAuth(req, res);
    if (!session) return;
    const inboxCount = load('senders').filter(s => s.owner === session.email && s.status === 'active').length;
    const gateway = gatewaySender();
    const mode = inboxCount ? 'multi-inbox' : gateway ? (gateway.resend ? 'resend' : 'smtp') : 'demo';
    send(res, 200, {
      ok: true,
      mode,
      inboxes: inboxCount,
      smtp: gateway ? { provider: gateway.resend ? 'resend' : 'smtp', host: SMTP.host, user: gateway.email } : null,
    });
  },

  'POST /api/app/tools/test-email': async (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const b = await readBody(req);
    const to = (b.to || '').trim();
    if (!isEmail(to)) return send(res, 400, { ok: false, error: 'Valid email required' });
    const opts = {};
    if (b.senderId === '__gateway__') {
      opts.sender = gatewaySender();
      if (!opts.sender) return send(res, 404, { ok: false, error: 'No gateway sender configured.' });
    } else if (b.senderId) {
      const s = ownerSenders(session.email).find(x => x.id === b.senderId);
      if (!s) return send(res, 404, { ok: false, error: 'Sender inbox not found.' });
      opts.sender = s;
    }
    try {
      const result = await sendEmail(
        { name: 'Test email', owner: session.email },
        { email: to, firstName: 'there' },
        { subject: 'Outrovo test email ✅', body: 'Hi {{firstName}} — if you see this {message|note}, your Outrovo sending pipeline works.' },
        opts,
      );
      send(res, 200, { ok: true, sender: result.sender, demo: result.demo });
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
    // Custom-domain white-label: when the request arrives on a CNAME that
    // belongs to a user, rebrand the HTML shell on the fly (title, logo,
    // brand name) so agencies can serve the whole app from their domain.
    let body = content;
    const host = (req.headers.host || '').split(':')[0];
    const brand = pathname.endsWith('.html')
      ? load('users').find(u => u.whiteLabel?.cname === host)
      : null;
    if (brand) {
      body = content.toString()
        .replace(/<title>[^<]*<\/title>/, `<title>${brand.whiteLabel.brandName || brand.company} — Outreach</title>`)
        .replace(/Outrovo<\/a>/, `${brand.whiteLabel.brandName || brand.company}</a>`)
        .replace(/logo\.svg/g, brand.whiteLabel.logoUrl || 'logo.svg');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return send(res, 405, { ok: false });
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
    console.log(`Outrovo server on http://0.0.0.0:${PORT} — engine mode: ${smtpConfigured ? 'smtp' : 'demo'}`);
    if (!ADMIN_KEY) console.warn('ADMIN_KEY is not set — admin endpoints (/api/signups, /api/billing/activate) are locked.');
  });
}

// Vercel imports the handler as a serverless function.
module.exports = (req, res) => server.emit("request", req, res);
