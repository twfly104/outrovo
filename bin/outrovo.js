#!/usr/bin/env node
// Outrovo CLI — talks to the MCP endpoint (POST /api/mcp) with your
// integration token. Zero dependencies; Node 18+.
//
//   export OUTROVO_URL=https://outrovo.onrender.com   (or your own host)
//   export OUTROVO_TOKEN=<integration token>           (Settings → Generate integration token)
//
//   node bin/outrovo.js overview
//   node bin/outrovo.js campaigns
//   node bin/outrovo.js ab <campaignId>
//   node bin/outrovo.js add-prospect --campaign <id> --email a@b.co [--first-name Ana] [--last-name Rae] [--company Acme]
//   node bin/outrovo.js replies [--limit 10]

const BASE = (process.env.OUTROVO_URL || 'https://outrovo.onrender.com').replace(/\/+$/, '');
const TOKEN = process.env.OUTROVO_TOKEN || '';

function usage(code = 1) {
  console.error(`Usage: node bin/outrovo.js <command>

Commands:
  overview                          Aggregate stats
  campaigns                         List campaigns
  ab <campaignId>                   A/B test results
  add-prospect --campaign <id> --email <e> [--first-name X] [--last-name Y] [--company Z]
  replies [--limit N]               Latest inbox replies

Env: OUTROVO_URL (default https://outrovo.onrender.com), OUTROVO_TOKEN (required)`);
  process.exit(code);
}

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i];
    else positional.push(argv[i]);
  }
  return { flags, positional };
}

let rpcId = 0;
async function call(tool, args = {}) {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name: tool, arguments: args } }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(`HTTP ${res.status}`);
  if (data.error) throw new Error(data.error.message);
  const text = data.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : data.result;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) usage();
  if (!TOKEN) { console.error('Set OUTROVO_TOKEN first (Settings → Generate integration token).'); process.exit(1); }
  const { flags, positional } = parseFlags(rest);

  let out;
  if (cmd === 'overview') out = await call('overview_stats');
  else if (cmd === 'campaigns') out = await call('list_campaigns');
  else if (cmd === 'ab') {
    if (!positional[0]) { console.error('ab needs a campaignId'); usage(); }
    out = await call('ab_results', { campaignId: positional[0] });
  } else if (cmd === 'add-prospect') {
    if (!flags.campaign || !flags.email) { console.error('add-prospect needs --campaign and --email'); usage(); }
    out = await call('add_prospect', {
      campaignId: flags.campaign, email: flags.email,
      firstName: flags['first-name'], lastName: flags['last-name'], company: flags.company,
    });
  } else if (cmd === 'replies') out = await call('list_replies', { limit: Number(flags.limit) || 10 });
  else usage();

  console.log(JSON.stringify(out, null, 2));
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
