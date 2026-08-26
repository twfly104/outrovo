# Outrovo Г”Г‡Г¶ landing page project

A cold email & LinkedIn outreach SaaS landing page inspired by woodpecker.co's structure
(hero + product mockup, deliverability grid, testimonial, integrations, 4 steps, FAQ, footer).

## Stack
- Marketing frontend: `index.html`, `pricing.html`, `signup.html`, `login.html`,
  `styles.css`, `script.js` Г”Г‡Г¶ no build step.
- Product app: `app.html` + `app.js` Г”Г‡Г¶ session-gated dashboard with 4 pages:
  Overview (stats + LinkedIn to-dos + event feed), Campaigns (list + prospect
  management), Inbox, Settings (quick-setup wizard + one-click sender connect;
  advanced tools in collapsible `<details>` sections). Agency page is
  hidden unless the plan has Agency seats.
- Settings layout: 3-step wizard on top (Г”Д№ГЎ connect inbox Г”Г‡Г¶ status derives
  from `GET /api/app/senders`; Г”Д№Г­ domain check; Г”Д№Гі send test Г”Г‡Г¶ Г”Д№Г­/Г”Д№Гі marked done
  in localStorage keyed `ov-setup:<email>`), then Sender accounts with
  provider tiles (Google/Microsoft/Other), then accordions: Deliverability
  tools, LinkedIn automation, Suppression list, CRM & automation, Sending
  engine, Compliance, Account.
- Backend: `server.js` (Node >= 18, one dep: `nodemailer` Г”Г‡Г¶ `npm install` first).
  Static hosting + JSON API + campaign engine. Persistence in `data/*.json`
  (gitignored). Passwords scrypt-hashed, sessions in httpOnly cookie
  `outrovo_session` (7 days; `Secure` added automatically when the request
  is HTTPS — direct TLS or `x-forwarded-proto: https`).
- Engine: ticks every `ENGINE_INTERVAL_MS` (default 15s). Steps: `email`
  (subject/body, `{{firstName}}`-style templating), `task` (manual LinkedIn
  queue), `wait`. Without `SMTP_HOST/USER/PASS` env it runs in DEMO mode Г”Г‡Г¶
  sends are logged to the activity feed, never delivered.
- AI assistant: `POST /api/app/ai/generate-sequence` (+ `POST
  /api/app/ai/scan-site` for website autofill). With `LLM_API_KEY`
  (+ optional `LLM_BASE_URL`, `LLM_MODEL`) it calls an OpenAI-compatible
  chat API; otherwise it uses the built-in copywriting engine
  (`localSequence`) Г”Г‡Г¶ the UI labels which mode answered.
- The app dashboard CSS (bottom of `styles.css`, "App dashboard" section) mirrors the
  landing page: `.app-body` re-declares the tokens to the styles-lite values
  (paper #f7f7f8, crest #f97316, ink #0b0c0e) so the product feels identical
  to the marketing site. Nav/action icons are inline SVGs, not emoji.
- Logo lives in `logo.svg` (vector bird mark) referenced as `.logo-img`
  across pages Г”Г‡Г¶ update the file once to rebrand everywhere.

## Monetization
- Plans in `PLANS` (server.js): trial (14d, 100 prospects, 1 campaign),
  starter $39 (2K/3), growth-id displays as "Pro" $89 (10K/10 + LinkedIn),
  scale $189 (Г”Е‚Г—). Plan IDs unchanged (growth id = Pro name) so existing
  users keep working. `TOPUP_PACKS` (server.js) sells pay-as-you-go Lead
  Finder credit bundles (500/$19, 2K/$49, 10K/$189) via the same
  /api/billing/checkout + /api/billing/activate flow (Stripe mode=payment
  vs subscription); credits land on `user.leadFinderBonus` (survives the
  monthly leadFinder reset) and `GET /api/plans` exposes `topups` — the
  Lead Finder card has a "+ Top up credits" button. Packs with
  `service: true` (e.g. `dns_setup` $99 one-time done-for-you
  SPF/DKIM/DMARC setup, listed on pricing.html) skip credits and are
  recorded on `user.servicePurchases` via `fulfillService` instead.
- Signup auto-assigns `plan: 'trial'` + `trialEnds`. `planOf()` marks
  expiry; campaign & prospect creation return 402 with `upgrade: true`.
- Billing: `POST /api/billing/checkout` Г”Д‡Дє Stripe Checkout when
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

## Launch checklist (hosting env vars Г”Г‡Г¶ do these in Render/Vercel)
- `ADMIN_KEY` Г”Г‡Г¶ strong random value; without it admin endpoints are locked
  (verified: 403 with no key, 403 with wrong key, 200 with correct key).
- `LLM_API_KEY` (or `OPENAI_API_KEY`) Г”Г‡Г¶ REQUIRED for the landing-page
  assistant to answer with a real LLM (also upgrades the AI sequence writer,
  site-scan, reply-intent, and reply drafts). Declared in `render.yaml`. To
  check which mode a deployment is in without guessing:
  `curl https://<host>/api/assistant` в†’ `{"mode":"llm"}` (keyed) or
  `{"mode":"keyword"}` (no key вЂ” assistant uses built-in keyword answers and
  can hit the canned fallback on off-script questions). Setting this one var
  is the single owner action that makes the assistant "actually smart".
- `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` (+ optional `SMTP_FROM`), or
  `RESEND_API_KEY` Г”Г‡Г¶ otherwise the engine runs in demo mode and logs sends
  instead of delivering them. The pipeline is end-to-end verified
  (`POST /api/app/tools/test-email` delivered via real SMTP during audit).
- `STRIPE_SECRET_KEY` (+ `STRIPE_WEBHOOK_SECRET` for webhook activation) Г”Г‡Г¶
  otherwise checkout returns manual instructions.
- `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` or `MS_CLIENT_ID`/`MS_CLIENT_SECRET`
  Г”Г‡Г¶ enables one-click "Authorize" sender connect in Settings (OAuth consent
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
- Lead Finder source priority: Apollo people-search (BYOK key or
  `APOLLO_API_KEY`, plan-gated) → Apollo org fallback (`apollo-orgs`:
  Free-plan `organizations/search` gives company domains, then the
  builtin crawler resolves people per domain; leads are tagged source
  `apollo-orgs`) → built-in domain
  crawler. First source that returns leads wins; rejected/expired/plan-gated
  keys degrade to a soft `warnings[]` entry and the search falls through to
  the next source. Once leads land, the "Apollo key has no API access" soft
  warning is dropped from `warnings[]` so the success path stays clean.
- `APOLLO_API_KEY` — powers Lead Finder ICP search
  (Find Leads page). Without it, Lead Finder falls back to crawling the
  target company domains the user types in and MX-verifies what it finds.
  BYOK: a user can also connect their own Apollo key in Settings > Lead data
  source (`GET/POST/DELETE /api/app/integrations/apollo-key`). It is stored
  AES-256-GCM encrypted on the user record (`apolloKeyEnc`, via
  `encryptSecret`) and takes priority over the env `APOLLO_API_KEY` via
  `userApolloKey()`, which threads through `apolloSearchLeads`,
  `callEnrichment`, `leadFinderProvider` and `enrichmentProvider`.
  Apollo path: `POST /api/v1/mixed_people/search` maps the ICP filters
  directly (keywords/title/headcount-range/location, `contact_email_status:
  verified`). NOTE: Apollo's Free plan includes NO API access — the search
  and match endpoints return `API_INACCESSIBLE`; `apolloError()` surfaces
  that as an actionable message and search falls through to builtin.
  `APOLLO_BASE_URL` env overrides the API origin for mock-server tests.
  Hunter.io was removed — Apollo is the only external lead source.
  Quotas per plan: trial 25, starter 100, growth 1,000, scale/agency 10,000
  credits/month (1 credit per returned lead), tracked on `user.leadFinder`.
  `GET /api/app/lead-finder/status` also returns `seed = { website }` (the
  signup email's domain, scan box only Г”Г‡Г¶ never target keywords, so the user
  never ends up searching for themselves); the form auto-fills from `seed`,
  then `GET /api/app/lead-finder/prefill` (scans the signup domain's site to
  infer keywords/title/size/location; uses LLM when `LLM_API_KEY` is set,
  heuristic regexes otherwise; fetches with `Accept-Language: en` to
  localize consistent results; sizes returned match the UI select options
  exactly, e.g. `11,50`). The card also has an
  explicit **Your company website + Scan & fill** control posting to
  `POST /api/app/lead-finder/scan-fill` (same inference on an arbitrary URL;
  overwrites fields, unlike the non-destructive auto prefill — and a blank
  result CLEARS the field, otherwise the previous site's value lingers:
  scanning sgidigi.com filled "Taiwan", then vercel.com legitimately
  returned location "" but the UI kept showing "Taiwan"). Both share
  `inferIcpFromSite(domain)` in server.js. `heuristicIcp` (used without an
  LLM, and as the fallback when the LLM echoes the scanned domain back)
  rejects the canned ~30-category list Г”Г‡Г¶ keywords come from the site's own
  copy via (1) positioning-formula phrases like "built for X / platform
  for Y / trusted by Z" (`extractMarketPhrases`), (2) raw-adjacent bigrams
  that repeat or appear in h1Г”Г‡Гґh4 (`extractSignificantTerms`, gated by
  STOPWORDS / GENERIC_WORDS / not-both-generic, max 3), (3) canned
  INDUSTRY_CUES as backstop only; the scanned domain is last resort.
  `cleanPhrase` caps and cleans each phrase. Title falls from a `talent`
  phrase (recruiter) or an audience persona map (sales/revenue Г”Д‡Дє head of
  sales, engineers Г”Д‡Дє head of engineering, data Г”Д‡Дє head of data) before
  BUYER_PERSONAS. Location reads /about в”¬Дљ /contact в”¬Дљ /company for the real
  HQ city over homepage claims. The LLM prompt is likewise ICP-focused
  (fill the target market, never the user's own domain). The builtin
  crawler no longer truncates pages Г”Г‡Г¶ `slice(0, 500000)` was cutting off
  emails past 500KB.
- ICP inference gotchas (learned from a Taiwanese agency site,
  si.sgidigi.com, whose location was misdetected as "United States"):
  `fetchSite` returns full page text + a separate `tail` (last 25KB) because
  heavy builders (Framer/Webflow) put the footer past the 600KB fetch cap Г”Г‡Г¶
  never run location regexes against a head-truncated body. Location cues
  include CJK tokens (Е„в•‘Г—Е в”¤в–“/Е€Д†в–‘Е в•ЈЕј/Е€Д†в–‘ЕЎГјГє/Е€Д†в–‘Е€Г®ЕљГ”Г‡ЕЅ), ranked extraText > headings >
  body. `CJK_INDUSTRY_CUES` maps Chinese industry terms (ГљЕ¤в•—Е€ДЅД‡/ГљЕ¤в•—Е€ЕџГ‰Е€ДЅД‡Е€Е‘Г– Г”Д‡Дє
  "ecommerce brands", Е€ГґГјЕЎГ«Г® Г”Д‡Дє "consumer brands", ГљД„Г‰ГљГєв–“ Г”Д‡Дє "restaurants", Г”Г‡ЕЅ)
  into keyword/title candidates. valueProp skips greeting/thank-you
  headings (Е”ЕЅВ¬Е Г¤Е¤ЕЎГњГ¤/Е Г¤ДЌЕ”ДЊЕЃ/hello/welcomeГ”Г‡ЕЅ) Г”Г‡Г¶ Framer modals inject those before
  the real hero copy. Size inference must NOT match weak product words
  ("integration", "workflow") Г”Г‡Г¶ they are vocabulary, not target-size
  signals, and produced bogus "11Г”Г‡Гґ50" fills. Later hardening (vercel.com
  scan filled product-vocab keywords, size "1,000+" from the "Vercel
  Enterprise" plan name, location "Taiwan" from a Taipei edge-region list):
  keywords go through PRODUCT_WORDS (infrastructure/stack/cloud/agenticГ”Г‡ЕЅ)
  which drop product vocabulary unless an AUDIENCE_WORD rides along; market
  phrases that contain the scanned domain name are rejected as self-
  description; size only fills on explicit AUDIENCE phrasing ("for
  startups", "enterprise customers", "teams of all sizes" Г”Д‡Дє ''), never a
  bare "enterprise" mention; location blanks when Г”Г«Д…3 geo buckets match
  (global service) unless about/contact anchors one (weight 4); BUYER_PERSONAS
  dropped the "sales team"/"revenue team" regexes ("Talk to sales" is on
  every B2B contact page); bot-walled sites answering with a markdown
  render (no <h1> tags) get headings from "#" lines instead. Regression
  checks: vercel.com Г”Д‡Дє AI startups/head of engineering/blank size+location;
  apollo.io → United States/founder; stripe.com Г”Д‡Дє United States/head of
  sales; example.com Г”Д‡Дє empty keywords (no domain echo). Each result row
  also has a **Г”ЕҐЕЅ Intel** column: clicking calls
  `POST /api/app/lead-finder/intel` (`leadIntel()` in server.js; cached in
  memory 1h per domain) which scans the lead's company site and returns
  summary / services & features / how they compare / why buyers choose
  them / a sender angle (LLM when configured, heuristic sentence-picker
  otherwise; resolves the company field first, falls back to the email's
  domain). The frontend keeps the last scanned site title (`servicePitch`)
  and passes it as `pitch`, personalizing the angle.
- `LLM_API_KEY` (or `OPENAI_API_KEY`; optional `LLM_BASE_URL`, `LLM_MODEL`) Г”Г‡Г¶
  upgrades the AI sequence writer, site-scan prefill, reply-intent
  classification, and AI reply drafts to a real LLM. Without it all four run
  on built-in heuristic engines, so nothing breaks.
- Landing-page assistant (index.html "Ask us" widget): posts to
  `POST /api/assistant` ({q, history}) which answers with a real LLM
  (ASSISTANT_API_KEY || LLM_API_KEY || OPENAI_API_KEY; ASSISTANT_BASE_URL ||
  LLM_BASE_URL; ASSISTANT_MODEL || LLM_MODEL, default gpt-4o-mini). The system
  prompt is ASSISTANT_PERSONA + ASSISTANT_FACTS in server.js вЂ” grounded in the
  site's own copy. Replies are HTML-sanitized (only strong/em/br + local
  links: #faq, pricing.html, signup.html, /) before the client inserts them
  via innerHTML. Rate-limited 30 req / 10 min / IP; answers cached 1h by
  normalized question. Without a key the route returns 503 and the widget
  falls back to its local keyword matcher (which also handles greetings now),
  so the panel never dead-ends.
  Verified end-to-end against a REAL LLM (not a mock): ran a local Ollama
  serving the actual TinyLlama model as the OpenAI-compatible upstream
  (ASSISTANT_BASE_URL=http://127.0.0.1:11434/v1). Visitor question в†’ POST
  /api/assistant в†’ real generated answer grounded in FACTS, sanitized,
  and served from cache on repeat (cached:true). The full loop works with
  any OpenAI-compatible endpoint вЂ” including a self-hosted model вЂ” so the
  owner can use OpenAI or point LLM_BASE_URL at a local model instead.

## API
- `POST /api/signup` Г”Г‡Г¶ validates, scrypt-hashes password, 409 on duplicate email
- `POST /api/login` Г”Г‡Г¶ verifies hash, sets session cookie; `POST /api/logout`; `GET /api/me`
- `GET /api/health` Г”Г‡Г¶ status + user count
- `GET /api/signups` Г”Г‡Г¶ admin list, needs `x-admin-key` header (env `ADMIN_KEY`;
  no default Г”Г‡Г¶ admin endpoints stay locked with 403 until it is set)
- App (session required): `/api/app/overview`, `/api/app/campaigns` (GET/POST,
  `/:id/activate|pause`, DELETE), `/api/app/prospects` (GET/POST single+CSV,
  `/:id/verify`), `/api/app/activity`, `/api/app/tasks` (`/:id/done`),
  `/api/app/tools/verify` (syntax + MX), `/api/app/tools/domain-audit`
  (MX/SPF/DMARC/DKIM-selector DNS checks), `/api/app/lead-finder/status|search|enroll`
  (ICP/domain search Г”Д‡Дє verify Г”Д‡Дє add to campaign, credit-metered),
  `/api/app/campaigns/:id/ab-results` (per-step A/B variant stats), `/api/app/engine`
- A/B testing: email steps may carry `variantB {subject, body}` (builder UI has
  a "Г”Г§Г¤ A/B test this step" toggle). Assignment is deterministic per
  prospect+step (`prospect.abLog`), stats via ab-results (winner declared at
  Г”Г«Д…10 sends per arm by reply rate).
- MCP: `POST /api/mcp` Г”Г‡Г¶ JSON-RPC 2.0 (initialize, tools/list, tools/call)
  with tools overview_stats, list_campaigns, ab_results, add_prospect,
  list_replies. Auth: `Authorization: Bearer <integration token>` (Settings Г”Д‡Дє
  LinkedIn autopilot bridge Г”Д‡Дє Generate integration token).
- CLI: `bin/outrovo.js` (zero-dep, Node 18+, `npm run cli` or the `outrovo`
  bin). Env `OUTROVO_URL` + `OUTROVO_TOKEN`; commands overview, campaigns,
  ab, add-prospect, replies Г”Г‡Г¶ all ride the MCP endpoint.
- `/app.html` and `/app.js` redirect to `/login.html` without a session

## Iteration 27 — LLM/Groq fix + busy buttons (Aug 2026)
- Find Leads/Scan & fill now swap to a spinning gear + status while requests
  run (helper `setBtnLoading` + `GEAR_SVG` in app.js, `.spin-gear` keyframes in
  styles.css). Apply the helper to any new async button.
- Groq rejects `response_format:{type:'json_object'}` (HTTP 400) — all LLM
  call sites must omit it on Groq (`base.includes('api.groq.com')` guard) or
  use callLlmJson (already guarded).
- Reasoning models (gpt-oss/o*/deepseek-r1/qwq) burn hidden tokens first —
  `llmMaxTokens(n)` floors caps at 2048; never pick small max_tokens caps in
  new LLM call sites. `parseLlmJson()` extracts JSON from chatty/wrapped
  replies; use it instead of raw JSON.parse on message content.
- GENERIC_LOCALS blocks press/media/partners/jobs/hr/billing/legal/privacy
  aliases in the built-in crawler to keep junk off the lead table.

## Iteration 28 — junk-alias detector + SVG spin smoothness (Aug 2026)
- Leads were department/test mailboxes because GENERIC_LOCALS was 20 words.
  New layered detector (`isGenericLocal` in server.js): exact-word set +
  GENERIC_ALIAS regex + all-sub-token-generic + >14-char run-together word +
  contains ≥5-char generic substring (GENERIC_SUB). Catches "affiliates",
  "bizdev", "brandmarketing", "customeradvocacyinquiry", "tvmedia", "abc/xyz"
  test junk while real names (sol, tim.cook, mreutzel) pass.
- Spinning gear wobble fix: SVG `transform` CSS animations default the origin
  to 0 0, making the gear orbit its corner. `transform-box: fill-box` +
  `transform-origin: center` + `will-change` is mandatory for any animated
  SVG icon.

## Iteration 29 — LLM executive fallback for crawl-empty domains (Aug 2026)
- Big companies publish only department inboxes; the crawler had no answer
  and showed junk. Now `leadershipGuessLeads(domain, f)` asks the LLM for
  public execs (two-pass: requested titles → generic C-suite), pattern-
  guesses addresses, MX-verifies, flags `guessed: true` + warning.
- gpt-oss reasoning answers are nondeterministic — two-pass prompt loop
  turns coin-flips into reliable hits. Don't join prompts into one call.
- `isGenericLocal` runs on sub-tokens with any-match (was every-match) +
  substring at any length. Adding new alias words: extend GENERIC_ALIAS.

## Iteration 30 — gear spin: animate a wrapper, not the SVG (Aug 2026)
- transform-box: fill-box is unreliable when the SVG has fill="none"
  (degenerate bbox; Safari recalcs origin per frame). Always rotate an HTML
  wrapper element (default origin 50%/50%) sized to the icon instead.
- Busy buttons must freeze min-width before swapping the label, or the
  resize reads as a jitter.
- Headless-Chromium testing: --virtual-time-budget FREEZES CSS animations
  (identity transforms, 0 diffs) — use --timeout=ms real-time screenshots
  and diff pixel regions to verify motion.


## Iteration 31 — symmetric cog glyph (Aug 2026)
- A fixed transform-origin isn't enough if the GLYPH is asymmetric: the
  feather `settings` icon's teeth are hand-placed, so its visual centroid
  orbits and the axis appears to drift on mobile (esp. Safari). Build
  rotating icons rotationally symmetric (one tooth, rotate() <use>s).
- When verifying "in place" rotation: diff bbox center of changed pixels
  must equal the glyph center.

## Iteration 32 — stop animating gears, ship a rotor (Aug 2026)
- 4 attempts at rotating-gear loaders failed first-frame stability. Every
  production loader (iOS/Material/Tailwind/SpinKit) uses tapered stroke-dash
  ticks + stepwise steps(n) rotation — do that, never continuous gears.
- Headless-debug trick: diff frames → bbox of changed pixels must match
  the icon's footprint and its center must equal the glyph center.
## Conventions
- Brand name is "Outrovo" (formerly "Drummer" placeholder).
- All product screenshots are pure CSS/HTML mockups (`.app-card`, `.panel`, `.orbit`).
- JS behaviors: sticky header shadow, FAQ accordion (`.faq-item`), scroll reveal
  (`.reveal` + IntersectionObserver), mobile menu toggle, demo modal (`#demoModal`,
  triggered by `[data-demo]`), pricing billing toggle (`#billToggle` flips
  `data-monthly`/`data-yearly`), client-side form validation on `signup.html` /
  `login.html` with success state swap.
- All pages share the same header/footer markup Г”Г‡Г¶ update links in every page when
  nav changes. CTAs point to `signup.html` / `login.html` / `pricing.html`.
- Responsive breakpoints at 1024px and 720px.

## Phase 1 additions (multi-inbox foundation)
- Sender accounts: `data/senders.json`, per-user inboxes with provider presets
  (`gmail`/`microsoft`/`custom` SMTP). App passwords stored AES-256-GCM-encrypted
  in `encPass` (`DATA_KEY` env; falls back to deriving from ADMIN_KEY Г”Г‡Г¶ set
  DATA_KEY before users connect inboxes; changing it orphans stored passwords).
- `pickSender(owner, prospect)`: deterministic round-robin across the owner's
  active inboxes + the env gateway (RESEND_API_KEY / legacy SMTP_* env), skipping
  inboxes at their daily cap. `recordSend` advances warmup state.
- Warmup: `sender.warmup` Г”Д‡Дє capToday = min(dailyLimit, startCap + rampDays *
  WARMUP_RAMP_INCREMENT (5)); rampDays increments once per active send day.
- Spintax `{a|b|c}` (nested, MAX_SPINTAX_DEPTH 10, deterministic per
  prospect+template) + `{{var}}` templating over prospect fields AND
  `prospect.customVars` (CSV header row: extra columns Г”Д‡Дє customVars).
  `personalize()` = renderTemplate then applySpintax. Preview via
  POST /api/app/tools/preview-spintax.
- All-capped inboxes Г”Д‡Дє engine defers the prospect CAP_RETRY_MS (1h), no error.
- Step delays get в”¬в–’20% jitter at scheduling time.
- Signup fires a fire-and-forget domainAudit of the signup domain; result lands
  in the activity feed (`domain-audit` event, meta.checks) and Settings Г”Д‡Дє
  Domain health renders it instantly.
- IMPORTANT: PATCH is an allowed method in the server allowlist Г”Г‡Г¶ anything
  adding a route with another method must extend the allowlist too.

## Phase 2/3 additions (deliverability ops, compliance, LinkedIn safety)
- Campaign pacing: `dailyCap` (default 25), `sendWindowStart/End` hours,
  `timezone` (Intl tz, fallback UTC). Engine defers prospects outside the
  window or past the cap (CAP_RETRY_MS 1h) Г”Г‡Г¶ never fails. `sentLog`,
  `sentCount`, `bounceCount` counters on the campaign record. Caps count
  in-tick async dispatches (`dispatchedThisTick`) so bursts can't overrun.
- Unsubscribe: every campaign email gets a footer link + `List-Unsubscribe` /
  `List-Unsubscribe-Post: One-Click` headers pointing at
  `GET|POST /api/unsubscribe?u&e&t` (HMAC-SHA256 token from UNSUB_KEY,
  derived from DATA_KEY/ADMIN_KEY). Per-user `user.suppressed[]` list;
  suppressing stops in-flight sequences and skips future imports
  (`skippedSuppressed` in import response). Manage via /api/app/suppression.
- Bounces: `classifySendError` (HARD_BOUNCE_RE/SOFT_BOUNCE_RE). Hard Г”Д‡Дє
  prospect.bounced + finished + bounceCount. Soft Г”Д‡Дє same-step retry
  (stepIndex rewound in the catch Г”Г‡Г¶ it already advanced), max 3 в”њЕљ 30 min.
- Replies: POST /api/email/receive matches `from` to a prospect, sets
  replied/finished (sequence stops), reply records carry `owner`; inbox and
  tasks endpoints are owner-filtered. Legacy ownerless records stay visible.
  Unified Inbox routing: each user has a deterministic forwarding address
  `u-<hmac(email)>@INBOUND_DOMAIN` (env INBOUND_DOMAIN, default
  inbound.outrovo.com) exposed as `inboundAddress` in GET /api/app/senders
  and shown in Settings → Sender accounts. The webhook also resolves the
  `to` field (`to`/`recipient`/`To`/`data.to`/`envelope.to` — Mailgun,
  SendGrid, Postmark, Resend shapes) against those addresses, so replies
  from non-prospects still land in the right account (`routed` in response).
- Google OAuth scope is send-only (`gmail.send openid email`) — the app
  never reads mailboxes; replies arrive via the inbound webhook only.
- LinkedIn: task steps have `taskKind` (connect|message|view), tasks carry
  `owner` + `dueAt` (random within LINKEDIN_SPREAD_HOURS 6h). Daily budget
  `user.linkedinBudget` (env LINKEDIN_DAILY_BUDGET default 20, cap 100) Г”Г‡Г¶
  over budget defers the prospect. Plan gate: only plans with linkedIn:true.
- Autopilot bridge: POST /api/app/integrations/token issues `ovk_Г”Г‡ЕЅ` (shown
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
  (agency plan + seats в”њЕљ $49). Clients can be detached (orphan, keeps data).
- White-label: `user.whiteLabel` = { brandName, logoUrl, cname, accentColor }.
  `POST /api/app/white-label` gated to whiteLabel plans. Branded report at
  `GET /api/reports/branded` (session or admin key + ?u=, ?c= for one client)
  renders per-workspace stats with agency branding.
- Conditional branching: email steps carry `label` + `branchNext` =
  { onReplied, onClicked, onNoReply } (step labels as jump targets). Engine
  resolves next step via `resolveNextIndex` after each send Г”Г‡Г¶ events
  (replied/clicked) set prospect flags that route on the next tick. Click
  tracking: GET /api/t/:id?u=<url> logs the click and 302s through.
- Smart Unibox: `classifyIntent` (LLM when LLM_API_KEY, heuristic fallback
  otherwise) labels every inbound reply; unsubscribe-intent replies
  auto-suppress. Replies carry `intent`; inbox UI renders chips and an
  Г”ЕҐЕЅ AI draft button (POST /api/app/inbox/:id/draft Г”Г‡Г¶ LLM with reply
  context + user identity, or intent-keyed heuristic templates).
- Enrichment: `callEnrichment` picks Apollo (APOLLO_API_KEY) → Dropcontact (DROPCONTACT_API_KEY) Г”Д‡Дє builtin
  (MX + Gravatar). Single: POST /api/app/prospects/:id/enrich. Bulk:
  POST /api/app/campaigns/:id/enrich-all (50/batch). Stores `enriched`
  on the prospect and backfills empty name/company fields.
- Verification gate: POST /api/app/campaigns/:id/verify-all (100/batch)
  runs verifyEmail on every unfinished prospect; undeliverable Г”Д‡Дє pulled
  from sequence (`skipped: 'undeliverable'`). `verifyEmail` now probes
  the primary MX with a randomized RCPT to detect catch-all domains
  (`verified.catchAll`), which stay in but are flagged accept-all.
- CRM webhooks: `user.integrations[]` = { url, provider, secret, events[] }.
  `fireWebhooks(owner, event, payload)` fans out on sent/bounce/reply/
  unsubscribe/click/task/campaign. HMAC-signed when secret set. Managed in
  Settings Г”Д‡Дє CRM & automation; POST /:id/test verifies reachability.
  Webhook URLs allow HTTP only for localhost (testing); production must use
  HTTPS.

## Statutory & customer-protection audit (Aug 2026)
- Signup consent is now server-enforced: `POST /api/signup` rejects with
  `{terms:'required'}` unless `terms === true`, and stores
  `user.consent = { termsVersion, privacyVersion, at }` (GDPR Art. 7 record).
  `TERMS_VERSION` const in server.js Г”Г‡Г¶ bump whenever terms.html/privacy.html
  change materially. Frontend sends the flag explicitly (`script.js`).
- CAN-SPAM footer: every campaign email footer now carries the sender's
  postal address (`user.mailingAddress`, set in Settings Г”Д‡Дє Compliance card,
  saved via POST /api/app/settings) above the unsubscribe link. Verified
  end-to-end through a local SMTP sink: headers include
  `List-Unsubscribe` + `List-Unsubscribe-Post: One-Click`, body includes
  address + HMAC-signed one-click link.
- Data rights (GDPR Arts. 15/17/20), all session-gated and tested:
  `GET /api/app/export` Г”Д‡Дє full JSON download of account (salt/hash/token-hash
  stripped), campaigns, prospects, replies, tasks, senders (encPass stripped);
  `DELETE /api/app/account` Г”Д‡Дє password-confirmed erasure of the user +
  campaigns + prospects + replies + tasks + senders + sessions, clears the
  cookie. Wrong password Г”Д‡Дє 403; unauthenticated Г”Д‡Дє 401.
- Legal pages: privacy.html rewritten (controller identity + privacy@ contact,
  legal bases, controller/processor split for prospect data + DPA note,
  retention schedule, sub-processors, SCC transfer note, full rights list,
  cookie disclosure, supervisory-authority right). terms.html gained a
  governing-law section (Delaware). login.html + app.html footers now link
  Terms/Privacy (previously missing).
- Test harness used: `DATA_DIR=/tmp/... PORT=xxxx SMTP_HOST=127.0.0.1
  SMTP_PORT=2525` against a hand-rolled net.Server SMTP sink that captures
  DATA payloads Г”Г‡Г¶ is the reliable way to verify real sends without touching
  production data/ or external mail.

## Test evidence for audit gaps (iteration 4)
- HMAC webhook: captured + validated end-to-end via localhost receiver
  (`[WEBHOOK VALID] event=sent email=sig@test.io valid=true` Г”Г‡Г¶ receiver
  recomputed the HMAC over the exact body and it matched the header).
- Intent-classified unsubscribe Г”Д‡Дє suppression: POST /api/email/receive with
  opt-out text produced `intent: unsubscribe`, `matched: true`, and the
  suppression record `[{ email: 'suppress@test.io', reason: 'intent-unsubscribe', ... }]`
  on the user; unsubscribe webhook also fired valid=true.
- Enrichment real provider path: mocked Apollo fetch proved the full flow Г”Г‡Г¶
  `X-Api-Key` header, payload email, response parsing into
  { firstName, lastName, company, title, city, seniority }, and storage on
  the prospect. Real Apollo endpoints respond 401 to invalid keys
  (reachable, auth-gated). No user-supplied keys exist to do a live call.
- CNAME white-label: raw HTTP request with `Host: outrovo.work` returns
  `<title>CN Brand Г”Г‡Г¶ Outreach</title>` with brand logo/name replaced
  (fetch strips Host, so raw http.request is the way to prove it).
- Consolidated billing Г”Д‡Дє charge: billing endpoint computes seats в”њЕљ $49 +
  agency fee ($298 for 1 client). Stripe checkout creates a real session
  (mocked response Г”Д‡Дє `https://checkout.stripe.com/pay/cs_test_audit`);
  requires STRIPE_SECRET_KEY env to charge real cards.

## Iteration 5 Г”Г‡Г¶ landingГ”Д‡Г¶workspace alignment (commit 03a79fb)
- Demo-mode engine stall fixed: `demoSender()` fallback in engineTick; sendEmail
  records sim sends via recordCampaign stats + 'sent' event so the workspace
  shows progress without any inbox configured.
- Trial plan now has linkedIn: true (FAQ promised full features). Import route
  auto-verifies the fresh batch in the background (verifyProspectsInBackground,
  4 workers; re-reads fresh state before each save Г”Г‡Г¶ engine tick races with
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
  (default 9Г”Г‡Гґ17 UTC) Г”Г‡Г¶ set window 0Г”Г‡Гґ0 via PATCH to test freely.
- Deploy layout: source /workspace/outrovo (git, main), live copy /tmp/outrovo
  (port 12000, persistent data/), test copy port 12001 (DATA_DIR=/tmp/otest).
  Kill node by PID (ps aux | grep "node server.js"), restart with same env.

## Iteration 6 Г”Г‡Г¶ Settings simplification (Aug 2026)
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
  ENGINE_INTERVAL_MS=5000 node server.js (no oauth env) Г”Г‡Г¶ the mock-provider
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

## Iteration 7 — Settings simplification + font change (Aug 2026)
- Owner rejected the readiness-hero "boss view" (tiles + progress meter) after
  seeing it live — it was REVERTED. Lesson: don't add dashboard layers on top
  of Settings; the 3-step wizard + accordions + the small "Advanced" divider
  (kept) is the accepted level of structure.
- Typography: owner disliked the "artistic" serif look — Fraunces is GONE
  site-wide. `--font-display` (styles.css) and `--fd` (styles-lite.css) now
  both resolve to Instrument Sans; the Google Fonts links in all 7 HTML pages
  load Instrument Sans only. Keep headings sans — do not reintroduce a serif
  display face.

- Font follow-up: with Fraunces gone, the hero word "pipeline" (`.kw`) looked
  clipped — the gradient text uses `background-clip:text; color:transparent`,
  which crops glyphs to the CSS em box. Instrument Sans italic overhangs that
  box (descenders + swash edges), and Fraunces' `opsz` optical sizing used to
  compensate. Fix: `.kw`/`.kw-animate` get `display:inline-block;
  padding:0 .04em .07em`. Rule of thumb: any `background-clip:text` element
  needs explicit bottom/side padding, especially in italic.

## Iteration 8 — Settings tab restructure for owners (Aug 2026)
- Settings page rebuilt around 4 sub-tabs after the 3-step wizard: Inboxes
  (default, sender accounts + connect tiles + reply-forwarding guide), Tools &
  verification (deliverability tools + suppression list), Integrations —
  tagged "Advanced" (LinkedIn automation, CRM & automation, Sending status),
  Account & compliance (mailing address, export/erase).
- All 7 former <details class="settings-section"> accordions converted to
  always-visible .app-card-block cards inside .settings-pane wrappers
  (#stab-inboxes/tools/integrations/account); tab switching in
  bindSettingsTabs() (app.js) toggles [hidden].
- De-jargon pass: "Sending engine" card renamed "Sending status"; the
  RESEND_API_KEY/SMTP_* env-var paragraph replaced by plain copy; loadEngine()
  now renders a colored .status-badge (good/warn/demo) + one plain sentence
  instead of mode names; webhook URL placeholder is "Paste the URL Zapier or
  HubSpot gave you"; webhook form hidden behind "+ Add integration" until
  clicked (auto-shown when integrations exist).
- CSS: .settings-tabs/.settings-tab/.adv-tag/.status-badge added before the
  "Settings: one-click connect tiles" section in styles.css.
- Lesson: when moving big DOM blocks with python string ops, wrap panes
  AFTER all inner transforms and re-check tag balance (details/div counts)
  before restarting — two bad orderings had to be reverted via git checkout.

## Iteration 9 — booking-link loop (Aug 2026)
- New `user.bookingLink` field closes the "leads book themselves" loop:
  saved via POST /api/app/settings (https://-URL validated, 400 on junk),
  exposed in publicUser, editable in Settings → Account & compliance card
  next to the mailing address.
- `{{bookingLink}}` template variable resolves in renderTemplate via
  prospect.owner OR prospect.campaignId→campaign.owner (prospect.import
  routes never set owner — always fall back through the campaign).
  Preview-spintax route synthesizes owner: session.email for the same reason.
- AI "interested" reply draft injects the real bookingLink (no more literal
  "[booking link]" placeholder); builder placeholders mention the variable.
- Webhook receive field order gotcha: /api/email/receive reads b.text
  (Mailgun/SendGrid/Resend shapes), NOT b.body — test payloads must use
  "text" or intent classification sees an empty body.

## Iteration 10 — Credits badge + Add Credits modal (Aug 2026)
- Sidebar gets a live credits pill (GET /api/app/lead-finder/status →
  quota−used, cached per page switch): orange pill, amber under 100
  remaining, red at 0, always next to "+ Add Credits".
- "+ Add Credits" opens an in-app modal (no page jump) listing the 3
  non-service TOPUP_PACKS from GET /api/plans; a pack click posts
  /api/billing/checkout and opens the Stripe URL in a new tab; without
  STRIPE_SECRET_KEY the server returns {manual:true} and the modal shows
  a plain-language "Payments not configured" note instead of the curl
  spam the old flow displayed.

## Iteration 11 — Lead Finder form simplification (Aug 2026)
- Form rebuilt as 2 steps: (1) Your business = one URL input + "Auto-fill profile";
  the service/value fields collapse into a "Detected: ..." summary pill (#lfDetected,
  truncated to ~140 chars) with an Edit toggle (#lfOfferFields). (2) Target audience =
  keywords input, job-title pills, location pills (LOC_PRESETS, multi-select
  comma-stacked into #lfLocation), size select, Search leads.
- All instruction paragraphs stripped from the card (lead finder, autopilot, Intel
  note all one-liners now).
- syncChips() resyncs pill .on states after every programmatic fill (scan/prefill/seed)
  — otherwise pills clicked before a scan keep glowing after the scan overwrites the
  input. syncDetected() + syncChips() are called from all three fill paths in app.js.
- No server.js changes — search/autopilot payload shape unchanged.

## Iteration 12 — Campaigns page de-clutter + Find Leads as its own page (Aug 2026)
- Owner feedback: Campaigns page forced 3-4 screens of scrolling (lead finder + people import + table all stacked under the campaign list). Restructured per top-tier B2B SaaS pattern.
- Sidebar now: Overview / Campaigns / Find Leads / Inbox / Settings (+Agency). New `#page-leads` holds the whole Lead Finder (2-step form, auto-pilot, results table, Intel). `lfTopupBtn` now unhidden by `loadLeadFinderStatus` (it was permanently hidden before). Overview gained a "Find leads" action card.
- Campaigns page = list only. Cards are compact (name, meta, status, "Open campaign ->"), whole card clickable (`data-open`, keyboard Enter/Space). No more Run/Delete buttons on cards.
- Clicking a card opens `#campaignDetail`: header (back, name, status pill, Run/Pause, Delete) + 3 tabs reusing `.settings-tab` styles: Steps (sequence visual + stats, A/B results card when variants exist), Contacts (table + Verify all / Enrich all / + Add leads), Settings (daily cap, window start/end, timezone -> existing `PATCH /api/app/campaigns/:id`).
- Add-one-person + CSV paste moved into `#addLeadsModal` (opened from Contacts -> "+ Add leads"); modal also has "Find new leads with AI" which closes and jumps to the leads page. `importNote` lives in the modal now.
- app.js: `fillProspectSelect` and the `prospectCampaign` select are GONE - `selectedCampaign` is set by `openCampaign()`. `campaignCardHtml` was split into `stepVisuals`/`campaignStepsHtml`/`campaignStatsHtml` reused by the detail Steps pane. `loadCampaigns` re-renders an open detail; `saveCampaign` opens the new campaign's detail after create. `backToList()` resets on nav.
- Fixed TWO unclosed `<details>` in app.html (pacing-panel in the create modal, lf-details) - browsers were auto-closing them, which is what trapped the "People to email" section inside the lead-finder disclosure in the first place. Tag balance now verified (details 2/2, section 6/6, div 222/222).
- CSS: new "Campaign detail" block in styles.css (.cd-head/.cd-spacer/.cd-actions/.cd-steps-card/.cp-clickable/.cp-open-hint, mobile stack <720px).
- Verified end-to-end on PORT=12001 DATA_DIR=/tmp/otest12: list->detail->tabs, modal add person (tab count updates), settings PATCH persists, Run flips draft->active with Auto badges, leads page renders with seeded domain + status line, create modal intact. No server.js changes - all endpoints reused.

## Iteration 13 — Visual simplicity pass (Aug 2026)
- Owner: "make everything simple, I don't like this style". Landing/marketing pages UNTOUCHED; all changes scoped to the app dashboard.
- Copy de-clutter: removed decorative glyphs (sparkle/magnifier/party/warning emoji) from buttons, headings and status strings in app.html/app.js. Kept functional glyphs only: checkmark/cross inside ok-tag/no-tag pills, close X, and the tiny enriched-marker on prospect rows.
- Overview page: removed the 4 action cards (duplicated the sidebar). Page is now just At a glance stats + LinkedIn to-dos + Event feed. Heading is plain "Overview". (bindNav's data-goto handler is harmless with no matches.)
- Flat design overrides appended at END of styles.css as a "Simplicity pass" block, every selector prefixed `.app-body` so the marketing site is unaffected: no box-shadows on cards/buttons/chips, radius 12px (buttons/nav 8-10px), no hover-lift transforms, quiet outline style for the sidebar upsell, no page fade-in animation.
- When restyling the app again: append scoped `.app-body ...` overrides at the end of styles.css rather than editing the shared base rules (.btn etc. are used by the landing pages too).

## Iteration 14 — Intel drawer + push blocker (Aug 2026)
- Lead Intel now opens in a right-side slide-out drawer (#intelDrawer) instead of an inline expanding table row. Markup in app.html after the Inbox section; logic `openLeadIntel`/`closeLeadIntel` in app.js with per-search `leadIntelCache`; CSS "Intel drawer" block at end of styles.css (460px panel, backdrop, translateX transition). Closes via X, backdrop click, or Escape.
- Verified live on :12001 with a real search (keywords "eff.org" — the builtin finder crawls real domains for published emails; outbound network works from this sandbox).
- PUSH BLOCKER: the sandbox GITHUB_TOKEN (ghu_…, login twfly104) has `x-oauth-scopes:` EMPTY — metadata=read only. `git push`, `gh api POST /git/refs`, and gh credential-helper push all return 403 "Resource not accessible by integration". Commits f0e98de, 2ba6bfe, 33181fa are local-only on master. Production still serves origin/main (7ccab2b). User must either (a) add a token with Contents: write via OpenHands settings (never paste in chat), or (b) run `git push origin master:main` locally.


## Iteration 15 — Cream top-nav redesign (Aug 2026)
Owner approved a new visual direction (screenshots): left sidebar REPLACED by a sticky top header. Layout: logo + breadcrumb (#crumb, JS-driven e.g. "Campaigns / Demo campaign" in detail view, "Campaigns" is a back link) left; page links (Overview/Campaigns/Inbox/Settings/Agency) + "Find Leads" ghost button + orange "+ New Campaign" pill + credits + Upgrade + logout + avatar right. app-shell is now flex-column. Theme: cream bg #f8f6f2, white cards (16px radius, 1px #ebe6dc border, soft shadow), orange #F2501E primary. Campaign-detail tabs now have small inline SVG icons; Run/Pause and the Find-Leads ✦ Intel buttons use inline SVGs too (btn-intel). The old "Simplicity pass" CSS block was REPLACED by the "Cream top-nav redesign" block at the end of styles.css.
- Breadcrumb helper in app.js: setCrumb(html)/crumbBackListener(); wired in showPage/openCampaign/backToList.
- Push uses the user-provided classic PAT (ghp_…, repo scope) via git remote URL — the env GITHUB_TOKEN is read-only.

## Gotcha — preview Bad Gateway
If the workspace preview URL for the app (work-1/2 ports 12000/12001) returns "Bad Gateway": the node server is still porchtted alive but the sandbox HTTP entrypoint (a ngrok-style edge?) lost its tunnel. Fix: kill the node PID (was nested under pts/1, respawned as PID 1741) and restart `PORT=12001 nohup node server.js > /tmp/server12001.log 2>&1 &`. GET / then returns 200 (HEAD / returns 405, don't use HEAD). Session cookies are in data/sessions.json (token value usable directly as the outrovo_session cookie in browser storage).

## Iteration 16 — Settings hero: Mailboxes / Integrations / Notifications (Aug 2026)
- Owner screenshot spec: Settings top is now two hero cards + a Notifications
  card (cream, dashed row dividers, orange toggles). The 3-step quick-setup
  wizard is GONE (connect → "+ Connect mailbox" button jumps to Inboxes tab;
  domain check lives in Tools & verification; test email = per-sender "Send
  test" which now always sends to me.email — the wizard's testEmailTo input
  no longer exists).
- Mailboxes card (renderMailboxHero in app.js, fed by loadSenders' data):
  provider avatar (gmail=green G, microsoft=orange M), "Provider · warmup %"
  (capToday/dailyLimit when warmup on), pill HEALTHY vs WARMING (from
  warmup.isWarming).
- Integrations card reads NEW `GET /api/app/settings/integrations` →
  {apollo, apolloKeySet, llm, crmSync, webhooks}. ROUTE GOTCHA:
  `/api/app/integrations/status` was already taken by the LinkedIn autopilot
  bridge (duplicate key silently served the wrong handler) — hence the
  settings/integrations path.
- CRM sync toggle = REAL master switch: user.crmSync (default true),
  fireWebhooks returns early when false. Persisted via POST
  /api/app/settings (now also accepts {crmSync, notifications}).
- Notifications card = user.notifyPrefs {hotLead:true, dailyDigest:true,
  bounceWarnings:false} (notifyPrefs() helper, exposed on publicUser).
  fireWebhooks gates: 'bounce' needs bounceWarnings; 'reply' with
  intent 'interested' needs hotLead; 'digest' needs dailyDigest. Delivery
  channel = the user's existing outbound webhooks (a Slack incoming webhook
  URL works) — INTEGRATION_EVENTS gained 'click' + 'digest'.
- Daily digest: digestTick() at the end of engineTick — once per user per
  day at/after 9:00 server-local, fires a 'digest' webhook with a 24h rollup
  (sent/opens/replies/bounces from the events store). GOTCHA fixed: mark
  lastDigestDay only when crmSync is on, otherwise the day is consumed with
  zero delivery.
- Verified live (PORT=12001, DATA_DIR=/tmp/otest-settings, sink on :12009):
  interested reply blocked when hotLead off / delivered when on; question
  reply unaffected; crmSync off silences everything; digest event delivered
  with real counts. Browser-checked hero render incl. HEALTHY mailbox row.

## Iteration 17 — Settings sub-tabs removed (Aug 2026)
- Owner: "delete setting button function" — the Inboxes / Tools & verification /
  Integrations / Account & compliance tab bar is GONE from Settings; all four
  .settings-pane blocks are always visible in one long page (hidden attrs removed).
- bindSettingsTabs() deleted from app.js (its global .settings-tab selector also
  mis-bound the campaign-detail tabs — latent bug gone with it). The webhook
  "show form" toggle survives as bindWebhookFormToggle(). Campaign detail tabs
  (#cdTabs, data-ctab) are untouched — they bind via their own delegation.
- Hero "jump" buttons (Connect mailbox, Apollo Set up) now scrollIntoView the
  pane instead of clicking a tab. KEEP the .settings-tabs/.settings-tab CSS —
  campaign detail still uses it.


## Iteration 18 — auth hardening (Aug 2026)
- Login/signup were unlimited per IP (credential-stuffing target). Both now
  ride `authOk` = 10 attempts / 10 min / IP via a new `makeLimiter` factory
  (`assistantOk` reimplemented on it, behavior unchanged: 30/10min).
- New helpers near `newToken`: `requestIp(req)` (XFF first hop, also used by
  the assistant route now) and `sessionCookie(token, req)` which appends
  `Secure` only when the request is HTTPS (`req.socket.encrypted` or
  `x-forwarded-proto: https`) — local http dev keeps working.
- All 3 session-cookie setters (signup, login, Google OAuth `startSession`)
  go through `sessionCookie`. Verified: 11th rapid bad login → 429; HTTPS
  proxied login sets `Secure`; plain http signup does not.

## Iteration 19 — marketing palette unified to cream (Aug 2026)
- Owner: "pricing page and main page 顏色配置 equal". styles.css :root tokens
  now mirror styles-lite (index): paper #f8f6f2, paper-deep #f0ece3,
  ink #1b1915 / #4c473e / #948d7f, line #e9e3d7, crest #f97316 / #ea580c.
- body::before dot-grid overlay REMOVED from styles.css (index has no texture).
- .auth-side panel was white (var(--card)) — now var(--paper-deep) so the
  split screen stays in the warm family. Dashboard unaffected: .app-body
  re-declares every token (line ~1470) + hardcodes bg #f8f6f2.

## Iteration 20 — mobile hamburger fix (Aug 2026)
- Pricing 三橫線 never opened: script.js toggle handler AND pricing.html inline
  handler BOTH fired per click -> always canceled. Removed the script.js block
  (it only existed for pricing anyway). Verified via headless CDP click test.
- Button styles made bare (no bordered box) + header CTA hidden on mobile so
  the toggle isn't squeezed into a sliver -> matches index burger look.
- Mobile menu z-index raised to 200 (was 99, lost to header/stacking-ctx),
  and site-header bg switched from old off-white rgba to cream.

## Iteration 21 — mobile menu transparent background root cause (Aug 2026)
- Menu opened but painted transparent: #mobileMenu lived INSIDE <header>, and
  header's `backdrop-filter: blur(14px)` makes it a containing block for fixed
  descendants, so `position: fixed; inset: 65px 0 0` resolved against the
  header's own 65px box -> menu box height 0, bg invisible, links overflowed.
- Fix: moved #mobileMenu out of <header> in pricing.html (sibling before
  <main>). CDP geometry check: rect [0,65,390,779], bg rgb(248,246,242).
- Lesson: warn-trivially test geometry with CDP getBoundingClientRect, not
  just class toggling, when verifying overlays.

## Iteration 22 — unify mobile menus (Aug 2026)
- Pricing menu now includes "Start free trial" CTA (index menu adds "Start
  free") — both orange pill, centered, same spacing.
- .mmenu in styles-lite.css now mirrors pricing's mobile-menu look: opaque
  cream bg, 1.6rem display-font links, same 16px padding.
- Pricing #navToggle got inline style="background:none;border:0" so phones
  with stale cached styles.css still show the bare burger (matches index).

## Iteration 23 — header parity index vs pricing (Aug 2026)
- pricing header was `position: fixed` (index: sticky) -> unified to sticky,
  hero padding-top 132->88 to keep breathing room without double offset.
- Removed "Book a call" ghost button + gray active pill on nav; actions now
  Log in + "Start free" (identical to index). Mobile menu CTA renamed to
  "Start free" too. Verified desktop+mobile screenshots identical.

## Iteration 24 — true header pixel parity (Aug 2026)
- Remaining drifts between pricing (styles.css) and index (styles-lite):
  wrap 1180 vs 1120 and missing 24px horizontal padding -> logo x off by 24;
  nav-links had pill padding (9/14) vs lite 6/2 + gap 4 vs 26; login ghost
  border radius/padding; primary btn had btn-s + pill radius vs lite 8px.
- Unified: styles.css now mirrors styles-lite header metrics exactly.
  CDP probe across 1904px viewport: headerRect/navHeight/logoRect/fonts/
  linkYs/action widths all identical between the two pages.

## Iteration 25 — AI-agent differentiation layer (Aug 2026)
- **Landing page**: new "For AI agents" band on index.html between Features
  and How it works — 3 cards (MCP server / Real CLI / Slack alerts) with
  copy pointing at outrovo.co/api/mcp + npx outrovo.
- **CLI package** at cli/: zero-dependency node script, talks MCP JSON-RPC
  directly to /api/mcp. Commands: init/stats/campaigns/replies/ab/add-prospect.
  Config in ~/.outrovo/config.json (chmod 600). Publish-ready npm package.
- **app.html** Settings → Developer gets a new "Slack app" block with
  install/disconnect buttons.
- **Deliverability watchdog**: deliverabilityTick() in server.js re-audits
  each user's signup domain daily via existing domainAudit(); fires new
  'deliverability' webhook event only on regression (ok → broken).
- **Slack OAuth app**: SLACK_CLIENT_ID/SECRET env vars enable
  GET /api/app/integrations/slack/install + /callback. Bot token encrypted
  via encryptSecret (same AES-256-GCM as sender credentials) and stored
  in user.slack. fireWebhooks() now also posts via chat.postMessage when
  a Slack install is present (hot lead / digest / deliverability alerts).
- publicUser() gains slackConnected + slackTeam so the Settings UI can
  reflect install state.
- All 5 strategic differentiation points now live in production code.

## Iteration 26 — 大佬 standard pass (Aug 2026)
- Landing restructure for general buyers: big mid-page "For AI agents" band
  replaced by a compact "For developers" strip placed between FAQ and CTA
  (quiet, single paragraph + GitHub link). Hero/features/4-steps stay clean.
- Features list gains a 4th bullet: "AI intent tagging & instant alerts".
- Footer: "Developers · MCP & CLI" link added under Product; footer Features
  list updated to match (AI intent tagging replaces smart-schedule row).
- Pricing: Pro $99 → $89/mo (yearly $71, −20% toggle already existed) to land
  inside the recommended $69–89 team band. Server PLANS.growth.priceMonthly
  and the landing assistant's canned pricing fact updated to match.
- Starter now lists domain health check, AI reply intent tags, and Slack /
  webhook notifications — deliverability is NOT gated behind higher tiers
  (matches how the server already behaves: domainAudit + watchdog run for
  every user, classifyReply runs on all plans).
- Verified via CDP screenshots: 4-bullet features, dev strip, $39/89/189 cards.
