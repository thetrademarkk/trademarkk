# Audit Roadmap — North Star: every slice of the repo audited and fixed

> **Goal:** audit and fix the entire repo, one slice per loop iteration, all
> verified with Playwright before merge. Same working rules as
> COMMUNITY_ROADMAP.md / JOURNAL_ROADMAP.md: branch → PR → CI → merge (keep
> branches) → auto-deploy; Playwright-verify every flow; never regress the
> e2e suites (23/23 smoke steps, zero console errors).

## Backlog (ordered; each = one loop iteration)

- [x] **1. Security audit** — authz on every API route (session + ownership checks), rate limits on all writes, origin checks, secrets never in client bundles (scan the built output for env leakage), CSP + security headers in next.config (CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy), input validation coverage, Better Auth config hardening, npm audit, demo creds stripped from scripts (env-only). — PR #15
- [x] **2. Web vitals + DM authz follow-up** — DM-route authz sweep (PR #12 routes: purge-on-delete gap fixed, 120/h send cap, cursor validation, 26 new e2e-security checks → 51 total) + Lighthouse pass on /, /community, /app/dashboard at mobile+desktop: recharts lazy-loaded (dashboard 413→309 kB), hero ticker loops deferred past the load window (home mobile TBT 4,060→140 ms), scrollbar-gutter CLS fix (0.126→0.011), --accent-solid AA contrast token. Desktop perf 94-100; mobile perf 83-85 (LCP under 4x throttle — deeper bundle work in slice 6); accent-tint contrast + tap targets → slice 4. — PR #23
- [ ] **3. SEO** — metadata completeness per route, OG/Twitter cards, sitemap.xml + robots.txt correctness, structured data (JSON-LD already partial), canonical urls, internal linking; validate with a crawler script.
- [ ] **4. Accessibility** — axe-core via Playwright on every route (inject @axe-core/playwright), fix all serious/critical violations; keyboard-only walkthrough of trade entry + community post flows; focus traps in dialogs; contrast on all 4 themes.
- [ ] **5. Mobile responsive** — extend scripts/mobile-audit.mjs to 320/360/390/414/768px + landscape; fix all; tap-target size audit (≥44px).
- [ ] **6. Build/webpack optimization** — analyze bundle (@next/bundle-analyzer), code-split heavy deps (recharts, tiptap), tree-shake lucide imports (verify modularizeImports), prune unused deps (depcheck), measure build size before/after in PR description.
- [ ] **7. SSR & caching** — audit which routes can be static/ISR vs dynamic; add revalidate where viewer-independent; verify CDN cache headers on API GETs; confirm streaming/suspense on slow routes.
- [ ] **8. DB security & optimization** — Turso: verify all queries parameterized (no string interpolation), indexes cover every WHERE/ORDER BY (EXPLAIN top queries), platform-DB row caps/pagination everywhere, journal DB pragmas, batch writes audit.
- [ ] **9. Exhaustive test pass** — consolidate e2e suites into one `npm run e2e:full` runner: smoke + community + dm + hosted + blog + mobile-audit + axe + new flows; every interactive element clicked at least once per page (crawler that tabs/clicks through); document coverage in docs/TESTING.md.

## Shipped by the loop

<!-- - [x] YYYY-MM-DD — slice — PR #N -->

- [x] 2026-06-12 — Security audit: CSP + headers, account-delete purge, javascript:-URL XSS fix, rate limits on all writes, query caps, Better Auth hardening, env-only demo seed, bundle secret scan, scripts/e2e-security.mjs (25 checks) — PR #15
- [x] 2026-06-12 — DM authz sweep + web vitals: DM purge-on-delete fix, 120/h send cap, cursor validation, e2e-security 25→51 checks (IDOR matrix, blocked-send, dedupe, 429 smoke); Lighthouse before→after — home mobile 50→84 perf / 83→100 a11y, community desktop 85→100 (CLS 0.126→0.011), dashboard desktop 76→99; dashboard first-load JS 413→309 kB. Still red: mobile perf 83-85, accent-tint contrast (slice 4), /app SEO 63 by design (noindex) — PR #23
