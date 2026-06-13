# Backtesting Platform — Overview & Vision

> **Status:** Build-ready specification. This is the root document of the `docs/backtesting/`
> spec set. It is the canonical "why and what" — every subsequent doc is the "how" of one
> slice. Implementation workflows should read this first, then the doc relevant to their slice.
>
> **Audience:** the implementation team (and the agents that drive it).
> **Scope of this doc:** vision, the two user modes, public-universe placement, the
> login-nudge-at-results principle, the near-zero-cost client-side execution model, and a
> one-paragraph map of every other doc in this set.

---

## North Star

> **A trader lands, picks one of two ways to backtest, builds and runs an idea entirely in
> their own browser, sees a beautiful, honest result — and is asked to sign in only at the
> exact moment they want to keep it.** Nothing before a rendered result ever costs us a cent,
> leaks their data, or demands an account.

If a single screen, route, or line of code makes any of those four promises false —
**free**, **in-browser**, **honest**, **no login until the moment of value** — it is wrong.
This sentence is the tie-breaker for every design decision that follows.

---

## 1. Vision

Indian intraday and F&O traders have exactly one serious options-backtesting tool that
the market treats as the gold standard — **AlgoTest** — plus a handful of adjacent tools
(Sensibull, Opstra, Streak, Tradetron). They share three structural weaknesses:

1. **They gate value behind login and payment.** You often cannot even _see_ a result
   without an account, and meaningful usage is paid.
2. **They are not honest about data.** Options history is patchy — strikes go missing,
   illiquid days exist — and these tools paper over it silently, presenting a clean curve
   built on substituted or interpolated data the user never sees.
3. **Their UX is dense and intimidating.** Five raw strike fields, jargon-soaked risk
   controls (`RE COST`, `ATM Pt`, `Trail X/Y`), no mobile app worth the name.

**TradeMarkk Backtesting** is the answer to all three, built on a constraint the
incumbents cannot match: **it costs us almost nothing to run, because it runs on the
user's machine.**

- **Free and anonymous-first.** Build and run with no account. The login wall appears
  only when you choose to _save, share, schedule, or be notified_.
- **Radically honest about data.** Coverage and nearest-strike substitution are
  first-class citizens — shown on the landing sample, in the builder, on every result,
  and in a dedicated data-coverage explorer. This is the single differentiator none of
  the incumbents offer.
- **World-class, mobile-first UX.** Benchmark the _breadth_ against AlgoTest, but
  benchmark the _polish_ against Linear, Stripe, TradingView, and Composer — adapted for
  an Indian options trader on a phone.
- **Open source and auditable.** The engine, the charges model, the Monte-Carlo — all
  inspectable. "Trust these numbers" is backed by "read the code."

This is **not** a feature inside the journal. It is a **standalone public universe**, a
peer to `/community`, reachable from the marketing site header, fully usable by people who
will never open the journal.

---

## 2. Scope — three instruments, two modes, one engine

### 2.1 Instruments (exactly three)

| Index         | Spot data            | Options data                         | Lot size | Notes                            |
| ------------- | -------------------- | ------------------------------------ | -------- | -------------------------------- |
| **NIFTY**     | 2021–2026 (complete) | weekly + monthly, patchy             | 75       | Best coverage; the safe default  |
| **BANKNIFTY** | 2021–2026 (complete) | weekly + monthly, patchy             | 35       | Good index data; sparser strikes |
| **SENSEX**    | 2022–2026 (complete) | weekly + monthly, **worst coverage** | 20       | Honesty layer matters most here  |

Data is the public HuggingFace dataset **`thetrademarkk/india-index-options-1m`** — 1-minute
OHLC(+OI) parquet, **queried on demand** via DuckDB `hf://` range reads (no full download).

- `index/{SYMBOL}.parquet` — **complete** for the ranges above.
- `options/{SYMBOL}/{EXPIRY}.parquet` — columns
  `timestamp, open, high, low, close, volume, open_interest, trading_day, symbol, strike, option_type, expiry`
  — but **coverage is patchy: roughly 40–68% of strikes are missing** (SENSEX worst), and some
  captured strikes are sparse/illiquid.

> **Hard design consequence:** the system must handle missing/illiquid strikes _gracefully and
> visibly_ — nearest-available-strike substitution, explicit coverage/confidence indicators, and
> honest empty states. Never a silent fabrication. See **[02 — Data & coverage](02-data-coverage.md)**.

### 2.2 The two modes

**Mode 1 — No-Code Strategy Builder (primary).** A guided 4-step wizard with a persistent
live preview:

```
● Market ── ○ Legs ── ○ Timing & Risk ── ○ Review
  index +      CE/PE,      entry/exit time,    plain-language
  interval +   Buy/Sell,   days, days-from-     summary +
  date range   lots,       expiry; per-leg      coverage badge +
  + coverage   strike by   SL/TGT/trail +       "Run backtest"
  badge        ATM±/%/      overall MTM SL/
               premium/     target + re-entry
               delta/exact
```

Benchmark = AlgoTest's breadth, delivered through one tabbed strike control and progressive
disclosure instead of a wall of fields. See **[03 — No-code builder](03-no-code-builder.md)**.

**Mode 2 — Bring-Your-Own-Code.** The user writes a Python strategy; we run it **in their
browser** via **Pyodide + duckdb-wasm**, exposing a tiny (~6-function) data API
(`load_index`, `load_option`, `nearest_strike`, …). Monaco editor, runnable starter
templates, plain-English error cards. Zero server trust, zero compute cost. An optional
future **paid server tier** (Vercel Sandbox microVM, deny-all network) is the escape hatch
for runs the client cannot finish — security-checked before any server run.
See **[04 — Bring-your-own-code](04-bring-your-own-code.md)**.

> **One engine, public.** We do not duplicate a backtest engine inside `/app`. The journal
> _links into_ the public builder (prefilled params) and _links out_ by saving a config. The
> placeholder at `/app/app/backtesting` is deleted and permanently redirected. See §6.

---

## 3. Public-universe placement

Backtesting is a sibling of `/community` and `/blog`: a public area under the **shared
marketing site header**, not under the authenticated `/app` journal.

```
                  ┌──────────────────────────────────────────────────────┐
                  │           PUBLIC UNIVERSES — one shared header          │
                  │   marketing  ·  /community  ·  BACKTESTING  ·  /blog    │
                  └──────────────────────────────────────────────────────┘
                              anon-first · $0 to run · educational
       cross-links (never prerequisites)  │
   ┌──────────────────────┬───────────────┴───────────────┬───────────────────┐
   ▼                      ▼                                 ▼                   ▼
COMMUNITY            BACKTESTING                         JOURNAL (/app)      BLOG / DOCS
"share a result"     "validate an idea"                 "your real trades"  "learn"
       ◀──── "post this backtest to community" ────▶          ▲
              "backtest a journaled playbook" ────────────────┘
```

**Header & chrome.** Clone the community layout pattern — `src/app/community/layout.tsx`
wraps children with the shared `SiteHeader` + `QueryProvider`. The backtesting layout does the
same with a backtesting-specific CTA slot. The nav entry is added to the `NAV` array in
`src/components/shared/nav-links.tsx` (today: `Features · Community · Pulse · Docs · Blog · FAQ`),
inserted as the second universe right after **Community**. The existing active-state logic
(`pathname.startsWith(href + "/")`) lights up the entry for any sub-route automatically — no
extra wiring.

> **Route base — canonical decision.** The two design inputs use different bases
> (`/backtesting` in the IA spec, `/backtest` in the architecture spec). **`/backtesting` is the
> canonical user-facing route base** (it reads better in the header beside "Community" and in
> shared URLs). The architecture doc's `/backtest/**` examples map 1:1 onto `/backtesting/**`.
> Wherever a code path is shown in this set, treat `/backtest` and `/backtesting` as the same
> universe; implement under **`/backtesting`**. See **[01 — Information architecture & journeys](01-ia-and-journeys.md)**.

**Crawlability & SEO.** Landing, templates, strategy-detail, explore gallery, and the data
explorer are statically/ISR rendered and indexable (clone `community/page.tsx`'s `revalidate`

- ISR-seed pattern). Builder/editor are app-like (`noindex`); **public saved runs** and
  **strategy-detail** pages are the SEO surface ("NIFTY short straddle backtest 2021–2026") and a
  dynamic OG image per shared run makes WhatsApp/Twitter shares — the dominant Indian-trader
  channels — delightful.

---

## 4. The login-nudge-at-results principle

This is the most important UX rule in the entire product, and it is non-negotiable.

> **Never gate login upfront. The login wall appears only on a save / share / schedule /
> notify intent — and the finished result is visible on screen behind the modal, so the user
> sees exactly what they would lose by walking away.**

### What is free and anonymous vs what nudges login

| Action                                                         | Anonymous                              | Signed-in       |
| -------------------------------------------------------------- | -------------------------------------- | --------------- |
| View landing, templates, data explorer, docs, explore gallery  | ✅                                     | ✅              |
| Build a strategy (no-code) / write code (BYOC)                 | ✅                                     | ✅              |
| **Run** a backtest (client-side)                               | ✅                                     | ✅              |
| **View** any result (own or shared)                            | ✅                                     | ✅              |
| **Save** a run / strategy                                      | ❌ nudge                               | ✅              |
| **Share** with a stable public URL                             | ❌ nudge (in-session link still works) | ✅              |
| **Compare** runs from history                                  | ⚠️ only runs held in this session      | ✅ full history |
| **Schedule** / server-run (>300s) / **email-notify**           | ❌ nudge                               | ✅              |
| Publish to Explore gallery / cross-link to journal & community | ❌ nudge                               | ✅              |

### Why this works — the ephemeral-run mechanic

The result already exists _before_ any account does, so the nudge is an offer, not a toll:

```
            run finished, RESULT ON SCREEN (anonymous)
                              │
        ┌──────────┬──────────┼──────────┬──────────┐
        ▼          ▼          ▼          ▼          ▼
     [Save]    [Share]   [Notify me] [Schedule]  (none → keep browsing)
        │          │          │          │
        └──────────┴────► login-nudge modal ◄─────┘
            (contextual headline + the result thumbnail behind it)
                              │
                ┌─────────────┴──────────────┐
                ▼                             ▼
        sign in / sign up            "Maybe later" → dismiss;
        (Better Auth, existing)       result stays, ephemeral
                │                      link copied to clipboard
                ▼
   the anonymous run (held in memory + IndexedDB / localStorage)
   is POSTed once to /api/backtest/runs → swapped for a stable
   server id → return to the result with the intended action
   auto-completed (e.g. the share link is now permanent).
   THE USER NEVER RE-RUNS.
```

Implementation contract:

- Every run gets an **ephemeral `runId` (uuid) the instant it starts**, so the result page
  `/backtesting/run/[id]` is routable and deep-linkable _within the session_.
- The result payload (config + computed metrics + series) is cached to `localStorage` /
  IndexedDB (a capped `recentRuns` list + a per-run blob). This makes **Back** lossless and
  **Recent runs** possible with **no server**.
- On login at the nudge, the cached run is **POSTed once** and the ephemeral id is swapped for
  a stable server id (redirect to the new URL). Nothing is recomputed.
- **Anonymous share** offers a copy-link that works while the tab/session lives, plus an honest
  inline nudge ("Log in for a permanent link") — never a dead button.

> **Signed-in users are never redirected away from the backtesting landing** (unlike the
> marketing root). It is a real destination for everyone; only the hero density and CTAs swap.
> Save/share become **inline and optimistic** (no modal) once authenticated.

See the full state machine and journey maps in **[01 — IA & journeys](01-ia-and-journeys.md)**
and the persistence/claim flow in **[05 — Persistence, auth & the claim flow](05-persistence-and-auth.md)**.

---

## 5. The near-zero-cost client-side execution model

**Default execution is 100% client-side.** Both modes run in a **Web Worker** in the user's
browser, mirroring the existing Monte-Carlo worker pattern
(`src/features/analytics/hooks/use-monte-carlo.ts`). There is **no server route required to
_run_ a backtest** in the default path — anonymous runs cost us **$0** and scale infinitely.

```
                         ┌─────────────────── THE BROWSER ───────────────────┐
   user builds / writes  │                                                   │
   strategy ───────────► │  use-backtest-run.ts ──► Web Worker:               │
                         │     ├─ no-code  → backtest.worker.ts               │
                         │     │             (pure TS engine: lib/backtest)   │
                         │     └─ BYOC     → pyodide.worker.ts                │
                         │                   (Pyodide runs the user's Python) │
                         │                          │                         │
                         │                duckdb-wasm range-reads ──┐         │
                         │                          ▼               │         │
                         │   progress streamed back  ◄── RunResult  │         │
                         └──────────────────────────│───────────────│─────────┘
                                                     │   hf:// parquet (range reads only)
                                                     ▼
                                        HuggingFace dataset (public CDN)
                                        thetrademarkk/india-index-options-1m
                          (no full download — narrowest slice per index/expiry/range)
```

**Lane A — Client (default, ~99% of runs).** The worker lazy-boots duckdb-wasm, range-reads
only the HF slices it needs, runs the engine (pure TS `simulate.ts` for no-code; the user's
Python under Pyodide for BYOC), streams honest progress ("Loading runtime… pulling NIFTY 26-Jun
slice… simulating…"), and posts back a self-contained `RunResult`. Cost = $0.

**Lane B — Server (opt-in escape hatch, future paid tier).** Only for runs the client cannot
finish (very large ranges). `POST /api/backtest/server-run` runs **inline up to 300s** using
Next.js `after()`; only if a run could exceed 300s does it enqueue **Upstash QStash** →
webhook → finalize → in-app **notification** (existing `notifications` table) + **Resend email**

- client polling. QStash is wired **only behind an env presence check** — absent it, the >300s
  path degrades gracefully to an honest "run client-side" message, keeping near-zero infra cost a
  hard guarantee.

**Why it stays cheap and safe.**

- **Compute** happens on the user's CPU, not ours.
- **Data** is range-read from a public CDN — we host no market-data infra.
- **Trust** is preserved: in the default path, the user's strategy and data never leave their
  machine. The optional server tier is security-checked and network-denied.

**CSP / headers.** The existing CSP already allows the stack (`'wasm-unsafe-eval'`,
`worker-src 'self' blob:`, `connect-src https:`). The only addition is scoped **COOP/COEP**
headers on the `/backtesting` route family (for Pyodide threading) — never touching the
journal/community pages. Heavy libs (Monaco, Pyodide, duckdb-wasm) are dynamic-imported inside
the worker, so the no-code builder's first paint ships **zero WASM**.

See the full breakdown in **[06 — Execution model & server tier](06-execution-and-server-tier.md)**.

---

## 6. What happens to the existing placeholder

There is a dead placeholder page at `src/app/app/backtesting/page.tsx`. It is **deleted**, and
permanent redirects are added so its promise resolves to the real universe:

```
/app/backtesting       ↪ 308 → /backtesting
/app/app/backtesting   ↪ 308 → /backtesting   (legacy)
```

The journal does not host a second engine. It gains two opt-in bridges instead:
**"Backtest this setup"** (journal playbook → `/backtesting/build?strategy=…`) and
**"Add to my playbook"** (a strong result → journal config). One engine, public, $0.

---

## 7. Reuse map — what already exists that we build on

The platform already contains nearly every primitive this universe needs. Building on these is
mandatory, not optional — it is how we keep scope and infra cost down.

| Existing module                                                                      | Reused for                                                      |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `src/components/shared/site-header.tsx` + `nav-links.tsx`                            | `/backtesting` chrome — edit `NAV` to add the entry             |
| `src/app/community/layout.tsx` (pattern)                                             | the `/backtesting/layout.tsx` shape                             |
| `src/providers/query-provider.tsx`                                                   | TanStack Query for status polling / saved lists                 |
| `src/lib/charges/charges.ts` (`computeCharges`)                                      | realistic STT / GST / stamp / brokerage in fills                |
| `src/lib/options/payoff.ts` (`buildPayoffCurve`, `classifyStrategy`, `daysToExpiry`) | live preview rail, per-leg breakdown, auto-naming the structure |
| `src/lib/montecarlo/*` + `useMonteCarlo`                                             | the Monte-Carlo drawdown cone (zero new worker)                 |
| `src/lib/stats/stats.ts`                                                             | win% / expectancy / streak helpers in metrics                   |
| `src/server/community.ts` (`notify`, `getSession`)                                   | run-ready notification + auth                                   |
| `src/server/email.ts` (`sendEmail`, `emailLayout`)                                   | run-ready email                                                 |
| `src/server/rate-limit.ts`, `src/server/origin-check.ts`                             | every API-route guard                                           |
| `src/lib/id.ts` (`newId`), the `notifications` table                                 | run/strategy IDs + in-app notifications                         |
| `src/components/shared/empty-state.tsx`, `error-fallback.tsx`, `ui/skeleton.tsx`     | honest empty / loading / patchy-coverage states                 |
| `src/components/layout/command-palette.tsx` (cmdk)                                   | optional Cmd+K "New backtest / switch index"                    |

---

## 8. Constraints (the non-negotiables)

1. **Near-zero infra cost.** Default path is client-side; server tier is opt-in and
   env-gated. No always-on market-data infra.
2. **Open source.** The engine, charges, and Monte-Carlo are auditable; "trust the numbers"
   is backed by readable code.
3. **Mobile-first PWA.** Every screen ships its mobile layout as a peer, not an afterthought.
   AlgoTest has no real app; this is a structural win.
4. **Educational and honest.** Persistent, first-class disclaimers — "past performance ≠
   future results · backtests can over-fit" — on every result and in the footer. Coverage and
   substitution are always disclosed, never silent.
5. **Anonymous-first.** No login before a rendered result, ever.

---

## 9. The document set — what each subsequent doc covers

This overview is `00`. The rest of `docs/backtesting/` decomposes the build:

- **[01 — Information Architecture & User Journeys](01-ia-and-journeys.md)** — the full route
  tree with public/gated annotations, the screen inventory (S1–S14), the first-run / returning
  / signed-in state model and its `localStorage` keys, and the end-to-end journey maps
  (new-user golden path, returning user, and the login-nudge state machine), plus ASCII
  wireframes for the landing and mode-choice screens.

- **[02 — Data & Coverage](02-data-coverage.md)** — the HuggingFace dataset shape, the
  duckdb-wasm `hf://` range-read strategy, the strike-coverage computation and manifest,
  nearest-available-strike resolution, the confidence/coverage indicators, the data-coverage
  explorer screen, and the honesty rules that govern every empty/degraded state.

- **[03 — No-Code Strategy Builder](03-no-code-builder.md)** — the 4-step wizard
  (Market · Legs · Timing & Risk · Review), the one-tabbed `StrikeSelector` control
  (ATM± / % / premium / delta / exact), the per-leg and overall risk model, the persistent
  live-preview rail (payoff, PoP, Greeks), autosave-to-localStorage, and the mobile bottom-sheet
  variants.

- **[04 — Bring-Your-Own-Code](04-bring-your-own-code.md)** — the Monaco workbench, the
  ~6-function data API surface and its type stubs, the Pyodide + duckdb-wasm runtime, the
  runnable starter strategies, the plain-English error translator, and the security posture for
  the optional server tier.

- **[05 — Persistence, Auth & the Claim Flow](05-persistence-and-auth.md)** — why saved
  backtests live in **new platform-DB tables** (not the per-user journal DB), the
  `backtest_strategies` / `backtest_runs` schema, the `StrategyDef` and `RunResult` data
  models, the API-route contracts, and the anonymous-run → login → claim → stable-id flow.

- **[06 — Execution Model & Server Tier](06-execution-and-server-tier.md)** — the Web Worker
  architecture (no-code TS engine + Pyodide BYOC), the duckdb-wasm bootstrap and slice helpers,
  the market-calendar module, the client (Lane A) vs server (Lane B) execution lanes, the
  `after()` / QStash / notify / email async-job design, and the CSP/COOP/COEP and bundle notes.

- **[07 — Results, Sharing & Cross-Universe Bridges](07-results-and-sharing.md)** — the
  verdict → evidence → drill-down results dashboard, the equity/drawdown/heatmap/distribution/
  Monte-Carlo/India-breakdown visualizations, the trade blotter and per-leg breakdown, the
  dynamic OG image, the compare-runs view, and the opt-in bridges to community and the journal.

> Doc numbers `02`–`07` describe the planned set; if a slice ships under a different filename,
> this index is the source of truth for _what_ each slice owns. Read `00` (this doc) and `01`
> before touching any other slice.

---

## 10. One-line summary

**A public, anonymous-first, $0-to-run options-backtesting universe for NIFTY / BANKNIFTY /
SENSEX — no-code or bring-your-own-code, executed client-side, radically honest about data,
beautiful on a phone — that asks you to sign in only when you want to keep what you've already
made.**

---

> ⚠️ **Educational tool.** Everything in this universe is for learning and research. Backtests
> can be over-fit; **past performance is not indicative of future results.** Nothing here is
> investment advice.
