#!/usr/bin/env node
// Outrovo CLI — talks MCP JSON-RPC directly to /api/mcp.
// Zero npm deps. Requires Node 18+ (global fetch).
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.outrovo');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_BASE = 'https://outrovo.co';

const args = process.argv.slice(2);
const cmd = args[0];
const rest = args.slice(1);

function load() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return {}; }
}
function saveCfg(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  fs.chmodSync(CONFIG_FILE, 0o600);
}
function fail(msg, code = 1) { console.error('✗ ' + msg); process.exit(code); }
function flag(name, def) {
  const i = rest.indexOf('--' + name);
  return i >= 0 && rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : def;
}
function opt(name) { return rest.includes('--' + name); }

async function rpc(method, params = {}, cfg) {
  const base = (cfg.base || DEFAULT_BASE).replace(/\/+$/, '');
  const res = await fetch(base + '/api/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + cfg.token,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.error) fail(data.error.message || 'RPC error');
  return data.result;
}
async function callTool(name, argsObj, cfg) {
  const r = await rpc('tools/call', { name, arguments: argsObj }, cfg);
  const text = r?.content?.[0]?.text;
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw: text }; }
}
function pretty(obj) { console.log(JSON.stringify(obj, null, 2)); }

const USAGE = `outrovo — cold outreach from your terminal

Usage:
  outrovo init --token <integration-token> [--base https://outrovo.co]
  outrovo stats                            aggregate stats (campaigns, sends, replies)
  outrovo campaigns                        list campaigns with status and prospect counts
  outrovo replies [--limit 20]             recent inbox replies with intent classification
  outrovo ab <campaignId>                  A/B test results for a campaign
  outrovo add-prospect --campaign <id> --email <addr> [--first N] [--last N] [--company C]

Config: ~/.outrovo/config.json   (chmod 600; contains your integration token)
Get a token in Settings → LinkedIn autopilot bridge → Generate integration token.`;

(async () => {
  const cfg = load();
  const base = (cfg.base || DEFAULT_BASE).replace(/\/+$/, '');

  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') { console.log(USAGE); process.exit(0); }

  if (cmd === 'init') {
    const token = flag('token');
    if (!token) fail('init requires --token <integration-token>');
    const next = { token, base: flag('base', DEFAULT_BASE) };
    saveCfg(next);
    // Smoke test the token before declaring success.
    try {
      await rpc('initialize', {}, next);
      console.log('✓ token saved to ' + CONFIG_FILE);
      console.log('  base: ' + next.base);
    } catch (e) {
      fail('token saved, but server rejected it: ' + e.message);
    }
    return;
  }

  if (!cfg.token) fail('no token — run: outrovo init --token <token>');

  if (cmd === 'stats') {
    const r = await callTool('overview_stats', {}, cfg);
    console.log('campaigns   ' + r.campaigns + ' (' + r.active + ' active)');
    console.log('prospects   ' + r.prospects);
    console.log('sent        ' + r.sent);
    console.log('replies     ' + r.replies);
    console.log('bounces     ' + r.bounces);
    return;
  }

  if (cmd === 'campaigns') {
    const list = await callTool('list_campaigns', {}, cfg);
    if (!Array.isArray(list) || !list.length) { console.log('(no campaigns yet)'); return; }
    console.log('ID         NAME                                     STATUS      PROSP  SENT  BOUNCE  A/B');
    for (const c of list) {
      console.log(
        String(c.id).padEnd(10) +
        String(c.name || '').slice(0, 40).padEnd(41) +
        String(c.status).padEnd(12) +
        String(c.prospects).padEnd(7) +
        String(c.sent).padEnd(6) +
        String(c.bounced).padEnd(8) +
        (c.abTests ? c.abTests : '-')
      );
    }
    return;
  }

  if (cmd === 'replies') {
    const limit = Number(flag('limit', 20));
    const list = await callTool('list_replies', { limit }, cfg);
    if (!Array.isArray(list) || !list.length) { console.log('(no replies yet)'); return; }
    for (const r of list) {
      const intent = (r.intent || 'neutral').padEnd(15);
      const when = (r.at || '').slice(0, 10).padEnd(11);
      const who = (r.fromEmail || r.from || '').padEnd(32);
      console.log(when + intent + who + (r.subject || '').slice(0, 60));
    }
    return;
  }

  if (cmd === 'ab') {
    const id = rest[0];
    if (!id) fail('ab requires a campaign id: outrovo ab <campaignId>');
    const r = await callTool('ab_results', { campaignId: id }, cfg);
    pretty(r);
    return;
  }

  if (cmd === 'add-prospect') {
    const campaignId = flag('campaign');
    const email = flag('email');
    if (!campaignId || !email) fail('add-prospect needs --campaign <id> --email <addr>');
    const r = await callTool('add_prospect', {
      campaignId,
      email,
      firstName: flag('first', ''),
      lastName: flag('last', ''),
      company: flag('company', ''),
    }, cfg);
    pretty(r);
    return;
  }

  fail('unknown command "' + cmd + '" — run: outrovo help');
})().catch(e => { console.error('✗ ' + (e.message || e)); process.exit(1); });
