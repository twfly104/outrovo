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
