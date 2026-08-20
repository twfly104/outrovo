# Drummer — landing page project

A cold email & LinkedIn outreach SaaS landing page inspired by woodpecker.co's structure
(hero + product mockup, deliverability grid, testimonial, integrations, 4 steps, FAQ, footer).

## Stack
- Plain static site: `index.html`, `pricing.html`, `signup.html`, `login.html`,
  `styles.css`, `script.js` — no build step.
- Fonts: Fraunces (display) + Instrument Sans (body) via Google Fonts.
- Design tokens in `:root` of `styles.css`: warm paper `#f6f1e7`, forest ink `#16281f`,
  vermilion crest `#e8490f`, dark forest `#122e22`.

## Run
- `python3 -m http.server 12000` from repo root, open http://localhost:12000/

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
