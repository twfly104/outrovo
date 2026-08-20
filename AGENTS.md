# Drummer — landing page project

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
- Fonts: Fraunces (display) + Instrument Sans (body) via Google Fonts.
- Design tokens in `:root` of `styles.css`: warm paper `#f6f1e7`, forest ink `#16281f`,
  vermilion crest `#e8490f`, dark forest `#122e22`.

## Run
- `node server.js` (or `PORT=xxxx node server.js`) from repo root.
- Public URL in this sandbox: https://work-1-wtjewisfdrzmkddb.prod-runtime.all-hands.dev/

## API
- `POST /api/signup` — validates, scrypt-hashes password, 409 on duplicate email
- `POST /api/login` — verifies hash, sets session cookie; `POST /api/logout`; `GET /api/me`
- `GET /api/health` — status + user count
- `GET /api/signups` — admin list, needs `x-admin-key` header (env `ADMIN_KEY`,
  default `drummer-admin-key` — change it before any real launch)
- App (session required): `/api/app/overview`, `/api/app/campaigns` (GET/POST,
  `/:id/activate|pause`, DELETE), `/api/app/prospects` (GET/POST single+CSV,
  `/:id/verify`), `/api/app/activity`, `/api/app/tasks` (`/:id/done`),
  `/api/app/tools/verify` (syntax + MX), `/api/app/tools/domain-audit`
  (MX/SPF/DMARC/DKIM-selector DNS checks), `/api/app/engine`
- `/app.html` and `/app.js` redirect to `/login.html` without a session

## Conventions
- Brand name is "Drummer" (placeholder — can be renamed during enhancement).
- All product screenshots are pure CSS/HTML mockups (`.app-card`, `.panel`, `.orbit`).
- JS behaviors: sticky header shadow, FAQ accordion (`.faq-item`), scroll reveal
  (`.reveal` + IntersectionObserver), mobile menu toggle, demo modal (`#demoModal`,
  triggered by `[data-demo]`), pricing billing toggle (`#billToggle` flips
  `data-monthly`/`data-yearly`), client-side form validation on `signup.html` /
  `login.html` with success state swap.
- All pages share the same header/footer markup — update links in every page when
  nav changes. CTAs point to `signup.html` / `login.html` / `pricing.html`.
- Responsive breakpoints at 1024px and 720px.
