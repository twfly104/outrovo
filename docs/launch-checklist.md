# Outrovo Launch Checklist & Cost Estimate

What it actually takes to launch, what it costs, and what can wait.

## Required (can't launch without)

### 1. Render plan: Starter — $7/mo
- **Don't use Free**: spins down after 15 min idle (30–60s cold start on first hit) and the 750 hr/month allowance runs out for an always-on service.
- Starter $7/mo (512MB RAM, 0.5 CPU) is plenty for this stack (single Node process + JSON files).
- Upgrade to Standard ($25/mo) only when real traffic demands it.
- **Add a persistent disk** mounted at `DATA_DIR` — without it, all data in `data/*.json` is lost on every restart/deploy. 1GB disk is included with Starter.

### 2. Domain — $10–15/yr
- Strongly recommended. For a cold-email SaaS, your own domain (e.g. `outrovo.com`) matters beyond branding:
  - Campaign emails send from this domain — sender-domain reputation directly affects deliverability.
  - OAuth redirect URIs and unsubscribe links need a stable public URL.
- Namecheap / Cloudflare Registrar / Google Domains are all ~$10–15/yr for a .com.
- After buying: add the custom domain in Render, point DNS at it, and set `PUBLIC_URL` to it (must match OAuth app redirect URIs).

### 3. Sending pipeline — $0–20/mo
This is the core of the product. Don't self-host SMTP on day one — deliverability will be terrible.
- **Resend**: free tier 3,000 emails/mo, then $20/mo for 50K. Recommended — clean API, good deliverability. Set `RESEND_API_KEY`.
- Or let users connect their own Gmail/Microsoft via the OAuth flow you already built → $0 for you, sends ride the user's own mailbox quota.
- Suggested split: your own (owner) account sends via Resend; customers connect their own Google/Microsoft.

### 4. Database — $0 (don't migrate yet)
- Current storage is `data/*.json` — fine under ~100 users. Just make sure the Render disk (above) persists it.
- **Don't** move to Postgres now; it only adds ops cost at this stage. When JSON files actually become a bottleneck (thousands of users), Render Postgres is $7/mo.

## Strongly recommended (have at launch)

### 5. Stripe (payments) — $0/mo, 2.9% + $0.30 per charge
- Already built. Just set `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`.
- No monthly fee, transaction fees only.
- Webhook endpoint to register in Stripe Dashboard → Developers → Webhooks:
  `https://<your-domain>/api/billing/activate`, event: `checkout.session.completed`.
- Run the full flow in Test mode first, then one real-card charge before going Live.

### 6. LLM API key (AI features) — $5–20/mo
- `LLM_API_KEY` upgrades the landing-page assistant, AI sequence writer, ICP inference (scan & fill), and reply drafts to a real LLM.
- OpenAI gpt-4o-mini at low volume: ~$5–20/mo.
- Everything falls back to built-in heuristic engines without it, but the selling points get much weaker — set it.

## Optional (add when revenue justifies)

### 7. Lead Finder data source: Apollo / Hunter.io
- **Apollo**: Basic $49/mo → 900 credits. Largest dataset, integrates with the enrich feature.
- **The Free plan has NO API access** — `mixed_people/search` and `people/match` return `API_INACCESSIBLE`. A free key is fine to leave configured (the app falls back to the next source and shows an actionable error), but Lead Finder will not return Apollo data until you upgrade.
- **Hunter.io**: set `HUNTER_API_KEY` — used automatically when no Apollo key is configured. Works on the **Free plan (25 credits/mo, no card)** — 1 credit per domain per 10 emails, searches cap at 3 domains. Free-text ICP searches (e.g. "B2B SaaS founders") go through Hunter's Discover API to find matching companies first, so the full search form works without Apollo.
- **Recommendation: start with Hunter Free + the built-in crawler.** Subscribe to Apollo only when Lead Finder sees real usage. This is a variable cost — let it track revenue.

### 8. Google/Microsoft OAuth apps — $0
- Free to register, but `gmail.send` is a *sensitive scope* → Google OAuth verification review required.
- Review can take days to two weeks — submit early.
- Set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (and/or `MS_CLIENT_ID`/`MS_CLIENT_SECRET`) + `PUBLIC_URL`. Until verified, the tiles fall back to the app-password form.

## Cost estimate (monthly)

| Item | Lean | Comfortable |
|---|---|---|
| Render Starter | $7 | $7 |
| Domain (amortized) | ~$1 | ~$1 |
| Resend | $0 (free tier) | $20 |
| OpenAI | $5 | $20 |
| Apollo | $0 (fallback) | $49 |
| **Total** | **~$13/mo** | **~$97/mo** |

One-time: domain $10–15/yr, Google OAuth review (free, takes time).

## Recommended path

**MVP launch (~$13/mo)**: Render Starter + persistent disk + domain + Resend free tier + OpenAI $5. Lead Finder on the built-in fallback. The first paying user ($39) covers everything.

**Add later, after validation**: Apollo ($49) is the biggest single expense — subscribe only when 3–5 paying users are actually using Lead Finder.

## Render env-var checklist

| Var | Why | Required? |
|---|---|---|
| `ADMIN_KEY` | Unlocks admin endpoints (manual plan activation, signups list) | Yes |
| `DATA_KEY` | AES-256-GCM key for stored sender passwords/tokens — set **before** anyone connects an inbox; changing it orphans stored credentials | Yes |
| `PUBLIC_URL` | Absolute URLs in unsubscribe links + OAuth redirect match | Yes |
| `STRIPE_SECRET_KEY` | Real checkout sessions (else manual-instructions mode) | Yes (for paid) |
| `STRIPE_WEBHOOK_SECRET` | Verifies webhook → auto-activates plans after payment | Yes (for paid) |
| `RESEND_API_KEY` (or `SMTP_*`) | Real sending (else demo mode logs sends) | Recommended |
| `LLM_API_KEY` (+ optional `LLM_BASE_URL`, `LLM_MODEL`) | Real AI for assistant / sequence writer / scan-fill / reply drafts | Recommended |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | One-click Gmail connect | Optional |
| `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | One-click Microsoft connect | Optional |
| `APOLLO_API_KEY` | Lead Finder ICP search (needs a paid Apollo plan; else Hunter/builtin fallback) | Later |
| `HUNTER_API_KEY` | Lead Finder fallback via Hunter.io domain-search (Free plan works, 25 credits/mo) | Recommended |
| `INBOUND_DOMAIN` | Reply-routing addresses for the unified inbox | Optional |

Also: Render persistent disk mounted at `DATA_DIR`, and health check path `/api/health`.
