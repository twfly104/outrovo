# Outrovo — landing page project

A cold email & LinkedIn outreach SaaS landing page inspired by woodpecker.co's structure
(hero + product mockup, deliverability grid, testimonial, integrations, 4 steps, FAQ, footer).

## Stack
- Marketing frontend: `index.html`, `pricing.html`, `signup.html`, `login.html`,
  `styles.css`, `script.js` — no build step.
- Product app: `app.html` + `app.js` — session-gated dashboard (Overview,
  Campaigns, Prospects, Activity & tasks, Tools, Settings).
- Backend: `server.js` (Node >= 18, one dep: `nodemailer` — `npm install` first).
  Static hosting + JSON API + campaign engine. Persistence in `data/*.json`
  (gitignored). Passwords scrypt-hashed, sessions in httpOnly cookie
  `drummer_session` (7 days).
- Engine: ticks every `ENGINE_INTERVAL_MS` (default 15s). Steps: `email`
  (subject/body, `{{firstName}}`-style templating), `task` (manual LinkedIn
  queue), `wait`. Without `SMTP_HOST/USER/PASS` env it runs in DEMO mode —
  sends are logged to the activity feed, never delivered.
- AI assistant: `POST /api/app/ai/generate-sequence` (+ `POST
  /api/app/ai/scan-site` for website autofill). With `LLM_API_KEY`
  (+ optional `LLM_BASE_URL`, `LLM_MODEL`) it calls an OpenAI-compatible
  chat API; otherwise it uses the built-in copywriting engine
  (`localSequence`) — the UI labels which mode answered.
- Logo lives in `logo.svg` (vector bird mark) referenced as `.logo-img`
  across pages — update the file once to rebrand everywhere.

## Monetization
- Plans in `PLANS` (server.js): trial (14d, 100 prospects, 1 campaign),
  starter $29 (2K/3), growth $49 (10K/10 + LinkedIn), scale $99 (∞).
- Signup auto-assigns `plan: 'trial'` + `trialEnds`. `planOf()` marks
  expiry; campaign & prospect creation return 402 with `upgrade: true`.
- Billing: `POST /api/billing/checkout` → Stripe Checkout when
  `STRIPE_SECRET_KEY` set, else manual instructions. Activation via
  `POST /api/billing/activate` (admin key or Stripe webhook, verified
  when `STRIPE_WEBHOOK_SECRET` set). Dashboard shows plan + trial banner;
  pricing page Upgrade buttons call checkout for signed-in users.
- Fonts: Fraunces (display) + Instrument Sans (body) via Google Fonts.
- Design tokens in `:root` of `styles.css`: paper `#f7f7f8`, ink `#0b0c0e`,
  orange crest `#f97316` (deep `#ea580c`), forest `#15171b`. `index.html` uses
  `styles-lite.css` with the same palette under shorter variable names
  (`--accent` = `--crest`, `--bg` = `--paper`, etc.).

## Run
- `node server.js` (or `PORT=xxxx node server.js`) from repo root.
- Public URL in this sandbox: https://work-1-wtjewisfdrzmkddb.prod-runtime.all-hands.dev/

## Launch checklist (hosting env vars — do these in Render/Vercel)
- `ADMIN_KEY` — strong random value; without it admin endpoints are locked
  (verified: 403 with no key, 403 with wrong key, 200 with correct key).
- `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` (+ optional `SMTP_FROM`), or
  `RESEND_API_KEY` — otherwise the engine runs in demo mode and logs sends
  instead of delivering them. The pipeline is end-to-end verified
  (`POST /api/app/tools/test-email` delivered via real SMTP during audit).
- `STRIPE_SECRET_KEY` (+ `STRIPE_WEBHOOK_SECRET` for webhook activation) —
  otherwise checkout returns manual instructions.

## API
- `POST /api/signup` — validates, scrypt-hashes password, 409 on duplicate email
- `POST /api/login` — verifies hash, sets session cookie; `POST /api/logout`; `GET /api/me`
- `GET /api/health` — status + user count
- `GET /api/signups` — admin list, needs `x-admin-key` header (env `ADMIN_KEY`;
  no default — admin endpoints stay locked with 403 until it is set)
- App (session required): `/api/app/overview`, `/api/app/campaigns` (GET/POST,
  `/:id/activate|pause`, DELETE), `/api/app/prospects` (GET/POST single+CSV,
  `/:id/verify`), `/api/app/activity`, `/api/app/tasks` (`/:id/done`),
  `/api/app/tools/verify` (syntax + MX), `/api/app/tools/domain-audit`
  (MX/SPF/DMARC/DKIM-selector DNS checks), `/api/app/engine`
- `/app.html` and `/app.js` redirect to `/login.html` without a session

## Conventions
- Brand name is "Outrovo" (formerly "Drummer" placeholder).
- All product screenshots are pure CSS/HTML mockups (`.app-card`, `.panel`, `.orbit`).
- JS behaviors: sticky header shadow, FAQ accordion (`.faq-item`), scroll reveal
  (`.reveal` + IntersectionObserver), mobile menu toggle, demo modal (`#demoModal`,
  triggered by `[data-demo]`), pricing billing toggle (`#billToggle` flips
  `data-monthly`/`data-yearly`), client-side form validation on `signup.html` /
  `login.html` with success state swap.
- All pages share the same header/footer markup — update links in every page when
  nav changes. CTAs point to `signup.html` / `login.html` / `pricing.html`.
- Responsive breakpoints at 1024px and 720px.

## Phase 1 additions (multi-inbox foundation)
- Sender accounts: `data/senders.json`, per-user inboxes with provider presets
  (`gmail`/`microsoft`/`custom` SMTP). App passwords stored AES-256-GCM-encrypted
  in `encPass` (`DATA_KEY` env; falls back to deriving from ADMIN_KEY — set
  DATA_KEY before users connect inboxes; changing it orphans stored passwords).
- `pickSender(owner, prospect)`: deterministic round-robin across the owner's
  active inboxes + the env gateway (RESEND_API_KEY / legacy SMTP_* env), skipping
  inboxes at their daily cap. `recordSend` advances warmup state.
- Warmup: `sender.warmup` → capToday = min(dailyLimit, startCap + rampDays *
  WARMUP_RAMP_INCREMENT (5)); rampDays increments once per active send day.
- Spintax `{a|b|c}` (nested, MAX_SPINTAX_DEPTH 10, deterministic per
  prospect+template) + `{{var}}` templating over prospect fields AND
  `prospect.customVars` (CSV header row: extra columns → customVars).
  `personalize()` = renderTemplate then applySpintax. Preview via
  POST /api/app/tools/preview-spintax.
- All-capped inboxes → engine defers the prospect CAP_RETRY_MS (1h), no error.
- Step delays get ±20% jitter at scheduling time.
- Signup fires a fire-and-forget domainAudit of the signup domain; result lands
  in the activity feed (`domain-audit` event, meta.checks) and Settings →
  Domain health renders it instantly.
- IMPORTANT: PATCH is an allowed method in the server allowlist — anything
  adding a route with another method must extend the allowlist too.

## Phase 2/3 additions (deliverability ops, compliance, LinkedIn safety)
- Campaign pacing: `dailyCap` (default 25), `sendWindowStart/End` hours,
  `timezone` (Intl tz, fallback UTC). Engine defers prospects outside the
  window or past the cap (CAP_RETRY_MS 1h) — never fails. `sentLog`,
  `sentCount`, `bounceCount` counters on the campaign record. Caps count
  in-tick async dispatches (`dispatchedThisTick`) so bursts can't overrun.
- Unsubscribe: every campaign email gets a footer link + `List-Unsubscribe` /
  `List-Unsubscribe-Post: One-Click` headers pointing at
  `GET|POST /api/unsubscribe?u&e&t` (HMAC-SHA256 token from UNSUB_KEY,
  derived from DATA_KEY/ADMIN_KEY). Per-user `user.suppressed[]` list;
  suppressing stops in-flight sequences and skips future imports
  (`skippedSuppressed` in import response). Manage via /api/app/suppression.
- Bounces: `classifySendError` (HARD_BOUNCE_RE/SOFT_BOUNCE_RE). Hard →
  prospect.bounced + finished + bounceCount. Soft → same-step retry
  (stepIndex rewound in the catch — it already advanced), max 3 × 30 min.
- Replies: POST /api/email/receive matches `from` to a prospect, sets
  replied/finished (sequence stops), reply records carry `owner`; inbox and
  tasks endpoints are owner-filtered. Legacy ownerless records stay visible.
- LinkedIn: task steps have `taskKind` (connect|message|view), tasks carry
  `owner` + `dueAt` (random within LINKEDIN_SPREAD_HOURS 6h). Daily budget
  `user.linkedinBudget` (env LINKEDIN_DAILY_BUDGET default 20, cap 100) —
  over budget defers the prospect. Plan gate: only plans with linkedIn:true.
- Autopilot bridge: POST /api/app/integrations/token issues `ovk_…` (shown
  once, sha256 stored). POST /api/integrations/linkedin/callback with
  `x-integration-token` marks tasks done by taskId or prospect email;
  outcome=replied also stops the prospect's email sequence (prospect email
  falls back to the task's own prospect when only taskId is sent).
- PUBLIC_URL env sets absolute URLs in unsubscribe links/callback examples
  (defaults to https://outrovo.onrender.com).

## Phase 2/3 real spec (agency scale + intelligence)
- PLANS now includes `agency` ($249, agency:true, whiteLabel:true); scale
  gets whiteLabel:true. `planOf` returns the full flags.
- Agency: `user.owner` = agency email for client accounts. Agency dashboard
  routes (`/api/app/agency/clients`) list clients with per-client rollup
  (campaigns, prospects, sent, bounces, inboxes) + consolidated billing
  (agency plan + seats × $49). Clients can be detached (orphan, keeps data).
- White-label: `user.whiteLabel` = { brandName, logoUrl, cname, accentColor }.
  `POST /api/app/white-label` gated to whiteLabel plans. Branded report at
  `GET /api/reports/branded` (session or admin key + ?u=, ?c= for one client)
  renders per-workspace stats with agency branding.
- Conditional branching: email steps carry `label` + `branchNext` =
  { onReplied, onClicked, onNoReply } (step labels as jump targets). Engine
  resolves next step via `resolveNextIndex` after each send — events
  (replied/clicked) set prospect flags that route on the next tick. Click
  tracking: GET /api/t/:id?u=<url> logs the click and 302s through.
- Smart Unibox: `classifyIntent` (LLM when LLM_API_KEY, heuristic fallback
  otherwise) labels every inbound reply; unsubscribe-intent replies
  auto-suppress. Replies carry `intent`; inbox UI renders chips and an
  ✦ AI draft button (POST /api/app/inbox/:id/draft — LLM with reply
  context + user identity, or intent-keyed heuristic templates).
- Enrichment: `callEnrichment` picks Apollo (APOLLO_API_KEY) → Hunter
  (HUNTER_API_KEY) → Dropcontact (DROPCONTACT_API_KEY) → builtin
  (MX + Gravatar). Single: POST /api/app/prospects/:id/enrich. Bulk:
  POST /api/app/campaigns/:id/enrich-all (50/batch). Stores `enriched`
  on the prospect and backfills empty name/company fields.
- Verification gate: POST /api/app/campaigns/:id/verify-all (100/batch)
  runs verifyEmail on every unfinished prospect; undeliverable → pulled
  from sequence (`skipped: 'undeliverable'`). `verifyEmail` now probes
  the primary MX with a randomized RCPT to detect catch-all domains
  (`verified.catchAll`), which stay in but are flagged accept-all.
- CRM webhooks: `user.integrations[]` = { url, provider, secret, events[] }.
  `fireWebhooks(owner, event, payload)` fans out on sent/bounce/reply/
  unsubscribe/click/task/campaign. HMAC-signed when secret set. Managed in
  Settings → CRM & automation; POST /:id/test verifies reachability.
  Webhook URLs allow HTTP only for localhost (testing); production must use
  HTTPS.

## Test evidence for audit gaps (iteration 4)
- HMAC webhook: captured + validated end-to-end via localhost receiver
  (`[WEBHOOK VALID] event=sent email=sig@test.io valid=true` — receiver
  recomputed the HMAC over the exact body and it matched the header).
- Intent-classified unsubscribe → suppression: POST /api/email/receive with
  opt-out text produced `intent: unsubscribe`, `matched: true`, and the
  suppression record `[{ email: 'suppress@test.io', reason: 'intent-unsubscribe', ... }]`
  on the user; unsubscribe webhook also fired valid=true.
- Enrichment real provider path: mocked Apollo fetch proved the full flow —
  `X-Api-Key` header, payload email, response parsing into
  { firstName, lastName, company, title, city, seniority }, and storage on
  the prospect. Real Apollo/Hunter endpoints respond 401 to invalid keys
  (reachable, auth-gated). No user-supplied keys exist to do a live call.
- CNAME white-label: raw HTTP request with `Host: outrovo.work` returns
  `<title>CN Brand — Outreach</title>` with brand logo/name replaced
  (fetch strips Host, so raw http.request is the way to prove it).
- Consolidated billing → charge: billing endpoint computes seats × $49 +
  agency fee ($298 for 1 client). Stripe checkout creates a real session
  (mocked response → `https://checkout.stripe.com/pay/cs_test_audit`);
  requires STRIPE_SECRET_KEY env to charge real cards.
