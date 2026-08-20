# Drummer — landing page project

A cold email & LinkedIn outreach SaaS landing page inspired by woodpecker.co's structure
(hero + product mockup, deliverability grid, testimonial, integrations, 4 steps, FAQ, footer).

## Stack
- Static frontend: `index.html`, `pricing.html`, `signup.html`, `login.html`,
  `styles.css`, `script.js` — no build step.
- Backend: `server.js` — zero-dependency Node server (Node >= 18) serving the
  static files plus a JSON API. Persistence in `data/signups.json` (gitignored).
  Passwords are scrypt-hashed with per-user salt.
- Fonts: Fraunces (display) + Instrument Sans (body) via Google Fonts.
- Design tokens in `:root` of `styles.css`: warm paper `#f6f1e7`, forest ink `#16281f`,
  vermilion crest `#e8490f`, dark forest `#122e22`.

## Run
- `node server.js` (or `PORT=xxxx node server.js`) from repo root.
- Public URL in this sandbox: https://work-1-wtjewisfdrzmkddb.prod-runtime.all-hands.dev/

## API
- `POST /api/signup` — validates, scrypt-hashes password, 409 on duplicate email
- `POST /api/login` — verifies against stored hash with timing-safe compare
- `GET /api/health` — status + user count
- `GET /api/signups` — admin list, needs `x-admin-key` header (env `ADMIN_KEY`,
  default `drummer-admin-key` — change it before any real launch)

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
