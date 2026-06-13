# Critique notes (raw, for the implementation workflow)

## Product / UX critique

I have a comprehensive picture. This is an exceptionally detailed, well-grounded plan. My critique focuses on gaps and friction that would prevent it from being genuinely delightful. I'll deliver the verdict directly.

---

# Ruthless UX/UX critique — TradeMarkk Backtesting

**Overall:** Top 5% of product specs I've reviewed. The honesty-as-moat thesis, the persistent live-preview rail, the login-nudge-at-results rule, and the verdict→evidence→drill-down hierarchy are all correct and well-defended. The plan over-indexes on _static screen polish_ and _happy-path motion_, and under-indexes on **the messy middle**: cold-start latency, mobile preview ergonomics, the strike-ladder's actual interaction physics, comparison/iteration loops, and several states that are named but not designed. Below are the structural problems, then the prioritized 15.

## Where the plan is weakest (themes)

**1. The single biggest unaddressed risk: first-run latency vs. the "<375ms arrival" promise.** The spec repeatedly promises a sub-second/sub-375ms "arrival" feel (§14, C9) while _also_ admitting Pyodide cold-start is "multi-second" and duckdb-wasm must range-read parquet from HuggingFace over the network on the user's connection. These are in direct tension. On a median Indian mobile connection, the _first_ no-code run involves: duckdb-wasm WASM init + httpfs + an HF round-trip for the coverage index + the actual slice. That is not 375ms; it is plausibly 5–15s. The plan's running modal is good, but the landing's "Build your first backtest in 60 seconds" and the "arrival" language set an expectation the architecture can't meet on run #1. **There is no prefetch/warm strategy specified.** This is the difference between delight and a bounce.

**2. The strike ladder is described visually but not as an interaction.** It's the "highest-delight, highest-risk" component (build order #2) yet the spec never resolves: how many rungs render at once, what happens when the user wants strike 22,200 but the ladder shows 22,300–22,700, how horizontal scroll reconciles with the page scroll on desktop, how the "connecting line to the payoff kink" survives 4–6 legs (it would become spaghetti), and what a _dimmed/dashed_ rung does **on tap** (silently no-op? show why? offer the neighbor?). On mobile it's a swipe carousel with snap — but a straddle needs _two_ legs at the _same_ strike and an iron condor needs _four at different_ strikes; the carousel pattern for picking one strike at a time across 4 legs is a lot of swiping with no overview.

**3. Mobile preview is the weakest surface in an explicitly mobile-first product.** The desktop live-rail is the soul of the builder. On mobile it degrades to a "sticky summary bar → tap → bottom sheet." That means the mobile user **loses the always-on payoff feedback loop** that the entire builder thesis rests on — they have to tap to see the consequence of every change. The plan calls itself mobile-first but the mobile builder is demonstrably second-class here.

**4. Several named states have no design.** The spec is rigorous about _naming_ states but leaves some critical ones as a label: the **Compare screen (S8)** gets a route, a column count, and nothing else — no wireframe, no "what's diffable," no mobile story (4 columns on a phone?). **Schedule** is in the nav rule table and the nudge state machine but is _never designed_ (cadence? what does a scheduled backtest even mean against a fixed historical dataset — does it roll the window forward?). **Explore (S9)** and **Templates (S10)** galleries are routed but unspecced for empty/seed state — a brand-new public product has _zero_ public runs on day one, so the "Explore gallery" is empty at launch with no plan for it.

**5. The novice/expert tension is "resolved" by doubling the UI.** "Edit all" power mode (§17) is a second, parallel dense layout sharing the same store. That's two UIs to build, test, and keep in sync, justified for an unproven v1. This is a v2 feature dressed as v1.

## Top 15 prioritized UX improvements

**Priority 1 — Fix the cold-start perception, or the funnel dies at run #1.**

- **Warm the engine on intent, not on Run.** Begin Pyodide/duckdb-wasm init + prefetch the _coverage index_ and the most-likely NIFTY slice the moment the user lands on `/build` (or even hovers the "Build a strategy" CTA on the landing), in an idle callback. By the time they press Run on a 3-month NIFTY straddle, the runtime is warm and the first slice is cached. This single change converts the spec's biggest liability into its "it just works" moment.
- **Pre-bake the landing "sample result" as fully static** (already implied) **and make "Open this run" instant** — it should hydrate from a cached JSON blob, never trigger a live engine boot. Verify the sample is the _only_ thing a first-time visitor sees compute, and it costs nothing.
- Reframe the running-modal copy honestly for the genuine first-run wait: the BYOC "first run takes a few seconds" line is good; the **no-code path needs the same honesty** on run #1 ("Warming up — first run is the slowest"), because the spec currently assumes no-code booting is "~instant" and it isn't when the data slice is cold.

**Priority 2 — Keep the live payoff alive on mobile.** Replace the "tap to expand the summary bar" pattern with a **persistent, collapsed mini-payoff that lives in the sticky bottom bar itself** — a 40px-tall sparkline + Max P / Max L / POP that _updates live_ as legs change, without a tap. The full sheet is for inspection; the glanceable consequence must never require a tap. Mobile-first means the feedback loop is first-class on mobile, not gated behind a gesture.

**Priority 3 — Specify the strike ladder as a real interaction, and give multi-leg an overview.**

- Define rung count (e.g., 7 visible, ATM-centered, virtualized beyond), the desktop scroll model (wheel/drag horizontal, never hijacking page scroll), and the "jump to a far strike" affordance (a small "± offset" numeric input beside the ladder so you don't drag 12 rungs).
- **Tapping a dimmed (low-coverage) rung must do something kind:** a popover — "22,650 is 58% covered. Use 22,700 (88%)? [Use neighbor] [Use anyway]" — never a silent no-op.
- For 4-leg structures, **the right-rail payoff IS the multi-leg overview**; drop the per-leg "connecting line to the kink" beyond 2 legs (it becomes noise) and instead highlight the _active_ leg's strike on the payoff x-axis on focus only.

**Priority 4 — Design the iteration loop, not just the first run.** The most valuable thing a backtester does is **change one thing and re-run**. The plan has "Re-run" and "Edit strategy" buttons but no _diff_. Add a **"Compare to previous run" affordance** that appears automatically after a re-run from an edited strategy: a ghosted previous equity curve behind the new one + a delta on each of the 6 stat cards (+0.3 Sharpe, −4% MaxDD). This is the loop that creates the "I can't put this down" feeling and it's nearly free given you already store recent runs. The education doc's "change one thing" loop must be a _results-screen_ feature, not just onboarding copy.

**Priority 5 — Make "Schedule" honest or cut it from v1.** Against a fixed historical dataset, "schedule a backtest" is conceptually undefined and will confuse. Either (a) cut it from the nudge/nav for v1 (recommended), or (b) explicitly redefine it as **"alert me when the dataset extends"** / **"re-run weekly as new data lands and email me the drift."** Right now it's a gate and a promise with no screen behind it — that erodes trust.

**Priority 6 — Solve the empty Explore/Templates galleries for day one.** A public gallery of community runs is empty at launch. **Seed Explore with ~12 curated, labeled "house" backtests** (the same ones powering templates), clearly marked as official examples, so the gallery is rich on day one and the social-proof flywheel has a starting point. Design the _true_ empty state too, but never ship a flagship route that's blank.

**Priority 7 — The verdict headline is risky as written.** Template-driven plain-English verdicts ("✓ Profitable… but a 22% drawdown would have tested you") are great UX but edge toward **advice** on an explicitly educational, no-advice product, and the templates will misfire (a +0.3% "profit" over 2 years labeled "✓ Profitable"). Add: (a) a neutral-zone template for marginal results ("Roughly break-even after costs"), (b) make the headline _descriptive_ not _evaluative_ where possible, and (c) ensure the overfitting caveat is adjacent to, not buried below, any "✓" so the green check never reads as endorsement.

**Priority 8 — Cancel/abort ergonomics and the cost of a wrong run.** The plan confirms cancel only if >50% done. But the more common case is the user realizes _mid-run_ they picked the wrong strike. Give the running modal an **"Edit & re-run"** path (cancel + return to builder with state intact) as a first-class button, not just "Cancel" (which reads as "lose everything"). Also: define what happens to a **backgrounded run when the user navigates to a _different universe_** (community/journal) — does the pill follow, or is the worker abandoned? The spec scopes the provider to the backtesting layout only, which means leaving the area kills the run silently. That's a data-loss surprise.

**Priority 9 — Coverage chip overload risk.** Coverage is the moat, but the plan shows it at _six_ simultaneous touchpoints (top-bar chip + setup panel + every rung + served banner + results chips + share card + email). At 4–6 legs with per-rung percentages, Step 2 becomes a wall of "cov 96 / cov 94 / cov 58…" — the exact "wall of fields" you're beating AlgoTest on. **Establish a coverage _quiet-by-default, loud-on-problem_ rule:** show per-rung % only on the _focused_ leg or only when a rung is below threshold; collapse the rest to a single calm green tick. Honesty shouldn't become noise.

**Priority 10 — Accessibility gaps in the signature interactions.** The strike ladder (drag/swipe), the live counters (rolling numbers), and the payoff chart are all hard for screen-reader and keyboard users. The plan has keyboard shortcuts but no **ARIA live-region** for the running counters/ETA (a blind user gets a silent spinner), no described-value story for the strike ladder rungs (each rung needs an accessible name: "22,500 CE, ATM, premium ₹142, 96% coverage, selected"), and no text alternative for the equity/payoff charts (a visually-hidden data summary or a toggle to a table). For a product whose moat is _honesty/legibility_, the charts being opaque to AT is an ironic gap. Also confirm the diverging heatmap colors pass the `[data-pl="cb"]` color-blind remap — red/green P&L heatmaps are the #1 CB failure.

**Priority 11 — The 6-stat strip order leads with a ratio nobody anchors on emotionally.** Net P&L first is right. But Return/Max-DD at #2 over Win% is a quant's choice; retail Indian options sellers anchor hard on **Win% and per-day P&L** emotionally first, then learn to respect drawdown. Consider Net P&L → Win% → Max DD → Return/DD → Expectancy → Sharpe, _or_ make the strip's emphasis adaptive (the verdict already knows if DD is the story). Minor, but it's the first thing every user reads.

**Priority 12 — Login-nudge fatigue and the anonymous share dead-end.** The "ephemeral in-session share link" is honest but a genuinely bad share experience — a user shares a link in a WhatsApp group, recipients get nothing (it died with the tab). That's worse than no share button because it burns the sharer's credibility. **Make anonymous share write a real, public, immutable run server-side** (anonymous runs are already $0 to _compute_; persisting a small result blob is cheap and is your viral loop) — then nudge login only to _claim/manage/delete_ it. Gating the viral mechanic behind login fights your own growth.

**Priority 13 — Templates need outcome previews, not just payoff shapes.** The template gallery shows payoff sparklines and "2 legs · sell." The thing a user actually wants to know is **"does this make money?"** Show each template tile with a tiny _historical_ result chip (e.g., "NIFTY 3mo: +₹X, 58% win, on default settings") computed from a cached house run. This turns the gallery from a shape-picker into a results-browser and dramatically shortens time-to-value.

**Priority 14 — Define the "Edit all" power mode as v2, ship the wizard alone for v1.** Cut the parallel dense layout from launch scope. Two synchronized layouts double QA surface for an unvalidated product. Ship the wizard + ⌘K + keyboard shortcuts (which _already_ serve power users) and add "Edit all" only after you've watched real experts hit the wizard's ceiling. Re-allocate that effort to Priority 1 (warm-start) and Priority 4 (iteration diff), which move the core metric more.

**Priority 15 — Add a "trust the number" drill path on every headline stat.** The moat is "read the code," but no user reads the code. The accessible version: make each of the 6 verdict stat cards (and the charges chip) **tap-to-reveal its derivation** — "Net P&L = gross ₹X − charges ₹Y (Zerodha) − modelled slippage ₹Z." This is the _experiential_ proof of the open-source/honesty claim, costs little (you already compute the components), and is the single best counter to "these backtest tools lie" skepticism — far more persuasive than a GitHub link.

---

### Two cross-cutting cautions

- **Motion budget vs. mobile reality:** rolling NumberFlow counters + path-draw equity reveal + staggered chip springs + a live MTM sparkline ticking + a progress bar easing — all at once on a mid-range Android during an active WASM compute — will jank. Specify a **degrade-on-low-power** path (not just `prefers-reduced-motion`): if `navigator.hardwareConcurrency` is low or the run is actively computing, drop counters to snap and skip the sparkline so the _compute_ stays smooth. The animation should never compete with the work it's animating.
- **Determinism honesty:** results are sold as "computed, never asserted," but two runs of the _same_ strategy can differ if HF coverage/nearest-strike resolution changes or floating order varies. State a determinism guarantee (same config + same data snapshot = byte-identical result, and surface the data-snapshot/engine version on the result) so "re-run" never silently disagrees with a shared link.

**Strongest parts to protect:** the login-nudge-at-results rule, the verdict→evidence→drill-down hierarchy, coverage-as-first-class (just quiet it down per #9), the worker-survives-modal-close provider pattern, and the honest amber `empty:no-coverage` one-tap-fix. Don't let any refactor weaken those four.

Source docs reviewed: `C:\Users\raash\Desktop\trading-journal\docs\backtesting\01-ux-builder.md`, `C:\Users\raash\Desktop\trading-journal\docs\backtesting\02-ux-results-and-run.md` (and the 03 visual/education doc summary in context).

## Engineering critique

This confirms a concrete gap: `notify()` has a **closed `type` union** (`"like" | "comment" | ... | "reshare"`) and a fixed `notifications` schema with `postId`/`commentId` only. The architecture doc claims notifications "reuse the existing `notifications` table with two new `type` values — `backtest_done`, `backtest_failed`. No new notification table" and the data-layer doc references a `backtest_id` ALTER. These require an actual schema/type change, not pure reuse, and the two docs disagree on the mechanism. Also confirmed: the local adapter is **IndexedDB-only via sql.js** — it does not use OPFS at all, so the data-layer's claim that the OPFS cache "mirrors the local.ts pattern" overstates the reuse (OPFS is greenfield).

I have verified all load-bearing claims. Here is my principal-engineer critique.

---

# Principal-engineer review — TradeMarkk Backtesting spec set (`docs/backtesting/`)

Verdict: the spec set is unusually strong on UX and codebase grounding — every reuse target I checked (`computeCharges`, `payoff.ts`, `runSimulation`, `rateLimit`, `isAllowedOrigin`, `notify`, the NAV array, the CSP) exists exactly as cited. The vision is coherent and the client-side-default security argument is genuinely sound. But the docs significantly **understate three categories of risk**: (1) the patchy-options-data problem is treated as a UX/honesty problem when it is also a _correctness/methodology_ problem; (2) client-side Pyodide + duckdb-wasm performance over years of 1-min bars is asserted, never modeled, and the stated budgets are likely optimistic by 5-50x; (3) several "pure reuse" claims are actually "reuse + non-trivial modification." Below: concrete risks, gaps, then the decisions to lock before building.

## A. Top technical-feasibility risks

**A1. COEP `require-corp` vs cross-origin HuggingFace reads — potential showstopper for the default path.** `08-architecture.md §10` proposes scoping `Cross-Origin-Embedder-Policy: require-corp` to `/backtest`. The entire $0 model depends on duckdb-wasm range-reading parquet from `huggingface.co`. Under `require-corp`, _every_ cross-origin subresource must send `Cross-Origin-Resource-Policy: cross-origin` (or pass CORS with credentials handling). If HF's CDN does not send a compatible CORP/CORS header on `resolve/main` range responses, **all data fetches fail** and the default path is dead. The doc never verifies HF's actual response headers, and never establishes that COEP is even _needed_ — Pyodide and duckdb-wasm run fine without SharedArrayBuffer (single-threaded). This is the highest-severity unverified assumption in the set. Decision: confirm whether COEP is required at all; if it is, confirm HF headers with a real range request before committing.

**A2. Client-side performance is asserted, not modeled — the `<2 MB` / 30s budgets look optimistic.** The `<2 MB cold backtest` and `30s watchdog` numbers (`07 §6/§10`, `04 §8.2`) have no supporting math. A realistic reality check the docs owe:

- One expiry parquet holds the _whole chain_ (all strikes × CE/PE × all trading days for that expiry). Even with ZSTD + row-group pruning, a single-strike-day range read still pays footer + row-group granularity; "a few hundred KB" per leg (`07 §4b`) is plausible _only if_ the mandated row-group sort (`07 §1`) is actually applied in the ETL — and the ETL is out of scope of every doc. If the parquet is not pre-sorted by `(trading_day, strike, …)`, pruning collapses and reads balloon. **The single biggest performance lever lives in an ETL the spec doesn't own.**
- Pyodide cold start is "2–3s" in the wireframes; on a mid-range Android it is routinely 5-10s+ for the runtime alone, before duckdb-wasm (another multi-MB WASM blob) and wheels. The "30s covers a multi-month 1m backtest" claim (`04 §8.2`) is unmodeled and likely false for anything beyond a narrow single-leg slice once you add the arrow→`list[dict]`→pandas copy the spec itself flags as the bottleneck.
- The data-layer mandates "all aggregation in DuckDB SQL," but the no-code _engine_ (`08 §1`, `lib/backtest/engine/simulate.ts`) is a per-minute bar-replay state machine in TS — that's an inherently row-by-row loop over potentially 375 bars/day × hundreds of days × N legs. That's fine in TS, but it contradicts the "never loop, always SQL" thesis and needs its own perf budget.

Decision: build a throwaway perf spike (real HF parquet, real duckdb-wasm, mid-range Android) and _measure_ cold-start, transfer bytes, and wall-clock for the canonical "9:20 straddle, 3 months, 1m" case **before** committing the 30s/2MB numbers to the contract.

**A3. The missing `06-engine-semantics.md`.** The context block describes a fully-specified deterministic bar-replay engine (mark-to-market, fill model, square-off, re-entry state machine, expiry boundaries) — but **the file does not exist on disk** (only `00,01,02,03,04,05,07,08,09` are present). The engine is the correctness core of the entire product; its semantics doc is currently a phantom. Either it was never written or it was lost. This is a hard gap: §A4-A6 below are exactly the things that doc was supposed to pin down, and right now they are unspecified.

## B. Patchy-data risk — under-treated as correctness, over-treated as UX

The honesty UX (coverage chips, nearest-strike resolution, confidence score) is excellent and is a real differentiator. But three _methodological_ problems hide underneath it:

**B1. Nearest-strike substitution silently changes the strategy's risk profile.** `resolveStrike` (`07 §7b`) substitutes a different strike when the requested one is missing/illiquid, then runs the backtest on the substitute. For a short straddle, swapping ATM±0 for a strike 250 pts away (NIFTY `maxSteps=5`) materially changes premium collected, delta, and P&L — yet the result is still presented as "your strategy." A coverage chip saying "1 leg used nearest strike" does not convey that the _backtested strategy is not the one the user specified_. With 40-68% of strikes missing, substitution is the common case, not the edge case. This risks producing confidently-wrong backtests — the exact sin the overview accuses incumbents of. Decision needed: when does substitution invalidate a run vs. annotate it? (e.g. hard-fail if `distancePts` exceeds a fraction of the premium, rather than always serving.)

**B2. Survivorship/selection bias toward liquid strikes.** Coverage correlates with liquidity, which correlates with moneyness and with calm vs. volatile regimes. Backtesting only the well-covered strikes systematically over-samples liquid conditions and may flatter results. No doc addresses this. The confidence score (`07 §7d`) measures _completeness_, not _bias_ — a 95%-coverage backtest can still be selection-biased. This deserves at least an explicit disclaimer and ideally a "regime coverage" view.

**B3. The "by delta" selector is a fabricated number.** `07 §5` admits there's no IV feed and delta is "approximated" via finite-difference or Black-76 on realized vol. Finite-difference Δprice/Δspot from sparse 1-min option bars will be extremely noisy; realized-vol Black-76 delta can be far from true delta. The doc says "surface 'approx delta' honestly" — good — but offering a delta selector at all may do more harm than good given the data. Decision: ship delta selection in MVP, or defer it until there's a defensible IV source?

## C. Engine-semantics correctness gaps (compounded by the missing doc)

**C1. Mark-to-market from option OHLC is itself a fill-quality problem on illiquid strikes.** The model marks legs from recorded option close (`07 §7c`). On a strike with `medVol` of 120 (the doc's own "illiquid" example), the recorded 1-min close is a near-fictional print — wide bid/ask, stale, sometimes a single trade. Backtesting fills at that price overstates realism. The fill model (the missing `06` doc / `fills.ts`) must define slippage that scales with illiquidity, not a flat `slippage.pts`. Right now slippage is a single per-strategy constant (`08 §2`, `StrategyDef.slippage.pts`) — too crude for this dataset.

**C2. Monte-Carlo reuse needs an R-denominator the engine doesn't define.** Verified: `SimInput.rSamples` requires per-trade returns _in R (risk units)_ (`simulate.ts:65-71`). The docs repeatedly say "feed per-trade P&L as R-multiples" (`02`, `04 §10.2`, `08 §3a`) but never define what 1R _is_ for an option strategy with no hard per-trade stop (e.g. a naked straddle exited at EOD). Without a principled risk denominator, the MC cone is meaningless or arbitrary. Decision: define R (per-trade SL? average loss? capital-at-risk?) — or don't reuse the R-based MC and instead bootstrap raw ₹ P&L.

**C3. `daysFromExpiry`/expiry-day semantics + NSE 2024-25 expiry-day churn.** `08 §8` correctly makes expiry rules date-aware (`changes[]`) — good, because NSE/BSE shuffled weekly expiry weekdays repeatedly in 2024-25 and BANKNIFTY weeklies were discontinued. But the calendar JSON is hand-generated (`gen-market-calendar.mjs`) and is a correctness single-point-of-failure: a wrong expiry weekday silently mis-resolves every weekly strategy. This needs golden tests against known historical expiries, not just generation.

## D. "Reuse" claims that are actually "reuse + modify"

**D1. `notify()` and the `notifications` table are not drop-in.** Verified: `notify()` has a _closed_ type union (`like|comment|reply|follow|mention|reshare`) and the row shape is `postId`/`commentId` only (`community.ts:34-54`). The architecture doc wants new types `backtest_done`/`backtest_failed` (`08 §4`), and the data-layer doc references a `backtest_id` ALTER (`02` summary). These are **schema + type-union changes**, and the two docs describe the mechanism differently (reuse `postId` as runId vs. add a column). Reconcile and budget the change.

**D2. OPFS cache does _not_ "mirror" the existing local adapter.** Verified: `src/lib/db/adapters/local.ts` is **IndexedDB + sql.js only** — no OPFS anywhere. The data-layer doc (`07 §6`) leans on "mirrors the local.ts pattern" for its 250 MB OPFS LRU store; in reality OPFS is greenfield (origin-private FS, quota, eviction, worker access are all new surface). Don't under-budget it.

**D3. `pd.read_feather(BytesIO)` without PyArrow is not a given.** `07 §4d` hands Arrow IPC bytes to Pyodide and calls `pd.read_feather`. pandas' feather/IPC reader **uses pyarrow under the hood** — which the same doc (correctly) says is unavailable in Pyodide. So the stated boundary-crossing mechanism likely doesn't work as written; the actual path is probably the columnar-dict fallback the doc mentions in passing, which is the slow copy that dominates runtime (see A2). This needs to be nailed down with a spike — it's the BYOC hot path.

## E. Phasing / consistency issues

**E1. Route name is inconsistent across the canonical docs.** `00`/`08` use `/backtest`; `04`/`07` use `/backtesting`; nav label is "Backtest" in some places, "Backtest"/"Backtesting" elsewhere. Pick one (I'd pick `/backtesting` to match the existing placeholder and the natural noun) and global-replace before anyone scaffolds routes, redirects, OG URLs, and `localStorage` keys against the wrong string.

**E2. Build order front-loads the riskiest, least-validated piece last.** `08 §12` and `04 §15` both schedule the data layer + Pyodide boundary (A1, A2, D3 — the things most likely to be infeasible as specified) _after_ models, engine, and builder UI. That's backwards for risk. The very first spike should be: COEP+HF headers, duckdb-wasm range-read transfer size, Pyodide cold start, and the arrow→pandas boundary — i.e. prove the $0 client path is real before building UI on top of it.

**E3. Server-tier security gate is named but not specified.** `04 §13` lists an "AST allowlist scan" rejecting `os/subprocess/eval/__class__.__bases__…`. AST-based Python sandboxing is famously bypassable (dunder traversal, bytecode tricks) and is explicitly _not_ a security boundary — the Firecracker microVM is. The doc mostly gets this right (deny-all egress is the real control) but should stop implying the AST scan is a meaningful gate; it's a UX/fast-fail filter, not security. Since the tier is deferred, low urgency — but don't let the framing leak into implementation.

## F. The key DECISIONS to lock before building

1. **Is COEP actually required, and does HF send COEP/CORS-compatible headers on range reads?** (A1) — gates the entire default path. Verify with a real request first.
2. **Substitution policy:** when does nearest-strike resolution _invalidate_ a run vs. annotate it? Define a hard ceiling (premium-relative, not just pts). (B1)
3. **Define "1R"** for option strategies, or replace the R-based MC reuse with raw-₹ bootstrap. (C2)
4. **Slippage model:** flat `pts` vs. liquidity-scaled. The dataset forces the latter to be credible. (C1)
5. **Resurrect or rewrite `06-engine-semantics.md`** — it's the correctness contract and it's currently missing from disk. (A3)
6. **Notifications mechanism:** extend the `type` union + decide `postId`-reuse vs. new `backtest_id` column, and make the two docs agree. (D1)
7. **Delta selector in MVP or deferred** given no IV feed. (B3)
8. **Canonical route string** (`/backtest` vs `/backtesting`) — global before scaffolding. (E1)
9. **Own the ETL/parquet write conventions** (row-group sort + stats) explicitly — the perf budgets are meaningless without them, and no doc owns this. (A2)
10. **Reorder phasing** so the data/Pyodide feasibility spike is step 0, not step 9-10. (E2)

## Quick reference — files reviewed

- Present and read: `C:\Users\raash\Desktop\trading-journal\docs\backtesting\{00,01,02,03,04,05,07,08,09}-*.md`
- **Missing on disk** (referenced in context, not found): `C:\Users\raash\Desktop\trading-journal\docs\backtesting\06-engine-semantics.md`
- Verified-correct reuse targets: `src/lib/options/payoff.ts` (PayoffLeg/legPayoffAt/strategyPayoffAt/classifyStrategy/daysToExpiry), `src/lib/charges/charges.ts` (computeCharges/computeGrossPnl/TradeForCharges — single round-trip, `direction` long/short, `orders` default 2), `src/lib/montecarlo/simulate.ts` (SimInput.rSamples **requires R-multiples**), `src/server/rate-limit.ts` (rateLimit), `src/server/origin-check.ts` (isAllowedOrigin), `src/components/shared/nav-links.tsx` (NAV array as described), `next.config.ts` (CSP `wasm-unsafe-eval`/`worker-src 'self' blob:`/`connect-src 'self' https: wss:` all present; **no COOP/COEP currently set**).
- Claims found inaccurate/overstated: `notify()` in `src/server/community.ts` has a **closed type union** + fixed schema (not drop-in for backtest types); `src/lib/db/adapters/local.ts` is **IndexedDB/sql.js only, no OPFS** (so OPFS cache is greenfield, not a "mirror").
