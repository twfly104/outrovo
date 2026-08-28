    // Landing + pricing assistant — every answer below is grounded in this
// site's own copy (index + pricing), so it can never promise what we don't.
// Loaded on any page that renders the assistant markup; no-ops elsewhere.
(() => {
const fab = document.getElementById('asstFab');
const panel = document.getElementById('asstPanel');
const body = document.getElementById('asstBody');
const form = document.getElementById('asstForm');
const input = document.getElementById('asstText');
if (!fab || !panel || !body || !form || !input) return;

const QA = [
  { k: ['hello', 'hi', 'hiya', 'howdy', 'good morning', 'good afternoon', 'good evening', 'yo', 'sup'],
    a: 'Hey! Good to see you. I can answer anything about Outrovo — <strong>pricing</strong>, <strong>deliverability</strong>, <strong>LinkedIn</strong>, getting started — or just pick a question below.' },
  { k: ['thanks', 'thank you', 'thx', 'cheers', 'great', 'awesome', 'cool', 'nice'],
    a: 'Anytime! If you want to see it in action, <a href="signup.html">start a free trial</a> — no card needed — or keep the questions coming.' },
  { k: ['spam', 'inbox', 'deliverab', 'land', 'junk', 'promotions tab', 'open rate'],
    a: 'Honest answer: no tool can guarantee the inbox — anyone who says it can is selling you something. What Outrovo does is fix the three things that decide it: every email is <strong>verified before it\'s sent</strong>, your domain is checked against <strong>SPF, DKIM and DMARC</strong>, and sends are <strong>paced</strong> so nothing looks like a bot.' },
  { k: ['warm', 'ramp', 'new domain', 'new inbox', 'reputation'],
    a: 'Warm-up is <strong>free on every plan</strong>. A new inbox starts small and the daily cap grows automatically, so mailbox providers build trust in your address before the volume ramps up.' },
  { k: ['price', 'pricing', 'cost', 'much', 'plan', 'expensive', 'pay', '$'],
    a: 'Starter is <strong>$39</strong>/mo, Pro <strong>$89</strong> (most popular), Scale <strong>$159</strong> — less when billed annually. Agency is $249/mo with client workspaces and white-labeling. Every plan includes <strong>unlimited sending inboxes</strong> — no per-seat fees — and starts with a <strong>14-day free trial, no card</strong>. Full breakdown on the <a href="pricing.html">pricing page</a>.' },
  { k: ['trial', 'free', 'card', 'cancel', 'refund'],
    a: '14 days, every feature, <strong>no card needed</strong>. If it doesn\'t make you money, cancel with one click — that\'s the whole deal. <a href="signup.html">Start free</a>.' },
  { k: ['linkedin', 'automat', 'ban', 'safe', 'compliant'],
    a: 'We don\'t auto-click — that violates LinkedIn\'s rules and gets accounts banned. Outrovo turns LinkedIn into <strong>to-do steps inside your sequence</strong>, so you do them by hand from the same place and stay compliant.' },
  { k: ['ai', 'write', 'template', 'sequence', 'draft', 'copy'],
    a: 'Yes — give it your website and it <strong>drafts a sequence</strong> based on what you actually sell and who you\'re trying to reach. You review and edit everything before a single send goes out.' },
  { k: ['spf', 'dkim', 'dmarc', 'domain', 'dns'],
    a: 'The <strong>domain health check</strong> tests SPF, DKIM and DMARC in one click and shows exactly what to fix — before you burn your sender reputation, not after.' },
  { k: ['verify', 'verification', 'bounc', 'invalid', 'catch-all', 'catchall'],
    a: 'Every prospect email is <strong>verified as it\'s imported</strong> — invalid addresses get skipped before they bounce and hurt your sender score. Catch-all verification is free on every plan.' },
  { k: ['start', 'setup', 'how it work', 'how do i start', 'begin', 'get started'],
    a: 'Four steps: <strong>add people</strong> (verified as they come in), <strong>pick a template</strong> or let AI write it, <strong>hit run</strong> — Outrovo paces the sends — and <strong>read replies</strong> in one inbox. The trial has every feature: <a href="signup.html">start free</a>.' },
  { k: ['what is', 'what\'s outrovo', 'whats outrovo', 'what does', 'who are', 'service', 'services', 'what do you do', 'what you do', 'what you offer', 'offer', 'features', 'feature', 'capabilities', 'about outrovo', 'tell me about', 'product'],
    a: 'Outrovo is a cold-outreach platform: you <strong>find leads</strong> (built-in Lead Finder), <strong>send email + LinkedIn sequences</strong> with AI-drafted copy, and <strong>read every reply in one inbox</strong>. Verification, warm-up and domain checks are built in — not paid add-ons. <a href="signup.html">Try it free for 14 days</a>.' },
  { k: ['hubspot', 'pipedrive', 'salesforce', 'crm', 'integration', 'integrate', 'zapier', 'connect to'],
    a: 'Yes — <strong>CRM integrations (HubSpot, Pipedrive…)</strong> plus <strong>API, webhooks, MCP and CLI</strong> are included on every plan, Starter included.' },
  { k: ['api', 'webhook', 'mcp', 'cli', 'developer', 'docs'],
    a: 'Every plan includes <strong>API access, webhooks, MCP and a CLI</strong> — build whatever you need on top. Start a trial and the docs are inside.' },
  { k: ['lead finder', 'find leads', 'find prospects', 'prospect data', 'lead data', 'apollo', 'database'],
    a: 'The built-in <strong>Lead Finder</strong> comes with monthly credits — 100 on Starter, 1,000 on Pro, 10,000 on Scale — so you can find prospects without buying a separate database.' },
  { k: ['limit', 'volume', 'per day', 'per month', 'quota', 'cap', 'how many emails'],
    a: 'It\'s per contacted prospect: <strong>2,000/mo</strong> on Starter, <strong>10,000/mo</strong> on Pro, <strong>unlimited</strong> on Scale — with unlimited email accounts and warm-up on all of them.' },
  { k: ['gmail', 'outlook', 'microsoft', 'google workspace', 'smtp', 'connect my email', 'connect email'],
    a: 'You connect your own Gmail or Microsoft inbox — <strong>one-click authorize</strong>, or an app password if you prefer. Campaigns rotate across every inbox you connect.' },
  { k: ['gdpr', 'can-spam', 'canspam', 'legal', 'unsubscribe', 'opt out', 'opt-out', 'compliance', 'compliant'],
    a: 'Every email carries a <strong>one-click unsubscribe</strong> and your mailing address automatically — the boring legal stuff (CAN-SPAM) is handled for you.' },
  { k: ['sms', 'text message', 'cold call', 'phone', 'whatsapp'],
    a: 'Honest answer: no — Outrovo does <strong>email + LinkedIn to-dos</strong>, and does them properly. No SMS or calling.' },
  { k: ['a/b', 'ab test', 'split test', 'variant'],
    a: '<strong>A/B testing</strong> is included from the Pro plan up — test subject lines and bodies, keep what wins.' },
  { k: ['multiple inbox', 'inboxes', 'rotation', 'more than one', 'several inbox', 'team inbox', 'sender account', 'email account'],
    a: 'Connect as many inboxes as you like — campaigns <strong>rotate across all of them</strong>, each with its own daily cap and warm-up, so no single inbox gets burned.' },
  { k: ['agency', 'white label', 'white-label', 'client'],
    a: 'The <strong>Agency plan ($249/mo)</strong> adds the agency panel, client workspaces, consolidated billing and white-labeling. Start a normal trial and ask to switch it on.' },
  { k: ['demo', 'see it', 'show me', 'walkthrough', 'tour'],
    a: 'Two options: <a href="#" data-demo>watch the 4-chapter product tour</a> right now, or <a href="signup.html">book a demo</a> and we\'ll walk you through live.' },
  { k: ['support', 'contact', 'human', 'talk to', 'help me', 'someone'],
    a: 'Fastest way to a human: <a href="signup.html">book a demo</a> — it\'s a real conversation, not a sales ambush. Quick questions? I\'m right here.' },
  { k: ['security', 'secure', 'privacy', 'my data', 'gdpr data', 'data'],
    a: 'Short version: your lists are yours, and we don\'t sell data. The details are in the <a href="privacy.html">privacy policy</a>.' },
  { k: ['replies', 'unibox', 'unified inbox', 'responses'],
    a: 'Every reply from every campaign lands in <strong>one inbox</strong>, in order — no more hunting across five Gmail tabs to find who said yes.' },
  // Competitor & outcome questions real buyers ask — keep the no-key
  // assistant useful without ever promising a number we can't back.
  { k: ['instantly', 'lemlist', 'apollo', 'smartlead', 'reply.io', 'woodpecker', 'outreach', 'salesloft', 'competitor', ' vs', 'versus', 'different from', 'how are you different', 'better than', 'alternative', 'per seat', 'per inbox'],
    a: 'Honest take: tools like Lemlist charge <strong>$50–90 per sender seat</strong> — scale to 10 inboxes and the bill explodes. Every Outrovo plan includes <strong>unlimited sending inboxes</strong>, plus verification, domain health and warm-up built in free. <a href="pricing.html">Compare the plans</a>.' },
  { k: ['top up', 'top-up', 'topup', 'more credits', 'extra credits', 'buy credits', 'credit bundle', 'run out of credits'],
    a: 'Lead Finder <strong>Add Credits</strong> packs are <strong>pay-as-you-go and never expire</strong>: 500 credits <strong>$19</strong>, 2,000 <strong>$49</strong>, 5,000 <strong>$99</strong>, 10,000 <strong>$189</strong> — on any plan, straight from the app.' },
  { k: ['dns setup', 'domain setup', 'done for you', 'done-for-you', 'set up my domain', 'setup my domain', 'configure dns', 'dns help', 'secondary domain'],
    a: 'Yes — <strong>done-for-you domain setup, $99 one time</strong>: we configure SPF, DKIM, DMARC and your secondary domain with you, instead of burning deliverability on trial-and-error. Details on the <a href="pricing.html">pricing page</a>.' },
  { k: ['open rate', 'reply rate', 'how many meetings', 'how many replies', 'results', 'roi', 'will it work', 'does it work', 'actually work', 'does it really', 'success'],
    a: 'Straight answer: that depends on your list and message more than any tool. What Outrovo controls is the deliverability side — <strong>verification, domain health, pacing, warm-up</strong> — so your good emails actually get seen instead of filtered.' },
  { k: ['personaliz', 'first line', 'icebreaker', 'custom intro'],
    a: 'Yes — every email can carry <strong>personalized openers</strong> (name, company, and fields you import), and the AI writer drafts sequences around what you sell and who you target.' },
  { k: ['follow up', 'follow-up', 'followup', 'sequence length', 'how many emails', 'cadence', 'steps'],
    a: 'Sequences support <strong>multi-step follow-ups with waits and branch-on-reply</strong> — you set the cadence, Outrovo paces the sends so nothing fires like a bot.' },
  { k: ['who is it for', 'who should use', 'small business', 'startup', 'founder', 'agency owner', 'freelancer'],
    a: 'It\'s built for founders, small teams, and agencies who need pipeline without a deliverability engineer — <strong>verification and warm-up included</strong>, so you don\'t need to be an expert to land in the inbox.' },
  { k: ['csv', 'import', 'upload list', 'my list', 'existing leads', 'spreadsheet'],
    a: 'Yes — import your list (CSV) and every address is <strong>verified as it comes in</strong>, so bad emails get skipped before they bounce. Or use the built-in <strong>Lead Finder</strong> to source new ones.' },
  { k: ['track', 'analytics', 'report', 'metrics', 'stats', 'dashboard'],
    a: 'You get <strong>deliverability monitoring and per-campaign stats</strong> — see what landed, what bounced, and who replied, all from the dashboard.' },
  { k: ['many sender', 'how many emails accounts', 'team members', 'seats', 'users per'],
    a: 'Connect <strong>unlimited sending inboxes</strong> on every plan — campaigns rotate across them, each with its own daily cap and warm-up.' },
  { k: ['test email', 'try it', 'see a sample', 'preview'],
    a: 'Easiest way: <a href="signup.html">start the free trial</a> (14 days, no card) and send yourself a real test — or <a href="#" data-demo>watch the product tour</a> first.' },
];
// No canned shrug: when nothing matches, steer the visitor to what the
// assistant DOES answer (top buyer topics) plus FAQ/demo, so the panel
// always moves the conversation forward instead of dead-ending.
const FALLBACK = 'Good question — that one needs a human to answer properly. Quick version of what we do: Outrovo <strong>finds leads, sends email + LinkedIn sequences, and puts every reply in one inbox</strong> — with verification and warm-up built in. Ask me about <strong>pricing</strong>, <strong>deliverability</strong>, <strong>LinkedIn</strong>, <strong>the AI writer</strong> or <strong>integrations</strong> — or <a href="signup.html">start a free trial</a> and see it yourself.';
const CHIPS = ['Will my emails land in the inbox?', 'How does warm-up work?', 'What does it cost?', 'Does it automate LinkedIn?'];

const scrollEnd = () => { body.scrollTop = body.scrollHeight; };
const addMsg = (html, me) => {
  const d = document.createElement('div');
  d.className = 'asst-msg ' + (me ? 'me' : 'bot');
  if (me) d.textContent = html; else d.innerHTML = html;
  body.appendChild(d); scrollEnd();
};
const addChips = () => {
  const c = document.createElement('div');
  c.className = 'asst-chips';
  CHIPS.forEach(q => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = q;
    b.addEventListener('click', () => ask(q));
    c.appendChild(b);
  });
  body.appendChild(c); scrollEnd();
};
const answerLocal = q => {
  const t = q.toLowerCase();
  // short alphabetic keywords (e.g. "ai") need word boundaries or they
  // match inside words like "emAIls"; symbols like "$" stay substring
  const hit = kw => /^\w+$/.test(kw) && kw.length <= 3
    ? new RegExp(`\\b${kw}\\b`).test(t)
    : t.includes(kw);
  // Near-miss typo tolerance: a single-word keyword of 5+ chars scores
  // if a question token is within one edit of it (e.g. "deliverabilty",
  // "linkdin", "prcing"). Conservative so it never hijacks real matches.
  const lev = (a, b) => {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 1) return 2;
    const d = [Array.from({ length: n + 1 }, (_, j) => j)];
    for (let i = 1; i <= m; i++) {
      const row = [i];
      for (let j = 1; j <= n; j++) row[j] = Math.min(d[i-1][j] + 1, row[j-1] + 1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
      d.push(row);
    }
    return d[m][n];
  };
  const tokens = t.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 4);
  const fuzzy = kw => /^\w+$/.test(kw) && kw.length >= 5 && tokens.some(w => lev(kw, w) <= 1);
  // Multi-word phrases weigh double so a specific entry ("set up my
  // domain") beats a generic single-word hit ("domain") on the same
  // question.
  const ehit = e => e.k.reduce((n, kw) => n + ((hit(kw) || fuzzy(kw)) ? (kw.includes(' ') ? 2 : 1) : 0), 0);
  let best = null, bestScore = 0;
  for (const e of QA) {
    const s = ehit(e);
    if (s > bestScore) { bestScore = s; best = e; }
  }
  return best ? best.a : FALLBACK;
};
const history = [];
const typingMsg = () => {
  const d = document.createElement('div');
  d.className = 'asst-msg bot asst-typing';
  d.textContent = '…';
  body.appendChild(d); scrollEnd();
  return d;
};
// Ask the real API first; the keyword matcher above stays as the
// offline fallback so the panel never dead-ends.
const ask = q => {
  addMsg(q, true);
  const typing = typingMsg();
  fetch('/api/assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, history: history.slice(-6) })
  })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(data => {
      history.push({ role: 'user', content: q }, { role: 'assistant', content: data.answer || FALLBACK });
      typing.remove();
      addMsg(data.answer || FALLBACK);
    })
    .catch(() => { typing.remove(); addMsg(answerLocal(q)); });
};

const open = () => {
  panel.classList.add('open'); fab.classList.add('hide');
  if (!body.children.length) {
    addMsg('Hi! Ask me anything about Outrovo — pricing, deliverability, LinkedIn — or pick a question:');
    addChips();
  }
  setTimeout(() => input.focus(), 250);
};
const close = () => { panel.classList.remove('open'); fab.classList.remove('hide'); };

fab.addEventListener('click', open);
document.getElementById('asstClose').addEventListener('click', close);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && panel.classList.contains('open')) close(); });
body.addEventListener('click', e => {
  if (e.target.matches('[data-asst-close]')) close();
  const demoLink = e.target.closest('[data-demo]');
  const demoModal = document.getElementById('demoModal');
  if (demoLink && demoModal) {
    e.preventDefault(); close();
    demoModal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
});
form.addEventListener('submit', e => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  ask(q);
});
    })();
