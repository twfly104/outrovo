# outrovo

Cold outreach from your terminal. Zero dependencies, talks MCP to `outrovo.co`.

## Install

```bash
npm install -g outrovo
# or run ad-hoc
npx outrovo --help
```

## Setup

1. Open https://outrovo.co → **Settings → LinkedIn autopilot bridge → Generate integration token**.
2. Save it locally:

```bash
outrovo init --token <your-token>
```

The token lives in `~/.outrovo/config.json` (chmod 600).

## Commands

```bash
outrovo stats                            # campaigns, sends, replies, bounces
outrovo campaigns                        # list campaigns
outrovo replies --limit 20               # recent replies with intent label
outrovo ab <campaignId>                  # A/B test results
outrovo add-prospect --campaign <id> --email a@b.com [--first N] [--last N] [--company C]
```

## Self-hosted

Point at a different base URL:

```bash
outrovo init --token <token> --base https://your-instance.example.com
```

## Why MCP

The CLI speaks JSON-RPC 2.0 directly to `/api/mcp`, the same endpoint Claude
Desktop and Cursor use. One auth mechanism, one protocol, no separate REST
token to manage.
