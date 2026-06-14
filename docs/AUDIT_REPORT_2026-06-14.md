# TradeMarkk — Consolidated Audit Report

_Audit branch: `fix/horizon-intraday-classification` (= `main` + horizon classifier fix). Read-only audit across 9 dimensions: Security, DB-isolation/protected-account invariant, Query optimization, Correctness, SEO, Web vitals, PWA/offline, Accessibility/responsive, E2E test coverage._

---

## Executive summary

This report consolidates **44 confirmed findings** (2 are accurate non-issues kept for the record: a refuted query-key concern and a positive SW/CSP confirmation). Two findings overlapped across dimensions and were merged, giving **41 distinct actionable items**.

**Severity counts (distinct items):**

| Severity          | Count | Items                                                                                                                                                                                      |
| ----------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P1**            | 9     | CORR-01, CORR-02, SEO-01, SEO-08, SEO-02, A11Y-01, PWA-01, E2E-01, E2E-02+M-1 (auth-gating)                                                                                                |
| **P2**            | 17    | SEC-01, QP-01, QP-02, QP-04, QP-05, QP-11, CORR-06, SEO-04, SEO-05, perf-01, perf-02, PWA-02, PWA-03, PWA-05, PWA-08, A11Y-02..05, E2E-03..06, M-2 (grouped below)                         |
| **P3**            | 15    | SEC-02/DBISO-01 (merged), SEC-03, QP-03, QP-06, QP-07, QP-08, QP-09, QP-10, QP-13, CORR-03, CORR-04, CORR-05, SEO-03, SEO-06, SEO-07, perf-03..05, PWA-04, PWA-09, A11Y-06..10, E2E-07..09 |
| **Informational** | 2     | QP-14 (refuted), PWA-07 (positive)                                                                                                                                                         |

**Top risks (one paragraph):** The most material problems are **correctness defects in user-facing money/payoff math** — long puts are reported with _Unlimited_ max profit (CORR-01) and net-short-put max loss is understated because the payoff sampler never reaches S→0 (CORR-06), while processed-agri Guar Gum is mis-flagged tax-exempt so **CTT is silently dropped and stored net P&L is overstated** (CORR-02). On the growth side, the **primary shareable community surfaces (post detail and profiles) self-canonicalize to `/community`** (SEO-08, SEO-01), telling Google every shared link is a duplicate of the feed, and the **sitemap omits indexable backtesting/trending/community-blog routes** (SEO-02). The PWA **does not actually work offline in LOCAL mode** despite advertising it (PWA-01). The **highest-traffic trade-entry form has zero label↔input association** (A11Y-01). And the entire **51-spec Playwright suite never runs in CI** (E2E-01), with auth/community/security specs effectively un-gateable until a throwaway platform DB is provisioned (E2E-02, M-1). None of the confirmed items is an _active_ exploit, but several violate the project's own stated invariants (protected-account targetability, "LOCAL works offline").

---

## Must fix now (P0 / P1)

### CORR-01 — Long-put / net-long-put payoff shows UNLIMITED max profit

- **Dimension:** Correctness · **Severity:** P1
- **File:** `src/lib/options/payoff.ts:192-202` (rendered at `payoff-diagram.tsx:100-102,214`)
- **Evidence:** `const downGain = puts > 0;` → `maxProfit: profitUnbounded || downGain ? Infinity : maxProfit`; a long put's profit is bounded at `(K − premium)·qty`. Repro: single long PE K=100 prem=5 returns `Infinity`, correct is `95`.
- **Fix:** Set `profitUnbounded = calls > 0` only (long calls are the sole source of unbounded upside); use the sampled `maxProfit` for the put side and extend the sample range toward S→0 (see CORR-06). Add a single-long-put test asserting `profitUnbounded===false`, `maxProfit=(strike−premium)·qty`.

### CORR-02 — Guar Gum (processed, CTT-applicable) mis-flagged agri-exempt → CTT omitted, net P&L overstated

- **Dimension:** Correctness · **Severity:** P1
- **File:** `src/features/trades/instrument-parse.ts:105-149` (charge path: `charges.ts:171-176`)
- **Evidence:** `reclassifySegment` derives `agri` via `isAgriBase` (NCDEX_AGRI_BASES contains `GUARGUM`, line 108) and never consults `AGRI_PROCESSED_EXCEPTIONS`, so `parseContractName('GUARGUM5').agri===true`; this feeds form/CSV/recompute → `charges.ts:171` sets `cttPct = agriCommodity ? 0 : …`, dropping CTT. The correct classifier `classifyAgriCommodity` (line 439) and the tax page (`turnover.ts:387`) disagree and DO apply CTT — stored aggregate contradicts the per-trade breakdown.
- **Fix:** In `reclassifySegment` set `agri = segment==="COMM" && classifyAgriCommodity(p.symbol)` (or remove processed entries from `NCDEX_AGRI_BASES` and apply `AGRI_PROCESSED_EXCEPTIONS` inside `isAgriBase`). Update `instrument-parse.test.ts:270` to expect `agri:false` for `GUARGUM5`.

### SEO-08 — Post-detail pages inherit `canonical=/community` (the primary shared surface looks like a feed duplicate)

- **Dimension:** SEO · **Severity:** P1
- **File:** `src/app/community/post/[id]/page.tsx:40-44` (inherits `layout.tsx:14`)
- **Evidence:** `generateMetadata` returns title/description/openGraph but never sets `alternates.canonical`, so each post inherits `<link rel=canonical href=…/community>` — Google folds/deindexes the most link-shared surface.
- **Fix:** Add `alternates:{canonical:`/community/post/${id}`}` to the returned metadata (mirror `s/[symbol]/page.tsx:35`); set canonical on the not-found/catch branches too.

### SEO-01 — Profile pages (`/community/u/[username]`) inherit `canonical=/community`

- **Dimension:** SEO · **Severity:** P1
- **File:** `src/app/community/u/[username]/page.tsx` (+ `src/app/community/layout.tsx:14`)
- **Evidence:** Route exports only `generateStaticParams` + a client `<ProfileView/>`; no `generateMetadata`, so profiles inherit the feed canonical, title, description and OG card.
- **Fix:** Convert to a server wrapper with async `generateMetadata` resolving username → per-profile title/description/openGraph and `alternates:{canonical:`/community/u/${username}`}`, mirroring `s/[symbol]/page.tsx:19-39` and `t/[tag]/page.tsx:19-36`. Keep `profile-view.tsx` as the client child.

### SEO-02 — Indexable routes missing from sitemap (`/backtesting`, `/backtesting/explore`, `/community/trending`, community blog posts)

- **Dimension:** SEO · **Severity:** P1
- **File:** `src/app/sitemap.ts:8-34`
- **Evidence:** `staticPages` omits the three indexable routes (each sets its own canonical, no `noindex`); sitemap imports the static `POSTS` array (`sitemap.ts:3,28`) so APPROVED community blog articles (served via `listBlogPosts()`, `blog-posts.ts:42-65`, with Article JSON-LD) never enter the sitemap.
- **Fix:** Add the three routes to `staticPages`; make the default export `async` and call `listBlogPosts()` (it degrades to editorial-only on DB failure) instead of importing `POSTS`. Update `sitemap.test.ts`.

### A11Y-01 — Trade-entry form labels not associated with inputs (no `htmlFor`/`id`); repo-wide pattern

- **Dimension:** Accessibility · **Severity:** P1
- **File:** `src/features/trades/components/trade-form.tsx:226-579` (Label primitive: `label.tsx:11-15`)
- **Evidence:** `<Label>` and `<Input>` are siblings with no `htmlFor`/`id` and no implicit nesting, so label clicks don't focus the field and SR announces inputs nameless (Symbol 226, Qty 427, Entry 445, Exit 466, SL 506, etc.). Error `<p>` not linked via `aria-describedby`; no `aria-invalid`. Systemic: **47 `<Label>` across 11 files**. Only `manualCharges` (621-627) is correct.
- **Fix:** Default the `Label` component to associate, or per-field give each input an `id` from the RHF field name with matching `<Label htmlFor>`; add `aria-invalid`/`aria-describedby`. Sweep the other 10 files.

### PWA-01 — LOCAL mode does not work offline; app shell never precached, navigation dead-ends on `/offline`

- **Dimension:** PWA / offline · **Severity:** P1
- **File:** `public/sw.js:30-35` (PRECACHE list `sw.js:3`)
- **Evidence:** Navigate branch is pure network-first `fetch(request).catch(()=>caches.match("/offline"))` with no `cache.put` for documents; PRECACHE holds only `/offline` + two icons. `/app/*` routes are `"use client"` over IndexedDB/sql.js (offline-capable code) but the HTML can never load offline. The `/offline` copy ("needs a connection to reach your database") is false for LOCAL.
- **Fix:** Cache successful document responses and serve last-good document (or a dedicated precached LOCAL app-shell route) on fetch failure, falling back to `/offline` only when no shell is cached. Until shipped, stop advertising LOCAL as offline-capable and fix the copy. _(Pairs with PWA-02/03/08/09.)_

### E2E-01 — CI runs ZERO Playwright e2e; all 51 specs are manual-only

- **Dimension:** E2E coverage · **Severity:** P1
- **File:** `.github/workflows/ci.yml:28-34`
- **Evidence:** Single `verify` job: install, typecheck, lint, `npm test` (vitest), build, ext:build — no `node scripts/e2e-*.mjs`; no `playwright.config.*`; `CONTRIBUTING.md:77-79` confirms e2e are manual-only. Trade-logging, charges, backtest, community, auth and mode-switch regressions merge green.
- **Fix:** Add a second CI job that boots a **prod build** (`next dev` is broken by strict CSP) and runs the ~22 truly creds-free specs (see M-1 for the corrected list); gate PRs on them. Add `playwright.config.ts` + an `e2e:full` runner (retires AUDIT_ROADMAP #9).

### E2E-02 + M-1 (merged) — Auth/community/security specs need a live platform DB and are effectively un-gated; spec credential-gating was undercounted

- **Dimensions:** E2E coverage (merged: "libsql/env-gated" + "auth-HTTP-gated") · **Severity:** P1
- **File:** `scripts/e2e-byod-switch.mjs:19` and `scripts/e2e-security.mjs:78`
- **Evidence:** 22 specs import `@libsql/client/createClient`; `e2e-byod-switch.mjs:19-22` hard-exits without BYOD env. **Crucially, gating by libsql/env imports undercounts:** 6 more specs sign up users via `/api/auth/sign-up` and also need a live platform DB — `e2e-security.mjs:78` (the authz/IDOR sweep, portion (c)), `e2e-full`, `e2e-autocomplete`, `e2e-glogin-onboarding`, `e2e-landing`, `e2e-reactions`. So the security sweep and full-suite spec are **not** creds-free, contradicting E2E-01's naive list.
- **Fix:** Re-classify specs by BOTH `(libsql/env imports)` AND `(calls to /api/auth/sign-up|sign-in)`. Provision a throwaway CI-only **platform** Turso DB (no per-user journal data, safe) + dummy `BETTER_AUTH_URL/SECRET` and run all ~28 gated specs in a secrets-gated nightly job; prioritize `e2e-auth` (reset/OTP/2FA) and `e2e-security`. Only the ~22 demo-journal/local specs belong in the creds-free PR job.

---

## P2 — Fix soon

### Correctness / money

**CORR-06 — Net-short-put max loss (and net-long-put max profit) understated; sampler floors `lo` well above S=0**

- File: `src/lib/options/payoff.ts:103-113`
- Evidence: `payoffRange` sets `lo = max(0, min(minK, center−pad))` with `pad≥center·0.2`; single put K=100 → `lo=80`, so the S→0 leg is never sampled. Short put reports `maxLoss=−15` (at S=80) vs true `−95` at S=0.
- Fix: When the book has any net put exposure, extend the sample range down to `S=0` (or special-case put-bearing books to include S=0). This also makes the post-CORR-01 long-put max profit correct. _(Land together with CORR-01.)_

### Query optimization (server, Turso)

**QP-04 — Free-text post search uses leading-wildcard `LIKE '%q%'` (unindexable full scan); same predicate on the 25 s-polled new-posts pill**

- File: `src/app/api/community/search/route.ts:68-81` · `src/server/community.ts:801-804,907-926`
- Evidence: `WHERE title LIKE '%q%' OR body LIKE '%q%'`; signed-in (block-aware) searches are uncached; `new-count/route.ts:44` forwards `q` into `countNewerPosts`, so a search-scoped feed polls a leading-wildcard COUNT every 25 s.
- Fix: Back text search with SQLite **FTS5** (external-content over title/body) for `/search` and search-scoped feeds. At minimum, never run the polled new-count pill with a `search` predicate (it is recency-only). Cache signed-in searches behind a short block-aware key if FTS is deferred.

**QP-05 — Trending / tag-autocomplete / who-to-follow unroll `posts.tags` via `json_each` (non-indexable full scan); tag-feed uses `tags LIKE '%"tag"%'`**

- File: `src/server/community.ts:1593-1607,1998-2017` · `autocomplete/route.ts:56-65` · `search/route.ts:58-64`
- Evidence: `FROM posts p, json_each(p.tags)` in `loadTagRows`, autocomplete, tag search, shared-tag follow suggestions and the facet query; `post_symbols` is normalized but there is **no `post_tags`** equivalent. (Mitigated by recency windows + 10 min/30 s caches → P2 not P1.)
- Fix: Introduce a normalized `post_tags(post_id, tag, created_at)` join table (mirror `post_symbols`), maintained on post create/edit, indexed `(tag, created_at DESC)` and `(post_id)`. Single highest-leverage fix for all tag paths.

**QP-01 — Notifications hot-poll: index column order forces a sort + a second COUNT per poll**

- File: `scripts/migrate-platform.ts:225` · `src/app/api/community/notifications/route.ts:17-32`
- Evidence: Only index is `(user_id, read, created_at DESC)`; the poll does `WHERE user_id=? ORDER BY created_at DESC LIMIT n` (no `read` predicate), so `read` between the equality and sort columns forces a materialize+sort; unread badge is a separate round-trip. Bell polls every 60 s.
- Fix: Add `CREATE INDEX idx_notifications_user_created ON notifications (user_id, created_at DESC)`; keep the existing index for the unread COUNT prefix. Optionally fold list+count into one round-trip.

### Query optimization (client, sql.js)

**QP-02 — `useTrades` over-fetches: unfiltered `trade_tags⋈tags` scan on every dashboard/trades/analytics render; `tagId` filtered in JS**

- File: `src/features/trades/queries.ts:29-95`
- Evidence: `fetchTagsByTrade(db)` runs with no `trade_id` restriction (29-33); `filters.tagId` filtered via JS `.filter(...)` (88-92). (Composite PK `(trade_id, tag_id)` already serves a scoped lookup — no new index needed.)
- Fix: Scope to the page's trade ids `WHERE tt.trade_id IN (<ids>)`; push `tagId` into the trades SQL via `AND EXISTS (SELECT 1 FROM trade_tags WHERE trade_id=t.id AND tag_id=?)`.

**QP-11 — Mutation `onSuccess: qc.invalidateQueries()` (no key) nukes the entire React-Query cache → every journal query re-scans sql.js**

- File: `src/features/trades/queries.ts:205,221,247,259,304,360`
- Evidence: `useSaveTrade/useDeleteTrade/useAddAttachment/useDeleteAttachment/useImportTrades/useApplyRecompute` all call unfiltered `invalidateQueries()`; in TanStack Query v5 this refetches **all** active queries (trades, tags, accounts, adherence, journal-dates, all-legs…). Import triggers an app-wide refetch storm. The scoped pattern already exists at `journal/queries.ts:67-69`.
- Fix: Scope each invalidation (trade writes → `['trades']`+`['trade']`+`['all-legs']`+`['adherence']` if pnl-affecting; attachments → `['trade', id]`; accounts → `['accounts']`). **Cheapest high-impact win in the set.**

### SEO

**SEO-04 — `/community` feed page has no `<h1>` (only `<h2>`) — broken heading hierarchy on a primary indexable route**

- File: `src/app/community/community-home.tsx:278,287`
- Fix: Add a single `<h1>` ("TradeMarkk Community", visible or sr-only) near the top of the feed section; keep cards as `<h2>`.

**SEO-05 — Auth-gated community sub-routes (`/leaderboard`, `/messages`, `/notifications`) lack `noindex` and carry `canonical=/community`**

- File: `src/app/community/leaderboard/page.tsx` + `messages/page.tsx` + `notifications/page.tsx`
- Evidence: All `"use client"`, export no metadata → can't emit `robots noindex` and inherit the feed canonical; messages/notifications are sign-in-gated personal surfaces yet crawlable.
- Fix: Wrap `/messages` and `/notifications` in thin server pages exporting `metadata:{robots:{index:false}}` (or move under `/app`); give `/leaderboard` a server wrapper with `alternates.canonical:"/community/leaderboard"`. Optionally disallow the two in `robots.ts`.

### Web vitals

**perf-01 — Backtest builder eagerly bundles recharts via a static `ResultsView` import only needed after a run**

- File: `src/components/backtesting/builder/steps/review-step.tsx:15`
- Evidence: Static chain `BuilderShell → ReviewStep → ResultsView → RunResultReport → HeroEquityChart → recharts`; results are gated behind `status!=='idle'`. The lazy pattern is proven in `backtest-home.tsx:12`.
- Fix: `React.lazy(() => import('@/components/backtesting/results/results-view').then(m=>({default:m.ResultsView})))` + `Suspense` fallback at the render site.

**perf-02 — Community feed images use raw `<img>` with no width/height/aspect-ratio → CLS on the highest-traffic authed route**

- File: `src/features/community/components/post-card.tsx:394`
- Evidence: `<img … className="w-full rounded-lg border" loading="lazy" />` with no reserved space; first page is server-seeded so it paints with the document (data-URL images can't use `next/image` under CSP `img-src 'self' data: blob:`).
- Fix: Wrap each image in a fixed-aspect container (`aspect-video` div, img `h-full w-full object-cover`) or reserve `min-h`; keep `loading="lazy"`. Same pattern as `unfurl-card.tsx:35`.

### PWA / offline (LOCAL-mode + cache hygiene cluster — land with PWA-01)

**PWA-02 — sql.js wasm + glue not precached; LOCAL DB init is online-only on first use**

- File: `public/sw.js:3,38-54`
- Evidence: `local.ts:151-152` loads `/sqljs/sql-wasm.wasm` via cache-first-after-fetch; neither path is in PRECACHE. The wasm files are static, non-hashed, 659730 bytes — ideal precache candidates.
- Fix: Add `/sqljs/sql-wasm.wasm` and `/sqljs/sql-wasm-browser.wasm` to PRECACHE; cache the document-referenced `/_next/static` chunks via the PWA-01 shell strategy.

**PWA-03 — Cache `VERSION="tm-v1"` is a hardcoded constant never bumped by the build → stale/poisoned assets persist across deploys; no new SW ever installs**

- File: `public/sw.js:2`
- Evidence: `next build` + `copy-assets.mjs` never rewrite `sw.js`; identical bytes mean the browser sees no new worker, so `addAll`/activate-purge never re-run.
- Fix: Inject a build-derived VERSION (Vercel SHA / Next `buildId`) into `sw.js` at build time (small generate-sw step). Pair with revalidation for non-hashed assets.

**PWA-08 — Cache-first branch caches 4xx/5xx responses unconditionally → sticky cache poisoning**

- File: `public/sw.js:47-49`
- Evidence: `cache.put(request, copy)` with no `res.ok` guard; a 404/500 for a `/_next/static` chunk or wasm mid-deploy is cached and served forever (cache-first, no revalidation, VERSION never bumps).
- Fix: Guard with `if (res.ok && res.type === "basic")` before `cache.put`; combine with the build-derived VERSION (PWA-03).

**PWA-05 — Manifest ships only SVG icons (no PNG 192/512, no apple-touch-icon) → degraded iOS installability**

- File: `src/app/manifest.ts:15-18`
- Evidence: All icons SVG; no PNGs anywhere; no `apple-touch-icon`/`appleWebApp`/`metadata.icons`. iOS Safari ignores SVG manifest icons → generic home-screen icon; Lighthouse flags missing 192/512 PNG.
- Fix: Generate 192×192 + 512×512 PNG ("any" + safe-zoned "maskable"); add `app/apple-icon.png` (180×180). Keep SVGs as additional "any" entries.

### Accessibility

**A11Y-02 — `TabsTrigger` removes the focus outline with no replacement ring (invisible keyboard focus)**

- File: `src/components/ui/tabs.tsx:31`
- Evidence: `focus-visible:outline-none` with no `ring`, unlike every other primitive (`button/input/switch/checkbox/slider` all add `focus-visible:ring-2 focus-visible:ring-accent`). WCAG 2.4.7.
- Fix: Append `focus-visible:ring-2 focus-visible:ring-accent` to the `TabsTrigger` className.

**A11Y-03 — Backtesting + Pulse/admin charts lack `role="img"` + value-bearing `aria-label`**

- File: `src/components/backtesting/results/hero-equity-chart.tsx:59` (also `walkforward-curve.tsx:28`, `compare/compare-overlay-chart.tsx:29`, `charts/trend-charts.tsx` DailyBars/DailyViewsArea)
- Evidence: Four chart containers wrap `ResponsiveContainer` with no accessible name, unlike the role=img charts (equity-chart, payoff-diagram, etc.).
- Fix: Wrap each with `role="img"` + summarizing `aria-label`; reuse `features/analytics/chart-aria.ts`.

**A11Y-04 — `text-profit` green fails WCAG AA contrast on white in light theme**

- File: `src/styles/globals.css:15`
- Evidence: Light `--profit #059669` = 3.77:1 on white / 3.61:1 on `--bg` (< 4.5:1); `--loss` passes (4.83:1). Renders at small sizes 63× via `PnlText`. (`signed` +/- gives a non-color cue → P2 not P1.)
- Fix: Darken light `--profit` to ~`#047857` (5.48:1 on white) or split a darker text shade vs fill shade (mirror `--accent`/`--accent-solid`). Re-check at 10–11 px.

**A11Y-05 — Confidence rating rendered as repeated `★` glyph: lucide-only violation + no text equivalent**

- File: `src/features/trades/components/trade-detail.tsx:230`
- Evidence: `"★".repeat(confidence)` — SR reads a run of stars with no "3 of 5"; form uses numbered 1–5 buttons (`trade-form.tsx:552-566`).
- Fix: Render 5 lucide `Star` icons (filled to N, outline rest) in a wrapper `aria-label={`Confidence ${n} of 5`}`, or plain `3/5`.

### E2E coverage

**E2E-03 — Currency (CDS) segment never logged end-to-end (only an empty filter assertion)**

- File: `scripts/e2e-seg-filters.mjs:236`
- Evidence: Only Currency reference asserts the empty state; `e2e-seg-lots` logs Options/Commodity/Futures/BankNifty but no USDINR. CDS form→save→display (lot default, charges, P&L) has no browser proof.
- Fix: Add a Currency case to `e2e-seg-lots.mjs` (USDINR/EURINR), assert the live qty readout and saved qty/lot badge.

**E2E-04 — Charges correctness only vitest-golden; e2e never asserts a displayed rupee charge value**

- File: `scripts/e2e-seg-dashboard.mjs:182`
- Evidence: e2e only comments "net is a touch lower"; `e2e-seg-recompute` uses a manual ₹800 override (tests the trigger, not engine values). A mis-wired engine→UI field would pass e2e.
- Fix: Log one deterministic trade and assert displayed total charges (and that breakdown rows sum to net) equal the charges-lib golden value to the paisa.

**E2E-05 — Community leaderboard route + page have NO test of any kind**

- File: `src/app/api/community/leaderboard/route.ts:1`
- Evidence: Zero e2e/vitest references; only an incidental `starter-suggestions.test.ts:62` hit. The reputation ranking SQL is unverified.
- Fix: Vitest for the ranking query (ordering, tie-breaks, LIMIT) + a light e2e that loads `/community/leaderboard` with zero console errors.

**E2E-06 — Backtesting code-editor route (`/backtesting/code`) has zero e2e despite executing user-authored strategy code**

- File: `src/app/backtesting/code/page.tsx:1`
- Evidence: Zero references; the most error-prone surface (custom code run/sandbox) has no browser proof.
- Fix: Add `e2e-bt-code.mjs`: run a minimal valid strategy → assert done+stats; run an invalid one → assert a graceful error (no worker hang/console crash).

**M-2 — Security-critical account/community routes have no e2e (2FA, account export, email/password change, community block, admin feedback)**

- Dimension: E2E coverage · Severity: **P2**
- File: `src/app/api/account/2fa/route.ts:1` (+ `account/export`, `account/email`, `account/password`, `community/block`, `admin/feedback` — all 0 specs)
- Evidence: Survey of 65 route handlers vs 51 specs; these are exactly the authz/data-exfil and account-takeover surfaces. `export` and `block` have no dedicated browser proof; the only 2FA coverage is in the libsql-gated `e2e-account-settings` (not in CI). Compounds E2E-02.
- Fix: Secrets-gated e2e (or API vitest with a seeded platform DB) for `account/export` (own-data-only + cross-user 403), `community/block` (blocked user hidden/can't DM/reply), and 2FA disable (re-auth). At minimum add cross-user 403 assertions for `account/export` and `account/email` to the authz sweep.

### Security

**SEC-01 — CSP allows `'unsafe-inline'` for `script-src` (no nonce) — defense-in-depth gap (no exploit path today)**

- File: `next.config.ts:16`
- Evidence: `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`. Independently verified there is **no** inline-XSS sink today: inline scripts are static constants (`layout.tsx:68-72`, `app/layout.tsx:20-24`); user HTML goes through `sanitizeRichHtml` on write; JSON-LD is escaped; post bodies render as plain-text JSX.
- Fix: Migrate to a per-request nonce CSP (generate in middleware, propagate to `next/script` + framework bootstrap, drop `'unsafe-inline'` from `script-src`). If deferred, keep the strict no-third-party-script-hosts posture and document the residual risk; `style-src 'unsafe-inline'` may stay.

---

## P3 — Backlog / defense-in-depth

| ID                             | Title                                                                                                                                   | Dimension                                 | File:line                                                                                                       | Fix (short)                                                                                                                                                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SEC-02 + DBISO-01** (merged) | Admin `ban-user`/`delete-content` can target PROTECTED owner/demo accounts (no `isProtectedAccount` guard on the admin path)            | Security + DB-isolation/protected-account | `src/app/api/admin/moderation/route.ts:75-88` · `src/server/moderation.ts:27`                                   | In the ban (and delete-content) branch resolve the target email and return 403 when `isProtectedAccount(email)` (mirror `account/delete/route.ts:30`); reuse the single-sourced allowlist. Allow unban so accidental bans clear. Add a `moderation.test.ts` unit test. |
| SEC-03                         | Unfurl SSRF guard re-resolves DNS on `fetch()` (TOCTOU / DNS-rebinding window)                                                          | Security                                  | `src/server/unfurl.ts:107-122`                                                                                  | Pin the validated IP (resolve+verify once, fetch IP with original Host header, or undici Agent custom `lookup`). Low priority — blind SSRF, stored input; document `UNFURL_ALLOWED_HOSTS` as the prod control.                                                         |
| QP-03                          | Journal `trades` has no `status`/`closed_at` index — adherence/recompute "closed" scans are full-table (adherence also ignores from/to) | Query opt (client)                        | `migrations.ts:135-140` · `rules/queries.ts:175` · `trades/queries.ts:322`                                      | Add `idx_trades_status (status[, closed_at])`; for the `date(closed_at)` GROUP BY use a precomputed `closed_date` column or expression index.                                                                                                                          |
| QP-06                          | who-to-follow / For-You issue 7–10 sequential queries re-embedding the same exclusion subqueries per candidate source                   | Query opt (server)                        | `src/server/community.ts:1941-2132,947-1022`                                                                    | Load follow-set + both block-sets once into JS Sets (or one CTE) and reuse. Backed by existing follows indexes; add `idx_user_status` (QP-07).                                                                                                                         |
| QP-07                          | `user.status` has no index but is filtered via `NOT IN (SELECT id FROM user WHERE status='banned')` in 4+ subqueries                    | Query opt (server)                        | `migrate-platform.ts:396` · `community.ts:1982,2014,2037,2052`                                                  | `CREATE INDEX idx_user_status ON user (status) WHERE status IS NOT NULL` (partial — banned are a tiny fraction).                                                                                                                                                       |
| QP-08                          | DM inbox last-message via correlated MAX self-join; duplicate-last-row tie if two messages share an ISO `created_at`                    | Query opt (server)                        | `dm/conversations/route.ts:35-57`                                                                               | Denormalize last-message body/sender/createdAt onto conversations; derive unread from existing `last_read_a/b`. If keeping the join, tie-break by `m.id`.                                                                                                              |
| QP-09                          | `queryFeed` Top/For-You `SELECT *` a 120–150-row candidate window (heavy body/trade_card/tags/reactions cols) then slice to ~15 in JS   | Query opt (server)                        | `community.ts:824-829,1088-1093`                                                                                | Select only scorer columns for ranking, then fetch full rows for survivors (or let `hydratePosts` do it).                                                                                                                                                              |
| QP-10                          | Dashboard recomputes `closedOnly`/`horizonMix`/`dailyPnl`/emphasis over the full trade set on every render (outside `useMemo`)          | Query opt (client)                        | `app/dashboard/page.tsx:66-79`                                                                                  | Wrap the four derived series in `useMemo` keyed on `allTrades`/`mix`. Pure win.                                                                                                                                                                                        |
| QP-13                          | Date-range filters wrap the column in `date()`, defeating `idx_trades_opened_at` (also adherence GROUP BY)                              | Query opt (client)                        | `trades/queries.ts:58-64` · `rules/queries.ts:175`                                                              | Compare raw column with date-boundary literals: `t.opened_at >= from+'T00:00:00'` and `< (to+1d)+'T00:00:00'`.                                                                                                                                                         |
| CORR-03                        | `dailyPnl`/`equityCurve` bucket by UTC date, not IST — inconsistent with horizon/FY/spans; off-by-one for 00:00–05:30 IST closes        | Correctness                               | `src/lib/stats/stats.ts:95-103`                                                                                 | Key by `istDateKey(t.closed_at)`; align heatmap cells to IST too. Add a near-IST-midnight test.                                                                                                                                                                        |
| CORR-04                        | `byExpiryDay`/`byHourOfDay`/`byWeekday`/`dayTimeHeatmap` group by UTC or viewer-local time, not IST                                     | Correctness                               | `src/lib/stats/stats.ts:182-189`                                                                                | Bucket on IST (`istDateKey`; derive hour/weekday via a fixed IST offset's UTC getters).                                                                                                                                                                                |
| CORR-05                        | `NEXT_WEEKLY` can resolve to the SAME week when the rule weekday is a holiday                                                           | Correctness                               | `src/lib/backtest/calendar/market-calendar.ts:192-201`                                                          | Advance from the **unrolled** rule-weekday occurrence (`addDays(rawWeekly, 7)`) before re-resolving. Add a holiday golden test asserting NEXT_WEEKLY > WEEKLY.                                                                                                         |
| SEO-03                         | Sub-pages without `openGraph.url` inherit the homepage og:url; community/backtesting still set `openGraph.url` without images           | SEO                                       | `layout.tsx:31` · `community/page.tsx:12` · `backtesting/page.tsx:10`                                           | Remove `openGraph.url` from the two special-cased pages (let `metadataBase`+canonical drive URLs), or give every shareable route its own. Cosmetic (canonical already correct).                                                                                        |
| SEO-06                         | `robots.ts`/middleware don't disallow private community/backtesting surfaces; `/reset-password` is crawlable                            | SEO                                       | `robots.ts:6` · `reset-password/page.tsx`                                                                       | Add `noindex` to `/reset-password` (server wrapper or robots disallow). Builder routes already meta-noindexed; robots only saves crawl budget.                                                                                                                         |
| SEO-07                         | WebSite JSON-LD doc-comment claims a search action but emits none; SoftwareApplication lacks `aggregateRating`                          | SEO                                       | `src/config/site.ts:27-57`                                                                                      | Add a `SearchAction potentialAction` (e.g. `/community?q={query}`) or delete the "search action" phrase. Add `aggregateRating` only with real review data.                                                                                                             |
| perf-03                        | Trade-detail screenshot grid uses raw `<img>` with no dimensions/lazy → CLS on attachment decode                                        | Web vitals                                | `trade-detail.tsx:317`                                                                                          | Fixed-aspect cell (`aspect-video`, img `object-cover`) + `loading="lazy"`.                                                                                                                                                                                             |
| perf-04                        | Public `/pulse` statically bundles recharts for below-the-fold trend charts                                                             | Web vitals                                | `pulse/_components/pulse-sections.tsx:2`                                                                        | `dynamic(import(...PulseCharts), {ssr:false, loading:<Skeleton/>})`, mirroring dashboard/analytics.                                                                                                                                                                    |
| perf-05                        | Community feed renders all accumulated posts with no virtualization → unbounded DOM growth (INP on long sessions)                       | Web vitals                                | `feed.tsx:142`                                                                                                  | Virtualize with the already-installed `@tanstack/react-virtual` (windowed, keyed by `post.id`), or recycle far-offscreen cards.                                                                                                                                        |
| PWA-04                         | No SW update flow; `skipWaiting`+`clients.claim` swap assets mid-session (latent until PWA-03 lands)                                    | PWA                                       | `public/sw.js:10,19` · `pwa-register.tsx:11-27`                                                                 | Listen for `updatefound`/`statechange==='installed'` (with a controller) and surface a "New version — reload" toast; consider gating `skipWaiting` behind a user action.                                                                                               |
| PWA-09                         | Cache-first asset fetch has no offline `.catch()` → hard ChunkLoadError/wasm-init failure offline                                       | PWA                                       | `public/sw.js:43-53`                                                                                            | Precache critical wasm (PWA-02) + shell chunks (PWA-01); add a `.catch()` fallback for other assets.                                                                                                                                                                   |
| A11Y-06                        | Raw glyphs as UI icons: `⋯` post-options trigger, `✓`/`✗` adherence counters, `✓` setup-step                                            | Accessibility                             | `post-card.tsx:288` · `rules/components/adherence-panel.tsx:37` · `backtesting/builder/steps/setup-step.tsx:89` | Replace with lucide `MoreHorizontal`/`Check`/`X`; add sr-only text on the counters.                                                                                                                                                                                    |
| A11Y-07                        | Sub-44px touch targets in the multi-leg builder (Buy/Sell+CE/PE toggles, lots stepper, ladder tabs)                                     | Accessibility                             | `backtesting/builder/steps/legs-step.tsx:280`                                                                   | On coarse pointers bump to ≥44px hit area; prioritize the lots stepper and Buy/Sell/CE/PE toggles.                                                                                                                                                                     |
| A11Y-08                        | Dialog close (X) drops focus outline with no replacement ring                                                                           | Accessibility                             | `src/components/ui/dialog.tsx:27`                                                                               | `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`.                                                                                                                                                                                           |
| A11Y-09                        | Muted text on `surface-2` is 4.40:1 (below AA) at very small sizes                                                                      | Accessibility                             | `src/styles/globals.css:11`                                                                                     | Nudge light `--text-muted` to ~`#6b6b73` (4.81:1) or avoid smallest muted text on surface-2 fills.                                                                                                                                                                     |
| A11Y-10                        | Tooltip-trigger button in BT results uses `focus:outline-none` with no ring (inconsistent with line 70 in same file)                    | Accessibility                             | `quality-chip-row.tsx:89`                                                                                       | Append `focus-visible:ring-2 focus-visible:ring-accent` to match line 70.                                                                                                                                                                                              |
| E2E-07                         | PWA `/offline` page + `public/sw.js` completely untested                                                                                | E2E                                       | `src/app/offline/page.tsx:1`                                                                                    | Prod-build e2e: register SW, `setOffline(true)`, navigate, assert `/offline` (+ smoke-load for console errors).                                                                                                                                                        |
| E2E-08                         | Admin `/api/admin/overview` mixed-timestamp SQL (unix-int vs ISO-text) currently correct but unverified                                 | E2E                                       | `src/app/api/admin/overview/route.ts:38`                                                                        | Vitest seeding users (unix-seconds) + posts/page_events (ISO) on both sides of 7d/14d boundaries; assert each stat.                                                                                                                                                    |
| E2E-09                         | Protected-account delete guard unit-tested but never exercised end-to-end                                                               | E2E                                       | `src/app/api/account/delete/route.ts:30`                                                                        | Secrets-gated e2e: sign in as a protected account, assert `POST /api/account/delete` → 403 "protected".                                                                                                                                                                |

**Informational (no action):**

- **QP-14** — _Refuted._ `queryKey: ['trades', filters]` (`queries.ts:53`): TanStack Query hashes keys structurally, so object identity does not cause cache misses. No issue.
- **PWA-07** — _Positive._ `public/sw.js` is CSP-clean (Cache/Fetch only, no eval/inline); `worker-src 'self' blob:` + `wasm-unsafe-eval` cover SW register + sql.js. Keep the `/sw.js` must-revalidate header.

---

## Coverage

**Audited (static, read-only):** All 9 dimensions across the App Router (43 pages, 65 API handlers), `src/server/*`, `src/lib/*` (charges/stats/options/montecarlo/tax/backtest/db), platform & journal schemas + migrations, `next.config.ts`/middleware/CSP/robots/sitemap/manifest, `public/sw.js`, the 51 Playwright specs and the vitest corpus, and the CI workflow. Findings were adversarially re-verified — including several first-pass corrections (e.g. `trade_tags` already has a serving PK index; QP-14 refuted; QP-06/07 subquery "per-row scan" framing overstated; spec credential-gating undercounted in M-1; corrected file paths for A11Y-03).

**Still needs a dynamic / manual pass:**

- **Live Playwright run** — every conclusion about runtime regressions is from static reading; nothing was executed. Stand up the prod-build CI job (E2E-01) and a secrets-gated platform-DB job (E2E-02/M-1) to actually exercise auth/community/security/IDOR flows.
- **Lighthouse / WebPageTest** — CLS (perf-02/03), recharts first-load JS (perf-01/04), INP under long-scroll (perf-05) and PWA installability (PWA-05) need real measurement.
- **Real-device / cross-timezone** — iOS Add-to-Home-Screen icon (PWA-05), coarse-pointer touch targets (A11Y-07), and the IST-vs-viewer-local bucketing edges (CORR-03/04) should be checked on device and with a non-IST locale.
- **Offline behavior** — PWA-01/02/08/09 must be validated by installing a prod build in LOCAL mode and killing the network (the exact repros in the findings).
- **Contrast** — A11Y-04/09 ratios were computed by hand; confirm with an automated checker at the smallest rendered sizes once tokens change.

---

## Prioritized FIX PLAN (batched)

1. **Options payoff math (CORR-01 + CORR-06).** Fix `profitUnbounded = calls > 0`, extend the sampler to S→0 for put-bearing books, and add long-put / short-put golden tests. One PR — they share `payoff.ts` and the same range root cause.

2. **Tax/charge classification (CORR-02).** Route `parseContractName(...).agri` through `classifyAgriCommodity` (or purge processed entries from `NCDEX_AGRI_BASES`); flip `instrument-parse.test.ts:270`. Standalone, highest data-integrity impact. _(Consider a one-off recompute/migration for already-stored GUARGUM trades.)_

3. **SEO canonical + discoverability (SEO-08, SEO-01, SEO-02, SEO-04, SEO-05; sweep SEO-03/06/07).** Add self-canonical to post + profile routes (server-wrapper `generateMetadata`), expand the sitemap (+async `listBlogPosts()`), add the `/community` `<h1>`, and noindex/correct-canonical the auth-gated sub-routes. All metadata/route-config edits — land together with one `sitemap.test.ts` update.

4. **Accessibility focus + labels batch (A11Y-01 first, then A11Y-02/08/10; A11Y-03/05/06).** Fix the trade-form label↔input association (and the Label primitive default) and the systemic focus-ring gaps (tabs/dialog/tooltip — same `focus-visible:ring` snippet), then chart `role="img"` and glyph→lucide/text swaps. Contrast token nudges (A11Y-04/09) ride along as a small `globals.css` change.

5. **React-Query + journal client perf (QP-11 first, then QP-02, QP-10, QP-13, QP-03).** Scope all mutation invalidations (cheapest, biggest win), scope the tag fetch, memoize dashboard derivations, make date filters sargable, add the `status` index. All client-side `src/features/trades/*` + `migrations.ts`.

6. **PWA offline correctness (PWA-01 + PWA-02 + PWA-03 + PWA-08; then PWA-09, PWA-04, PWA-05).** Rewrite `public/sw.js` as one change: cache documents + precache wasm/shell chunks, guard `if (res.ok && res.type==='basic')`, inject a build-derived VERSION, add an update toast in `pwa-register.tsx`, and ship PNG/apple-touch icons. Fix the `/offline` copy.

7. **Server query/index hardening (QP-01, QP-05, QP-04; then QP-06/07/08/09).** Add the notifications index, introduce the normalized `post_tags` table (unblocks trending/autocomplete/tag-feed/follow-suggestions), and back text search with FTS5 (and stop the polled pill running a `search` predicate). Higher effort — schedule after the quick index wins.

8. **CI test gating (E2E-01 + E2E-02/M-1 first).** Add `playwright.config.ts` + an `e2e:full` runner; a creds-free PR job (prod build, ~22 demo/local specs) and a secrets-gated nightly platform-DB job (the ~28 auth/community/security specs, re-classified by libsql **and** auth-HTTP usage). Then backfill the coverage gaps: E2E-03 (CDS), E2E-04 (rupee-exact charges), E2E-05 (leaderboard), E2E-06 (`/backtesting/code`), M-2 (export/block/2FA authz), E2E-07/08/09.

9. **Security defense-in-depth (SEC-02/DBISO-01, then SEC-03, SEC-01).** Add the protected-account guard to the admin ban/delete-content path (+ unit test), pin the unfurl IP / document `UNFURL_ALLOWED_HOSTS`, and schedule the nonce-CSP migration. No active exploit, so lowest urgency despite invariant relevance — but the protected-account guard is small and should ride with batch 8's test work.

10. **Correctness backlog (CORR-03, CORR-04, CORR-05).** IST-bucket the stats/calendar series, fix non-IST analytics buckets, and the `NEXT_WEEKLY`-on-holiday edge — each with a boundary golden test. Low real-world frequency; batch when touching `src/lib/stats/*` and the backtest calendar.
