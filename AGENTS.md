# Outrovo ÔÇö landing page project

A cold email & LinkedIn outreach SaaS landing page inspired by woodpecker.co's structure
(hero + product mockup, deliverability grid, testimonial, integrations, 4 steps, FAQ, footer).

## Stack
- Marketing frontend: `index.html`, `pricing.html`, `signup.html`, `login.html`,
  `styles.css`, `script.js` ÔÇö no build step.
- Product app: `app.html` + `app.js` ÔÇö session-gated dashboard with 4 pages:
  Overview (stats + LinkedIn to-dos + event feed), Campaigns (list + prospect
  management), Inbox, Settings (quick-setup wizard + one-click sender connect;
  advanced tools in collapsible `<details>` sections). Agency page is
  hidden unless the plan has Agency seats.
- Settings layout: 3-step wizard on top (ÔĹá connect inbox ÔÇö status derives
  from `GET /api/app/senders`; ÔĹí domain check; ÔĹó send test ÔÇö ÔĹí/ÔĹó marked done
  in localStorage keyed `ov-setup:<email>`), then Sender accounts with
  provider tiles (Google/Microsoft/Other), then accordions: Deliverability
  tools, LinkedIn automation, Suppression list, CRM & automation, Sending
  engine, Compliance, Account.
- Backend: `server.js` (Node >= 18, one dep: `nodemailer` ÔÇö `npm install` first).
  Static hosting + JSON API + campaign engine. Persistence in `data/*.json`
  (gitignored). Passwords scrypt-hashed, sessions in httpOnly cookie
  `drummer_session` (7 days).
- Engine: ticks every `ENGINE_INTERVAL_MS` (default 15s). Steps: `email`
  (subject/body, `{{firstName}}`-style templating), `task` (manual LinkedIn
  queue), `wait`. Without `SMTP_HOST/USER/PASS` env it runs in DEMO mode ÔÇö
  sends are logged to the activity feed, never delivered.
- AI assistant: `POST /api/app/ai/generate-sequence` (+ `POST
  /api/app/ai/scan-site` for website autofill). With `LLM_API_KEY`
  (+ optional `LLM_BASE_URL`, `LLM_MODEL`) it calls an OpenAI-compatible
  chat API; otherwise it uses the built-in copywriting engine
  (`localSequence`) ÔÇö the UI labels which mode answered.
- The app dashboard CSS (bottom of `styles.css`, "App dashboard" section) mirrors the
  landing page: `.app-body` re-declares the tokens to the styles-lite values
  (paper #f7f7f8, crest #f97316, ink #0b0c0e) so the product feels identical
  to the marketing site. Nav/action icons are inline SVGs, not emoji.
- Logo lives in `logo.svg` (vector bird mark) referenced as `.logo-img`
  across pages ÔÇö update the file once to rebrand everywhere.

## Monetization
- Plans in `PLANS` (server.js): trial (14d, 100 prospects, 1 campaign),
  starter $29 (2K/3), growth $49 (10K/10 + LinkedIn), scale $99 (Ôł×).
- Signup auto-assigns `plan: 'trial'` + `trialEnds`. `planOf()` marks
  expiry; campaign & prospect creation return 402 with `upgrade: true`.
- Billing: `POST /api/billing/checkout` Ôćĺ Stripe Checkout when
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

## Launch checklist (hosting env vars ÔÇö do these in Render/Vercel)
- `ADMIN_KEY` ÔÇö strong random value; without it admin endpoints are locked
  (verified: 403 with no key, 403 with wrong key, 200 with correct key).
- `LLM_API_KEY` (or `OPENAI_API_KEY`) ÔÇö REQUIRED for the landing-page
  assistant to answer with a real LLM (also upgrades the AI sequence writer,
  site-scan, reply-intent, and reply drafts). Declared in `render.yaml`. To
  check which mode a deployment is in without guessing:
  `curl https://<host>/api/assistant` → `{"mode":"llm"}` (keyed) or
  `{"mode":"keyword"}` (no key — assistant uses built-in keyword answers and
  can hit the canned fallback on off-script questions). Setting this one var
  is the single owner action that makes the assistant "actually smart".
- `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` (+ optional `SMTP_FROM`), or
  `RESEND_API_KEY` ÔÇö otherwise the engine runs in demo mode and logs sends
  instead of delivering them. The pipeline is end-to-end verified
  (`POST /api/app/tools/test-email` delivered via real SMTP during audit).
- `STRIPE_SECRET_KEY` (+ `STRIPE_WEBHOOK_SECRET` for webhook activation) ÔÇö
  otherwise checkout returns manual instructions.
- `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` or `MS_CLIENT_ID`/`MS_CLIENT_SECRET`
  ÔÇö enables one-click "Authorize" sender connect in Settings (OAuth consent
  popup; refresh/access tokens AES-256-GCM-encrypted at rest like app
  passwords; nodemailer XOAuth2 transports, engine picks via same rotation).
  `PUBLIC_URL` must match the OAuth app's registered redirect URI
  (`{PUBLIC_URL}/api/app/oauth/{google|microsoft}/callback`). Without these
  env vars the tiles fall back to the minimal email + app-password form
  (Google tile links to myaccount.google.com/apppasswords). Routes:
  `GET /api/app/oauth/status` (feature flags per provider),
  `GET /api/app/oauth/:id/start` (302 to consent, HMAC state binds session),
  `GET /api/app/oauth/:id/callback` (upserts sender, postMessages result to
  the opener popup). `publicSender` returns `oauth:true` and strips tokens.
- `APOLLO_API_KEY` or `HUNTER_API_KEY` ÔÇö powers Lead Finder search
  (Campaigns page), including optional daily auto-pilot
  (`PUT /api/app/lead-finder/autopilot`). Without one, Lead Finder falls back to crawling the
  target company domains the user types in and MX-verifies what it finds.
  Hunter path: `domain-search` only accepts a DOMAIN, so ICP input
  (keywords/title/size/location) first goes through the free
  `POST /v2/discover` (`hunterDiscoverDomains` Г”Г‡Г¶ keywords/headcount/country
  filters, natural-language `query` fallback) to resolve companies, then
  domain-searches each (cap 5, `type=personal` + seniority/department mapped
  from the title by `hunterTitleFilters`). `HUNTER_BASE_URL` env overrides
  the API origin for mock-server tests. Domain-looking keywords skip
  Discover entirely. Empty-search responses carry `errors[]` Г”Г‡Г¶ the UI shows
  them instead of the generic "no leads matched" note.
  Quotas per plan: trial 25, starter 100, growth 1,000, scale/agency 10,000
  credits/month (1 credit per returned lead), tracked on `user.leadFinder`.
  `GET /api/app/lead-finder/status` also returns `seed = { website }` (the
  signup email's domain, scan box only ÔÇö never target keywords, so the user
  never ends up searching for themselves) when autopilot has no saved
  criteria; the form auto-fills from `autopilot` first, then `seed`, then
  `GET /api/app/lead-finder/prefill` (scans the signup domain's site to
  infer keywords/title/size/location; uses LLM when `LLM_API_KEY` is set,
  heuristic regexes otherwise; fetches with `Accept-Language: en` to
  localize consistent results; sizes returned match the UI select options
  exactly, e.g. `11,50`). The card also has an
  explicit **Your company website + Scan & fill** control posting to
  `POST /api/app/lead-finder/scan-fill` (same inference on an arbitrary URL;
  overwrites fields, unlike the non-destructive auto prefill). Both share
  `inferIcpFromSite(domain)` in server.js. `heuristicIcp` (used without an
  LLM, and as the fallback when the LLM echoes the scanned domain back)
  rejects the canned ~30-category list ÔÇö keywords come from the site's own
  copy via (1) positioning-formula phrases like "built for X / platform
  for Y / trusted by Z" (`extractMarketPhrases`), (2) raw-adjacent bigrams
  that repeat or appear in h1ÔÇôh4 (`extractSignificantTerms`, gated by
  STOPWORDS / GENERIC_WORDS / not-both-generic, max 3), (3) canned
  INDUSTRY_CUES as backstop only; the scanned domain is last resort.
  `cleanPhrase` caps and cleans each phrase. Title falls from a `talent`
  phrase (recruiter) or an audience persona map (sales/revenue Ôćĺ head of
  sales, engineers Ôćĺ head of engineering, data Ôćĺ head of data) before
  BUYER_PERSONAS. Location reads /about ┬Ě /contact ┬Ě /company for the real
  HQ city over homepage claims. The LLM prompt is likewise ICP-focused
  (fill the target market, never the user's own domain). The builtin
  crawler no longer truncates pages ÔÇö `slice(0, 500000)` was cutting off
  emails past 500KB.
- ICP inference gotchas (learned from a Taiwanese agency site,
  si.sgidigi.com, whose location was misdetected as "United States"):
  `fetchSite` returns full page text + a separate `tail` (last 25KB) because
  heavy builders (Framer/Webflow) put the footer past the 600KB fetch cap ÔÇö
  never run location regexes against a head-truncated body. Location cues
  include CJK tokens (ń║×Š┤▓/ňĆ░Š╣ż/ňĆ░šüú/ňĆ░ňîŚÔÇŽ), ranked extraText > headings >
  body. `CJK_INDUSTRY_CUES` maps Chinese industry terms (ÚŤ╗ňĽć/ÚŤ╗ňşÉňĽćňőÖ Ôćĺ
  "ecommerce brands", ňôüšëî Ôćĺ "consumer brands", ÚĄÉÚú▓ Ôćĺ "restaurants", ÔÇŽ)
  into keyword/title candidates. valueProp skips greeting/thank-you
  headings (ŔŽ¬ŠäŤšÜä/ŠäčŔČŁ/hello/welcomeÔÇŽ) ÔÇö Framer modals inject those before
  the real hero copy. Size inference must NOT match weak product words
  ("integration", "workflow") ÔÇö they are vocabulary, not target-size
  signals, and produced bogus "11ÔÇô50" fills. Regression checks: hunter.io Ôćĺ
  United States/founder; stripe.com Ôćĺ United States/head of sales;
  example.com Ôćĺ empty keywords (no domain echo). Each result row
  also has a **ÔťŽ Intel** column: clicking calls
  `POST /api/app/lead-finder/intel` (`leadIntel()` in server.js; cached in
  memory 1h per domain) which scans the lead's company site and returns
  summary / services & features / how they compare / why buyers choose
  them / a sender angle (LLM when configured, heuristic sentence-picker
  otherwise; resolves the company field first, falls back to the email's
  domain). The frontend keeps the last scanned site title (`servicePitch`)
  and passes it as `pitch`, personalizing the angle.
- `LLM_API_KEY` (or `OPENAI_API_KEY`; optional `LLM_BASE_URL`, `LLM_MODEL`) ÔÇö
  upgrades the AI sequence writer, site-scan prefill, reply-intent
  classification, and AI reply drafts to a real LLM. Without it all four run
  on built-in heuristic engines, so nothing breaks.
- Landing-page assistant (index.html "Ask us" widget): posts to
  `POST /api/assistant` ({q, history}) which answers with a real LLM
  (ASSISTANT_API_KEY || LLM_API_KEY || OPENAI_API_KEY; ASSISTANT_BASE_URL ||
  LLM_BASE_URL; ASSISTANT_MODEL || LLM_MODEL, default gpt-4o-mini). The system
  prompt is ASSISTANT_PERSONA + ASSISTANT_FACTS in server.js — grounded in the
  site's own copy. Replies are HTML-sanitized (only strong/em/br + local
  links: #faq, pricing.html, signup.html, /) before the client inserts them
  via innerHTML. Rate-limited 30 req / 10 min / IP; answers cached 1h by
  normalized question. Without a key the route returns 503 and the widget
  falls back to its local keyword matcher (which also handles greetings now),
  so the panel never dead-ends.
  Verified end-to-end against a REAL LLM (not a mock): ran a local Ollama
  serving the actual TinyLlama model as the OpenAI-compatible upstream
  (ASSISTANT_BASE_URL=http://127.0.0.1:11434/v1). Visitor question → POST
  /api/assistant → real generated answer grounded in FACTS, sanitized,
  and served from cache on repeat (cached:true). The full loop works with
  any OpenAI-compatible endpoint — including a self-hosted model — so the
  owner can use OpenAI or point LLM_BASE_URL at a local model instead.

## API
- `POST /api/signup` ÔÇö validates, scrypt-hashes password, 409 on duplicate email
- `POST /api/login` ÔÇö verifies hash, sets session cookie; `POST /api/logout`; `GET /api/me`
- `GET /api/health` ÔÇö status + user count
- `GET /api/signups` ÔÇö admin list, needs `x-admin-key` header (env `ADMIN_KEY`;
  no default ÔÇö admin endpoints stay locked with 403 until it is set)
- App (session required): `/api/app/overview`, `/api/app/campaigns` (GET/POST,
  `/:id/activate|pause`, DELETE), `/api/app/prospects` (GET/POST single+CSV,
  `/:id/verify`), `/api/app/activity`, `/api/app/tasks` (`/:id/done`),
  `/api/app/tools/verify` (syntax + MX), `/api/app/tools/domain-audit`
  (MX/SPF/DMARC/DKIM-selector DNS checks), `/api/app/lead-finder/status|search|enroll`
  (ICP/domain search Ôćĺ verify Ôćĺ add to campaign, credit-metered),
  `/api/app/campaigns/:id/ab-results` (per-step A/B variant stats), `/api/app/engine`
- A/B testing: email steps may carry `variantB {subject, body}` (builder UI has
  a "Ôçä A/B test this step" toggle). Assignment is deterministic per
  prospect+step (`prospect.abLog`), stats via ab-results (winner declared at
  Ôëą10 sends per arm by reply rate).
- MCP: `POST /api/mcp` ÔÇö JSON-RPC 2.0 (initialize, tools/list, tools/call)
  with tools overview_stats, list_campaigns, ab_results, add_prospect,
  list_replies. Auth: `Authorization: Bearer <integration token>` (Settings Ôćĺ
  LinkedIn autopilot bridge Ôćĺ Generate integration token).
- CLI: `bin/outrovo.js` (zero-dep, Node 18+, `npm run cli` or the `outrovo`
  bin). Env `OUTROVO_URL` + `OUTROVO_TOKEN`; commands overview, campaigns,
  ab, add-prospect, replies ÔÇö all ride the MCP endpoint.
- `/app.html` and `/app.js` redirect to `/login.html` without a session

## Conventions
- Brand name is "Outrovo" (formerly "Drummer" placeholder).
- All product screenshots are pure CSS/HTML mockups (`.app-card`, `.panel`, `.orbit`).
- JS behaviors: sticky header shadow, FAQ accordion (`.faq-item`), scroll reveal
  (`.reveal` + IntersectionObserver), mobile menu toggle, demo modal (`#demoModal`,
  triggered by `[data-demo]`), pricing billing toggle (`#billToggle` flips
  `data-monthly`/`data-yearly`), client-side form validation on `signup.html` /
  `login.html` with success state swap.
- All pages share the same header/footer markup ÔÇö update links in every page when
  nav changes. CTAs point to `signup.html` / `login.html` / `pricing.html`.
- Responsive breakpoints at 1024px and 720px.

## Phase 1 additions (multi-inbox foundation)
- Sender accounts: `data/senders.json`, per-user inboxes with provider presets
  (`gmail`/`microsoft`/`custom` SMTP). App passwords stored AES-256-GCM-encrypted
  in `encPass` (`DATA_KEY` env; falls back to deriving from ADMIN_KEY ÔÇö set
  DATA_KEY before users connect inboxes; changing it orphans stored passwords).
- `pickSender(owner, prospect)`: deterministic round-robin across the owner's
  active inboxes + the env gateway (RESEND_API_KEY / legacy SMTP_* env), skipping
  inboxes at their daily cap. `recordSend` advances warmup state.
- Warmup: `sender.warmup` Ôćĺ capToday = min(dailyLimit, startCap + rampDays *
  WARMUP_RAMP_INCREMENT (5)); rampDays increments once per active send day.
- Spintax `{a|b|c}` (nested, MAX_SPINTAX_DEPTH 10, deterministic per
  prospect+template) + `{{var}}` templating over prospect fields AND
  `prospect.customVars` (CSV header row: extra columns Ôćĺ customVars).
  `personalize()` = renderTemplate then applySpintax. Preview via
  POST /api/app/tools/preview-spintax.
- All-capped inboxes Ôćĺ engine defers the prospect CAP_RETRY_MS (1h), no error.
- Step delays get ┬▒20% jitter at scheduling time.
- Signup fires a fire-and-forget domainAudit of the signup domain; result lands
  in the activity feed (`domain-audit` event, meta.checks) and Settings Ôćĺ
  Domain health renders it instantly.
- IMPORTANT: PATCH is an allowed method in the server allowlist ÔÇö anything
  adding a route with another method must extend the allowlist too.

## Phase 2/3 additions (deliverability ops, compliance, LinkedIn safety)
- Campaign pacing: `dailyCap` (default 25), `sendWindowStart/End` hours,
  `timezone` (Intl tz, fallback UTC). Engine defers prospects outside the
  window or past the cap (CAP_RETRY_MS 1h) ÔÇö never fails. `sentLog`,
  `sentCount`, `bounceCount` counters on the campaign record. Caps count
  in-tick async dispatches (`dispatchedThisTick`) so bursts can't overrun.
- Unsubscribe: every campaign email gets a footer link + `List-Unsubscribe` /
  `List-Unsubscribe-Post: One-Click` headers pointing at
  `GET|POST /api/unsubscribe?u&e&t` (HMAC-SHA256 token from UNSUB_KEY,
  derived from DATA_KEY/ADMIN_KEY). Per-user `user.suppressed[]` list;
  suppressing stops in-flight sequences and skips future imports
  (`skippedSuppressed` in import response). Manage via /api/app/suppression.
- Bounces: `classifySendError` (HARD_BOUNCE_RE/SOFT_BOUNCE_RE). Hard Ôćĺ
  prospect.bounced + finished + bounceCount. Soft Ôćĺ same-step retry
  (stepIndex rewound in the catch ÔÇö it already advanced), max 3 ├Ś 30 min.
- Replies: POST /api/email/receive matches `from` to a prospect, sets
  replied/finished (sequence stops), reply records carry `owner`; inbox and
  tasks endpoints are owner-filtered. Legacy ownerless records stay visible.
- LinkedIn: task steps have `taskKind` (connect|message|view), tasks carry
  `owner` + `dueAt` (random within LINKEDIN_SPREAD_HOURS 6h). Daily budget
  `user.linkedinBudget` (env LINKEDIN_DAILY_BUDGET default 20, cap 100) ÔÇö
  over budget defers the prospect. Plan gate: only plans with linkedIn:true.
- Autopilot bridge: POST /api/app/integrations/token issues `ovk_ÔÇŽ` (shown
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
  (agency plan + seats ├Ś $49). Clients can be detached (orphan, keeps data).
- White-label: `user.whiteLabel` = { brandName, logoUrl, cname, accentColor }.
  `POST /api/app/white-label` gated to whiteLabel plans. Branded report at
  `GET /api/reports/branded` (session or admin key + ?u=, ?c= for one client)
  renders per-workspace stats with agency branding.
- Conditional branching: email steps carry `label` + `branchNext` =
  { onReplied, onClicked, onNoReply } (step labels as jump targets). Engine
  resolves next step via `resolveNextIndex` after each send ÔÇö events
  (replied/clicked) set prospect flags that route on the next tick. Click
  tracking: GET /api/t/:id?u=<url> logs the click and 302s through.
- Smart Unibox: `classifyIntent` (LLM when LLM_API_KEY, heuristic fallback
  otherwise) labels every inbound reply; unsubscribe-intent replies
  auto-suppress. Replies carry `intent`; inbox UI renders chips and an
  ÔťŽ AI draft button (POST /api/app/inbox/:id/draft ÔÇö LLM with reply
  context + user identity, or intent-keyed heuristic templates).
- Enrichment: `callEnrichment` picks Apollo (APOLLO_API_KEY) Ôćĺ Hunter
  (HUNTER_API_KEY) Ôćĺ Dropcontact (DROPCONTACT_API_KEY) Ôćĺ builtin
  (MX + Gravatar). Single: POST /api/app/prospects/:id/enrich. Bulk:
  POST /api/app/campaigns/:id/enrich-all (50/batch). Stores `enriched`
  on the prospect and backfills empty name/company fields.
- Verification gate: POST /api/app/campaigns/:id/verify-all (100/batch)
  runs verifyEmail on every unfinished prospect; undeliverable Ôćĺ pulled
  from sequence (`skipped: 'undeliverable'`). `verifyEmail` now probes
  the primary MX with a randomized RCPT to detect catch-all domains
  (`verified.catchAll`), which stay in but are flagged accept-all.
- CRM webhooks: `user.integrations[]` = { url, provider, secret, events[] }.
  `fireWebhooks(owner, event, payload)` fans out on sent/bounce/reply/
  unsubscribe/click/task/campaign. HMAC-signed when secret set. Managed in
  Settings Ôćĺ CRM & automation; POST /:id/test verifies reachability.
  Webhook URLs allow HTTP only for localhost (testing); production must use
  HTTPS.

## Statutory & customer-protection audit (Aug 2026)
- Signup consent is now server-enforced: `POST /api/signup` rejects with
  `{terms:'required'}` unless `terms === true`, and stores
  `user.consent = { termsVersion, privacyVersion, at }` (GDPR Art. 7 record).
  `TERMS_VERSION` const in server.js ÔÇö bump whenever terms.html/privacy.html
  change materially. Frontend sends the flag explicitly (`script.js`).
- CAN-SPAM footer: every campaign email footer now carries the sender's
  postal address (`user.mailingAddress`, set in Settings Ôćĺ Compliance card,
  saved via POST /api/app/settings) above the unsubscribe link. Verified
  end-to-end through a local SMTP sink: headers include
  `List-Unsubscribe` + `List-Unsubscribe-Post: One-Click`, body includes
  address + HMAC-signed one-click link.
- Data rights (GDPR Arts. 15/17/20), all session-gated and tested:
  `GET /api/app/export` Ôćĺ full JSON download of account (salt/hash/token-hash
  stripped), campaigns, prospects, replies, tasks, senders (encPass stripped);
  `DELETE /api/app/account` Ôćĺ password-confirmed erasure of the user +
  campaigns + prospects + replies + tasks + senders + sessions, clears the
  cookie. Wrong password Ôćĺ 403; unauthenticated Ôćĺ 401.
- Legal pages: privacy.html rewritten (controller identity + privacy@ contact,
  legal bases, controller/processor split for prospect data + DPA note,
  retention schedule, sub-processors, SCC transfer note, full rights list,
  cookie disclosure, supervisory-authority right). terms.html gained a
  governing-law section (Delaware). login.html + app.html footers now link
  Terms/Privacy (previously missing).
- Test harness used: `DATA_DIR=/tmp/... PORT=xxxx SMTP_HOST=127.0.0.1
  SMTP_PORT=2525` against a hand-rolled net.Server SMTP sink that captures
  DATA payloads ÔÇö is the reliable way to verify real sends without touching
  production data/ or external mail.

## Test evidence for audit gaps (iteration 4)
- HMAC webhook: captured + validated end-to-end via localhost receiver
  (`[WEBHOOK VALID] event=sent email=sig@test.io valid=true` ÔÇö receiver
  recomputed the HMAC over the exact body and it matched the header).
- Intent-classified unsubscribe Ôćĺ suppression: POST /api/email/receive with
  opt-out text produced `intent: unsubscribe`, `matched: true`, and the
  suppression record `[{ email: 'suppress@test.io', reason: 'intent-unsubscribe', ... }]`
  on the user; unsubscribe webhook also fired valid=true.
- Enrichment real provider path: mocked Apollo fetch proved the full flow ÔÇö
  `X-Api-Key` header, payload email, response parsing into
  { firstName, lastName, company, title, city, seniority }, and storage on
  the prospect. Real Apollo/Hunter endpoints respond 401 to invalid keys
  (reachable, auth-gated). No user-supplied keys exist to do a live call.
- CNAME white-label: raw HTTP request with `Host: outrovo.work` returns
  `<title>CN Brand ÔÇö Outreach</title>` with brand logo/name replaced
  (fetch strips Host, so raw http.request is the way to prove it).
- Consolidated billing Ôćĺ charge: billing endpoint computes seats ├Ś $49 +
  agency fee ($298 for 1 client). Stripe checkout creates a real session
  (mocked response Ôćĺ `https://checkout.stripe.com/pay/cs_test_audit`);
  requires STRIPE_SECRET_KEY env to charge real cards.

## Iteration 5 ÔÇö landingÔćöworkspace alignment (commit 03a79fb)
- Demo-mode engine stall fixed: `demoSender()` fallback in engineTick; sendEmail
  records sim sends via recordCampaign stats + 'sent' event so the workspace
  shows progress without any inbox configured.
- Trial plan now has linkedIn: true (FAQ promised full features). Import route
  auto-verifies the fresh batch in the background (verifyProspectsInBackground,
  4 workers; re-reads fresh state before each save ÔÇö engine tick races with
  stale copies otherwise).
- Signup now sets the session cookie (same as login) and signup.html success
  CTA opens app.html directly.
- Tenant isolation: events now carry an `owner` field; /api/app/activity,
  overview, campaigns, prospects, inbox filter to (ownerless || mine).
  activate/pause/delete/import/verify/verify-all/inbox-read enforce ownership.
- pricing.html truth pass: Scale = high-volume teams (agency features belong
  to the separate $249/mo Agency plan), LinkedIn "Included" on Growth,
  deliverability + API rows unlocked for Starter.
- Test harness: PORT=12001 DATA_DIR=/tmp/otest ENGINE_INTERVAL_MS=5000 node server.js
  gives a fast tick loop; engine defers email sends outside the send window
  (default 9ÔÇô17 UTC) ÔÇö set window 0ÔÇô0 via PATCH to test freely.
- Deploy layout: source /workspace/outrovo (git, main), live copy /tmp/outrovo
  (port 12000, persistent data/), test copy port 12001 (DATA_DIR=/tmp/otest).
  Kill node by PID (ps aux | grep "node server.js"), restart with same env.

## Iteration 6 ÔÇö Settings simplification (Aug 2026)
- Settings rebuilt around a 3-step quick-setup wizard + one-click sender
  connect (Authorize with Google/Microsoft via OAuth popup when
  `GOOGLE_CLIENT_ID`/`MS_CLIENT_ID` set; otherwise 2-field app-password form
  with Advanced-options disclosure). Advanced tools moved into collapsible
  `<details>` accordions; old stacked-cards layout (with its broken split-2
  nesting) removed. Tested: oauth status/start/callback vs real Google token
  endpoint, HMAC state rejection, mini-form connect (Gmail 535 on fake creds
  proves transport path), no token leakage via `GET /api/app/senders`.

- Iteration 6 evidence: full OAuth happy path proven with a mock provider
  (GOOGLE_AUTH_URL/GOOGLE_TOKEN_URL/GOOGLE_USERINFO_URL + MS_* endpoint
  overrides added for testability; nodemailer auth now carries accessUrl so
  Microsoft refresh hits login.microsoftonline.com, not Google default).
  Harness: local mock auth/token/userinfo + SMTP sink advertising AUTH
  XOAUTH2. 26/26 checks: start 302 -> consent -> token exchange -> sender
  created (refresh token AES-GCM at rest, decrypts to provider value, never
  leaks via API) -> real send over AUTH XOAUTH2 (user= + Bearer in the
  wire token) -> engine multi-inbox. Same harness passes for the Microsoft
  provider config (id_token identity path). Browser-verified in headless
  Chromium via CDP: wizard/tiles/accordions render, zero console errors,
  minimal form + Advanced disclosure + connect-success state work, and the
  tile click opens the consent popup which postMessages back and
  self-closes while the sender list shows the new inbox with an
  "authorized" chip. Test server restarts: PORT=12001 DATA_DIR=/tmp/otest
  ENGINE_INTERVAL_MS=5000 node server.js (no oauth env) ÔÇö the mock-provider
  variant is only for verification runs. Live (12000) still needs real
  GOOGLE_CLIENT_ID/SECRET (or MS_*) from the owner for production one-click.

- Owner action needed for real one-click: register OAuth apps per
  docs/enable-one-click-auth.md and set GOOGLE_CLIENT_ID/SECRET (or MS_*)
  + PUBLIC_URL in Render. Until then the live tiles show the app-password
  fallback. Verified against the REAL providers (shape, no creds): Google
  auth entry accepts our query (302 to sign-in chooser), Google token
  endpoint returns its real `invalid_client` for a fake client (proves our
  grant shape parses), Microsoft auth entry accepts our query (200 consent
  page).
