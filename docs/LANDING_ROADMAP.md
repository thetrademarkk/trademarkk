# Landing Page Roadmap — North Star: the front door earns the product

> **Goal:** the landing page is TradeMarkk's highest-traffic surface and first
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

## v3 scope — user feedback on v2 (this PR)

Direct user feedback drove all three changes; each reverses or extends a v2
decision, so the reasoning is recorded here.

- [x] **Demo video autoplays** ("video should be auto play"). v2 chose
      click-to-play per the research above; the user wants the walkthrough
      ambient. Decision: treat it as an ambient loop — `muted` + `loop` +
      `playsInline`, **lazy via IntersectionObserver**: the `<video>` element
      does not mount (nothing preloads, zero LCP impact — the lazy poster
      image is all that exists) until the section first scrolls into view,
      and playback pauses whenever it scrolls out (resumes on re-entry).
      `prefers-reduced-motion` keeps the v2 click-to-play poster and gets
      native controls after opting in. Sound stays opt-in for everyone via a
      subtle corner mute toggle (the recording has soft UI click sounds).
- [x] **Hero mock restored** ("the screenshot … is not looking relevant —
      earlier it was good"). The v1 handcrafted dashboard mock (browser
      chrome titled "TradeMarkk — Dashboard", ₹18,920 / 67% / 2.1R KPI cards,
      self-drawing equity curve, day-strip pills, Today's-rules check tiles)
      replaces the v2 screenshot. Refined while restoring: pure JSX/CSS
      server component — the v1 NumberFlow/motion ticker loops (which forced
      layout and cost mobile TBT) are gone; choreography is CSS keyframes
      with `forwards` fill so reduced-motion lands on the finished state.
      Crisp at any DPR and themes with the site — a screenshot can do
      neither. `public/landing/dashboard.webp` stays for JSON-LD/OG.
- [x] **Cursor effects, landing only** ("we can include cursor effects as
      well"). Pattern researched across Linear/Vercel-style spotlight cards
      (Cruip spotlight-card teardown, Frontend Masters "CSS Spotlight
      Effect"): a soft radial spotlight follows the pointer over the hero,
      and bento cards get a pointer-tracking inner glow + 1px border-shine
      (mask-composite ring) with a gentle hover lift. One passive,
      rAF-throttled `pointermove` listener writes CSS custom props; gradients
      are paint-only (no layout writes, no React state per frame). Strictly
      `(hover: hover) and (pointer: fine)` and disabled under
      `prefers-reduced-motion`; no trails, no libraries.
- [x] **Permanent landing e2e suite** — `scripts/e2e-landing.mjs` (12 steps:
      mock content, lazy mount, autoplay/pause/resume, mute toggle, spotlight
      vars, card glow + lift, and the three reduced-motion fallbacks).

Additional sources for v3: [Cruip spotlight card](https://cruip.com/how-to-create-a-spotlight-card-hover-effect-with-tailwind-css/),
[Frontend Masters CSS spotlight](https://frontendmasters.com/blog/css-spotlight-effect/),
[web.dev lazy-loading video](https://web.dev/articles/lazy-loading-video),
[Cloudinary autoplay do's/don'ts](https://cloudinary.com/guides/video-effects/video-autoplay-in-html).

## Backlog (v3+)

- [ ] **Testimonials / wall of love** — only once real users consent; never
      fabricated. Pull from community posts with permission.
- [ ] **Changelog + blog surface on landing** — "What's new" strip fed from
      the changelog; latest 2 blog posts above the footer.
- [ ] **Interactive product tour** — guided in-browser demo (drives the real
      local-mode app with seeded data) instead of/alongside the video.
- [ ] **Comparison strip** — honest TradeMarkk vs paid journals table teaser
      linking to /compare.
- [ ] **i18n groundwork** — hi-IN copy variant for the marketing surface.
- [ ] **Video v2** — captions track, chapter markers, refreshed recording
      after major UI changes (re-run the capture script).
- [ ] **OG image variants** — per-page og images (features, blog, compare).
- [x] **Accent-button contrast** — resolved by the audit lane's
      `--accent-solid` token (PR #23); landing adopted it for solid fills.
- [ ] **Refresh the demo video** after the next major UI change (re-run the
      capture pipeline; keep total media under 8 MB). Publish it **with its
      click-track audio**: the current walkthrough.mp4/webm encodes are
      silent (the audio-mixed master `demo/trademarkk-demo.mp4` is a
      different 86s/16:9 session, so its track can't be muxed in honestly) —
      until then the v3 unmute toggle is wired but a no-op.

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

### v3 results (2026-06-12, local prod build on :3500)

- Lighthouse `/` mobile, three runs: **perf 91 / 90 / 92 · a11y 100 ·
  best-practices 100 · SEO 100** (LCP 3.3–3.5 s, TBT 80–130 ms, CLS 0).
- Found while chasing the gate: `community-spotlight` imported
  `TradeCardView` through the `@/features/community` barrel, dragging the
  whole feed/composer/messaging bundle onto `/` (65 kB chunk, 90–130 ms
  hydration long task; TBT had crept to 160–220 ms). Deep import dropped
  first-load JS for `/` to **134 kB** and restored TBT.
- e2e: new permanent `e2e-landing.mjs` **13/13** · e2e-smoke **25/25** ·
  mobile-audit zero overflow at 360/390 · vitest 199 green · tsc/lint clean.
- Hero mock is a pure server component — the LCP element stays the `<h1>`;
  the autoplay video never mounts before its section intersects, so media
  bytes stay off the critical path entirely.

## Shipped by the loop

<!-- The loop appends: - [x] YYYY-MM-DD — item — PR #N -->

- [x] 2026-06-12 — Landing v2: hero screenshot frame, 60s auto-recorded demo video, live public metrics strip (/api/public/stats), bento v2, scrolled header + footer, perf pass (mobile 91 / desktop 98, a11y 100) — PR #27
- [x] 2026-06-12 — Landing v3 (user feedback): autoplay walkthrough (lazy IO mount, pause-offscreen, reduced-motion click-to-play), v1 hero dashboard mock restored + refined as a pure server component, cursor spotlight + card glow/border-shine, barrel-import fix (`/` first-load JS 134 kB), permanent e2e-landing.mjs (13 steps) — mobile 91/90/92 perf · 100/100/100 — PR #39
- [ ] 2026-06-14 — Landing + SEO + perf refresh **(accumulated, pending batch deploy)**: - Content: feature pillars rewritten to cover the grown product honestly — every Indian trader type (intraday/swing/positional/F&O/MCX/CDS), paise-accurate charges + FY **tax pack** (the differentiator, with a new tax-pack demo tile), insights/**tilt**/**Monte-Carlo**, the **multi-broker Chrome extension** (Kite/Upstox/Groww/Dhan/Fyers), and **backtesting** framed honestly as "coming as the dataset goes live" (Coming-soon badge). Hero subhead + features page + JSON-LD `featureList` widened to match. No fake metrics re-added; autoplay video + animated hero kept. - SEO: site-wide JSON-LD **@graph** (Organization + WebSite + SoftwareApplication) on `/`; sitemap now lists `/community`, `/privacy`, `/terms`; **OG image rebranded to "TradeMarkk"** (was "TradeMark", emoji-ish ticks → SVG checks, TM badge avoids missing-₹-glyph tofu). **Fixed a pre-existing OG bug**: pages declaring `openGraph: { url }` (docs/blog/terms/pulse/changelog/privacy/compare + features/home) were suppressing the file-convention `og:image` — moved explicit `og:image`/`twitter:image` into the root layout metadata and dropped the per-page `openGraph.url` overrides (canonical still set via `alternates.canonical`), so every public route now ships a share card. - a11y: hero KPI tiles now carry `aria-label`s with the formatted value (NumberFlow's animated digits are `aria-hidden`; their text wasn't exposed to SR/innerText). lucide-only, no emoji, semantic tokens throughout. - Perf: `/` stays statically prerendered, ~10 kB / 175 kB first-load JS; OG image is a same-origin edge route (CSP-safe). - Tests: 17 new vitest (site JSON-LD builders, sitemap, robots); e2e-landing.mjs extended with SEO steps (head meta, JSON-LD graph, robots/sitemap, CTA targets) + 360/390px no-overflow + refreshed-pillar assertions. Gates green: tsc, ext:typecheck, lint, vitest 1208/1208, build, e2e-landing 30/30 landing+SEO+a11y+mobile steps, e2e-smoke 34/34, mobile-audit clean. (The 2 e2e-landing admin-shell steps fail locally because Better-Auth signup doesn't persist a session against the platform DB in this local prod env — pre-existing, auth-lane owned, untouched here.)
