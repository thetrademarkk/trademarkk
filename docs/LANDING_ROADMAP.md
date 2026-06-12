# Landing Page Roadmap — North Star: the front door earns the product

> **Goal:** the landing page is TradeMark's highest-traffic surface and first
> impression. It must feel like the product itself: dark-first, fast, honest,
> data-dense but calm. Every iteration ships one coherent slice through the
> standard pipeline (branch → PR → CI → squash-merge → auto-deploy → verify).

## Research notes (June 2026)

Patterns studied across Linear, Vercel, Raycast, Resend, Supabase and 2025/26
SaaS-landing teardowns:

- **Real product UI is the hero visual.** The best dev-tool pages lead with an
  actual screenshot/recording in a browser or window frame — not abstract art.
  Dark-as-default with **one** accent color used with restraint.
- **Bento grids won** — modular cards with _real UI content_ inside the tiles
  (Linear/Raycast style), not icon-and-blurb walls.
- **Demo video: click-to-play beats autoplay** for product demos (autoplay is
  for short ambient loops only). Strong poster frame + play affordance; keep
  60–90s; lazy-load so video never touches the critical rendering path.
- **Minimal, meaningful motion**: scroll-reveals via IntersectionObserver/CSS,
  always honoring `prefers-reduced-motion`; no animation libraries needed.
- **Honest social proof**: we show _live platform aggregates_ (real numbers
  from our own DB) instead of fake testimonials/logos — no fabricated trust.

Sources: [Framiq 2026 teardown](https://framiq.app/blog/best-saas-landing-pages-2026),
[SaaSFrame 2026 trends](https://www.saasframe.io/blog/10-saas-landing-page-trends-for-2026-with-real-examples),
[Landdding bento breakdown](https://landdding.com/blog/bento-grid-design-by-website-category-where-the-pattern-wins),
[Unbounce on autoplay](https://unbounce.com/landing-pages/autoplay-landing-page-best-practices/),
[Apexure video LP practices](https://www.apexure.com/blog/video-landing-page-examples).

## Working rules (non-negotiable)

- Landing stays **statically renderable** — client widgets (metrics strip,
  video) hydrate after paint; no server data in the page itself.
- **Performance is a feature**: Lighthouse mobile ≥ 90 on `/`; zero new heavy
  deps; images via `next/image` with explicit dimensions; fonts unchanged.
- **Honest numbers only.** Public stats come from the platform DB (users,
  activity events, community content, opt-in streaks). Per-user journals are
  not centrally readable — never fake trade counts. No fake testimonials.
- No emojis — lucide icons only. All git-workflow rules hold (PR, CI, no
  branch deletion, no manual deploys).

## v2 scope (this PR)

- [x] **Hero v2** — sharper value prop for Indian intraday/FnO traders;
      primary CTA "Start free" + secondary "Try the live demo" (deep-links the
      demo mode); real dashboard screenshot in a browser-chrome frame with
      subtle glow/perspective; trust line (open source MIT · your data stays
      yours · free). CSS-only entrance so the hero never waits for hydration.
- [x] **"See it in action" demo video** — auto-recorded product walkthrough
      (Playwright drives the local demo journal; ffmpeg trims/speeds/encodes
      h264 mp4 + vp9 webm + poster jpg, < 8 MB total) embedded click-to-play
      (muted, playsInline, preload=none, lazy).
- [x] **Live public metrics strip** — `GET /api/public/stats`: registered
      traders, active last 30 days, community posts, longest public streak.
      Honest aggregates only, `cached()` 10 min + CDN `s-maxage`, no auth, no
      PII. Animated count-up on scroll-into-view (reduced-motion safe).
- [x] **Bento features v2** — real differentiators: dual-mode storage (BYOD),
      broker CSV import (6 brokers), analytics that price habits, multi-leg
      FnO, streaks + community, open source — with live mini-demos in tiles.
- [x] **Nav + footer** — sticky header with backdrop blur + scrolled state;
      footer with GitHub, MIT license, community, security/privacy links.
- [x] **SEO/OG** — `opengraph-image` via next/og, enriched SoftwareApplication
      JSON-LD (featureList), complete metadata.
- [x] **Perf pass** — scroll reveals moved from motion/react to a CSS +
      IntersectionObserver `Reveal` (shared by all marketing pages); landing
      route drops the animation-library bundle entirely.

## Backlog (v3+)

- [ ] **Testimonials / wall of love** — only once real users consent; never
      fabricated. Pull from community posts with permission.
- [ ] **Changelog + blog surface on landing** — "What's new" strip fed from
      the changelog; latest 2 blog posts above the footer.
- [ ] **Interactive product tour** — guided in-browser demo (drives the real
      local-mode app with seeded data) instead of/alongside the video.
- [ ] **Comparison strip** — honest TradeMark vs paid journals table teaser
      linking to /compare.
- [ ] **i18n groundwork** — hi-IN copy variant for the marketing surface.
- [ ] **Video v2** — captions track, chapter markers, refreshed recording
      after major UI changes (re-run the capture script).
- [ ] **OG image variants** — per-page og images (features, blog, compare).
- [x] **Accent-button contrast** — resolved by the audit lane's
      `--accent-solid` token (PR #23); landing adopted it for solid fills.
- [ ] **Refresh the demo video** after the next major UI change (re-run the
      capture pipeline; keep total media under 8 MB).

## Verification gates (every iteration)

`tsc` clean · lint zero warnings · vitest green · `e2e-smoke.mjs` 23/23 ·
`mobile-audit.mjs` zero overflow at 360/390 · Lighthouse mobile ≥ 90 on `/` ·
prod deploy verified after merge.

### v2 results (2026-06-12, local prod build, after merging main)

- Lighthouse `/` mobile: **perf 91 · a11y 100 · best-practices 100 · SEO 100**
  (FCP 1.2s, LCP 3.4s, CLS 0, TBT 80ms)
- Lighthouse `/` desktop: **perf 98 · a11y 100 · best-practices 100 · SEO 100**
  (LCP 0.8s, CLS 0)
- Demo video: 60s walkthrough, h264 mp4 2.1 MB + vp9 webm 1.8 MB + poster
  0.11 MB; hero screenshot webp 0.11 MB (all under the 8 MB budget).
- e2e-smoke 24/24 · landing suite 10/10 (hero image, live metrics vs API,
  video click-to-play, both CTAs, scrolled header, footer links,
  reduced-motion) · mobile-audit zero overflow · vitest 163 green.
- Before the perf pass the page scored 68 mobile (LCP 4.6s, TBT 590ms);
  the fixes: LCP elements un-gated from opacity animations, prefetch=false
  on visible nav/CTA links, motion library dropped from the landing bundle,
  visibility-gated tickers.

## Shipped by the loop

<!-- The loop appends: - [x] YYYY-MM-DD — item — PR #N -->

- [x] 2026-06-12 — Landing v2: hero screenshot frame, 60s auto-recorded demo video, live public metrics strip (/api/public/stats), bento v2, scrolled header + footer, perf pass (mobile 91 / desktop 98, a11y 100) — PR #27
