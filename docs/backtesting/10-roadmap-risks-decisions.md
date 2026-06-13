# Roadmap, Risks & Open Decisions

> **Status:** governance document for the `docs/backtesting/` spec set. This is the _delivery
> contract_, not the _design contract_. It sequences the work, names what must be true at each
> gate, registers the risks that can sink the project (data coverage above all), and lists the
> decisions the founder must make **before** the relevant phase starts.
>
> **Audience:** the founder (decision-owner) and the implementation team/agents.
> **How to read this:** §1 is the phased roadmap (Phase 0..7), each phase carrying concrete
> deliverables, explicit **UX milestones**, and binary acceptance criteria. §2 is the risk
> register (RAG-rated, owner-assigned, mitigation + trigger). §3 is the numbered open-decisions
> list — **the roadmap below references decisions by number (e.g. `→ D1`); a phase cannot start
> until its referenced decisions are locked.**
>
> **Canonical anchors (verified against the repo on 2026-06-14):**
>
> - Route string is **`/backtesting`** (matches the existing placeholder `src/app/app/backtesting/page.tsx` noun, and `→ D8` resolves the `/backtest` vs `/backtesting` inconsistency in the other docs in favour of this one). Global-replace any `/backtest` route literal before scaffolding.
> - `NAV` array in `src/components/shared/nav-links.tsx` currently: `Features, Community, Pulse, Docs, Blog, FAQ`. Backtesting is a **new public-universe entry** added here (peer to `/community`).
> - CSP in `next.config.ts` today: `script-src` has `'wasm-unsafe-eval'`, `connect-src 'self' https: wss:`, `worker-src 'self' blob:`. **No COOP/COEP headers are set.**
> - `notify()` in `src/server/community.ts:32` has a **closed** `type` union (`like|comment|reply|follow|mention|reshare`) and a row shape carrying `postId`/`commentId` only — extending it is a real schema + type change, **not** drop-in reuse (`→ D6`).
> - `docs/backtesting/06-engine-semantics.md` was described in planning context but **must be confirmed present on disk** before Phase 2 (`→ D5`).

---

## Table of contents

1. [Phased delivery roadmap](#1-phased-delivery-roadmap)
   - [Phase 0 — Feasibility spike (de-risk the $0 client path)](#phase-0--feasibility-spike-de-risk-the-0-client-path)
   - [Phase 1 — Data layer, calendar & coverage manifest](#phase-1--data-layer-calendar--coverage-manifest)
   - [Phase 2 — Deterministic engine core](#phase-2--deterministic-engine-core)
   - [Phase 3 — Public universe shell + landing (UX foundation)](#phase-3--public-universe-shell--landing-ux-foundation)
   - [Phase 4 — No-code builder + live preview (the flagship)](#phase-4--no-code-builder--live-preview-the-flagship)
   - [Phase 5 — Results, run/notify loop & honesty layer](#phase-5--results-runnotify-loop--honesty-layer)
   - [Phase 6 — Accounts, save/share & async server tier](#phase-6--accounts-saveshare--async-server-tier)
   - [Phase 7 — Bring-your-own-code (Pyodide harness)](#phase-7--bring-your-own-code-pyodide-harness)
   - [Post-launch / explicitly deferred](#post-launch--explicitly-deferred-not-v1)
2. [Risk register](#2-risk-register)
3. [Open decisions for the founder](#3-open-decisions-for-the-founder)
4. [Roadmap-at-a-glance](#4-roadmap-at-a-glance)

---

## 1. Phased delivery roadmap

**Sequencing principle.** The engineering critique (`E2`) was right: the previous draft front-loaded the _least-validated_ pieces (HF range reads, COEP, Pyodide boundary) into the _last_ phase. This roadmap inverts that. **Phase 0 proves the $0 client path is physically real before a single screen is built on top of it.** Each phase ends at a gate; the gate's acceptance criteria are binary (pass/fail), and a phase may not begin until its referenced `→ D#` decisions are locked.

**Tie-breaker for every phase.** The North Star four promises from `00-overview.md` — **free, in-browser, honest, no login until the moment of value** — override any local convenience. If a deliverable would break one of them, it is wrong.

---

### Phase 0 — Feasibility spike (de-risk the $0 client path)

> **Goal:** answer "is the default client-side architecture physically achievable on a median Indian mobile, with HuggingFace as the data source, at acceptable latency and $0 server cost?" **before** committing the performance numbers in `04`/`07` to the build contract. This phase ships **throwaway** code into a `spike/` branch — none of it is production. It exists to convert assumptions into measurements.
>
> **Blocking decisions:** `→ D1` (COEP needed?), `→ D9` (own the ETL/parquet conventions). These can be _answered by_ the spike, so the spike is allowed to start before they're locked — but it **must not exit** until D1 and D9 are resolved with data.

**Deliverables**

- A bare HTML page (no Next.js, no CSP) that:
  1. Boots `duckdb-wasm` and issues a **real range read** against `hf://datasets/thetrademarkk/india-index-options-1m/index/NIFTY.parquet` for a 3-month slice — over a throttled "Fast 3G"/mid-range-Android profile.
  2. Repeats the same against a single `options/NIFTY/{EXPIRY}.parquet` for **one strike, one day** — the canonical hot path.
  3. Boots **Pyodide**, loads `duckdb-wasm` output, and crosses the Arrow→pandas boundary by the _actual_ mechanism (validate that `pd.read_feather`/`read_ipc` is **unavailable** without pyarrow, and measure the columnar-dict fallback `→ D3` risk).
- A second variant of (1)–(2) served **with** `Cross-Origin-Embedder-Policy: require-corp` to test whether HF's CDN sends a compatible `Cross-Origin-Resource-Policy`/CORS header on `resolve/main` range responses (`A1`).
- A one-page **measurement table**: cold-start ms (Pyodide, duckdb-wasm), transfer bytes per leg-day, wall-clock for the canonical _"9:20 short straddle, 3 months, 1-min"_ case, on (a) desktop wifi, (b) throttled mobile.
- A written **ETL decision** (`→ D9`): confirm or fix the parquet row-group sort `(trading_day, strike, option_type)` + column stats; if the hosted dataset is _not_ sorted, file the ETL task that re-writes it (the perf budgets are meaningless without it).

**UX milestone (perception, not pixels)**

- Establish the **honest first-run latency number** that downstream copy must respect. The landing's "build in 60 seconds" and the running-modal "warming up" copy (`→ Phase 3/5`) are written _against this measured number_, not the aspirational `<375ms`. If run #1 is 5–15s on mobile, the warm-on-intent strategy (`→ Phase 4`, Priority-1 UX fix) becomes mandatory, not optional.

**Acceptance criteria (binary — all must pass to exit Phase 0)**

- [ ] A single-strike-day option read transfers **< 2 MB** and completes **< 4 s** on the throttled mobile profile, **or** the budget in `07 §6` is revised to the measured number and propagated to all run-loop copy.
- [ ] The COEP question is **decided** (`D1`): either COEP is confirmed _not required_ (single-threaded Pyodide + duckdb-wasm, no `SharedArrayBuffer`), or HF headers are confirmed COEP-compatible by a real range request. No screen is built before this is answered.
- [ ] The Arrow→Pyodide boundary mechanism is **named and benchmarked** (`D3`) — the production BYOC path uses the proven mechanism, not the assumed `pd.read_feather`.
- [ ] The ETL/parquet conventions are **owned** (`D9`): either verified-correct on the hosted dataset, or a re-ETL task is filed and scheduled before Phase 1.
- [ ] A go/no-go memo exists. If no-go on client-side, the fallback (server-tier-first, or hosted query proxy) is chosen _here_, before any UI investment.

---

### Phase 1 — Data layer, calendar & coverage manifest

> **Goal:** the canonical, tested data-access API (`src/lib/backtest/data-access.ts`), the static market calendar (`calendar.ts` + `calendar.data.ts`), and — the **moat** — the precomputed **coverage manifest** that every honesty surface reads from. Built against the _measured_ reality from Phase 0.
>
> **Blocking decisions:** `→ D9` (ETL, locked in Phase 0), `→ D2` (substitution policy — needed because `resolveStrike` lives here).

**Deliverables**

- `data-access.ts`: the 6-function API from `07-data-layer.md` (index slice, option leg, strike-range scan, resample, ATM compute, coverage lookup) — TS, worker-safe, duckdb-wasm-backed.
- `calendar.ts` + `calendar.data.ts`: NSE/BSE holidays 2021–2027, sessions, `isTradingDay`, **date-aware** expiry resolution (the 2024–25 weekly-expiry weekday churn and BANKNIFTY-weekly discontinuation are encoded as `changes[]`). Generated by `gen-market-calendar.mjs`.
- **Coverage manifest**: a precomputed, cacheable artifact (per symbol × expiry × strike: %-covered, median volume, gap flags). This is generated offline from the dataset and shipped/cached, **not** computed live per run. It powers the coverage chip, the served-strike banner, and the coverage explorer.
- `resolve-strike.ts`: offset / premium / delta → an **available** strike, honouring the substitution policy from `→ D2` (annotate vs. hard-fail ceiling).
- Two-layer cache (in-memory + OPFS LRU). **Note:** OPFS is **greenfield**, not a "mirror" of `src/lib/db/adapters/local.ts` (which is IndexedDB + sql.js only) — budget it as new surface (`D2` engineering note in critique).

**UX milestone**

- The **coverage primitive** ships as a standalone, Storybook-able component fed by the manifest, with its three states designed and built: calm green tick (≥ threshold), amber "nearest-strike served" chip, red "no coverage — try a nearer strike" empty state. Establish the **quiet-by-default, loud-on-problem** rule here (UX Priority 9) so coverage never becomes the "wall of fields" we're beating AlgoTest on.

**Acceptance criteria**

- [ ] Golden tests for the calendar pass against ≥ 20 known historical expiries (incl. 2024–25 weekday changes) — a wrong expiry weekday is a silent correctness bug (`C3`).
- [ ] `resolveStrike` has unit tests covering: exact hit, nearest-available substitution within ceiling, and **hard-fail beyond ceiling** (`D2`).
- [ ] The coverage manifest renders the three honesty states from real data, including a genuinely-missing SENSEX strike (worst-case ~40% coverage).
- [ ] Data API is callable from a Web Worker with the CSP from `next.config.ts` unchanged (or with the COEP decision from `D1` applied).

---

### Phase 2 — Deterministic engine core

> **Goal:** the pure, deterministic bar-replay engine (`src/lib/backtest/engine.ts` + worker) that the no-code builder feeds. Correctness core of the entire product. Imports — never modifies — `computeCharges`, `legPayoffAt`, `runSimulation`.
>
> **Blocking decisions:** `→ D5` (resurrect/confirm `06-engine-semantics.md`), `→ D4` (slippage model), `→ D2` (substitution invalidation), `→ D7` (delta selector in/out of MVP — gates whether `resolve-strike`'s delta path is exercised here).

**Deliverables**

- `engine.ts`: 1-minute bar-replay state machine in IST — entry/exit, per-leg + overall-MTM risk, re-entry, square-off, expiry & trading-day boundaries — per `06-engine-semantics.md`.
- `fill-model.ts`: **liquidity-scaled** slippage (`→ D4`) — not a flat per-strategy `pts` constant — because marking illiquid strikes from their recorded 1-min close is itself a fill-quality problem (`C1`).
- `metrics.ts`: equity curve, drawdown, win%, expectancy, Return/MaxDD, and the **R-multiple definition** for the Monte-Carlo cone (`→ D3`/`C2` — define 1R, or replace R-based MC with raw-₹ bootstrap).
- `engine.worker.ts`: mirrors `montecarlo.worker.ts` request/response contract.
- A **determinism guarantee**: same config + same data-snapshot + same engineVersion = byte-identical result. Surface `engineVersion` + data-snapshot id on every result (cross-cutting caution from the UX critique).

**UX milestone**

- A **headless "trust-the-number" trace**: the engine emits, per result, the derivation breakdown (gross ₹ − charges ₹ − modelled slippage ₹) that the results screen's tap-to-reveal (UX Priority 15) will render. Build the data now so the UI can be honest later.

**Acceptance criteria**

- [ ] Engine is deterministic: 100 repeated runs of a fixed config produce identical output hashes.
- [ ] Golden-trade tests: ≥ 5 hand-verified strategies (incl. a short straddle, an iron condor, a single naked leg) match expected P&L within charges tolerance.
- [ ] Nearest-strike substitution is **annotated in the result object** (which leg, requested vs. served strike, distance) and obeys the `D2` invalidation ceiling — a substituted run is never silently "your strategy" (`B1`).
- [ ] Slippage scales with the leg's coverage/liquidity from the manifest (`D4`).
- [ ] The MC cone consumes a **defined** R denominator (`D3`/`C2`); if undefined, MC is disabled rather than fed a meaningless number.

---

### Phase 3 — Public universe shell + landing (UX foundation)

> **Goal:** the standalone `/backtesting` public universe — header entry, routes, SEO/OG, and the **landing with a fully-static, pre-baked sample result** that costs $0 and boots no engine. This is the first user-visible surface.
>
> **Blocking decisions:** `→ D8` (canonical route string — must be locked before scaffolding routes/redirects/OG/localStorage keys).

**Deliverables**

- `NAV` entry added in `src/components/shared/nav-links.tsx` (peer to `/community`), plus `nav-links` active-state handling for `/backtesting/*`.
- Route tree under `src/app/backtesting/` (public): landing, mode-choice, `/build`, `/explore`, `/learn`, result deep-link `/r/[id]`. Redirect the old placeholder `src/app/app/backtesting/page.tsx` → `/backtesting`.
- **Pre-baked landing sample**: the only thing a first-time visitor sees "compute" hydrates from a cached JSON blob — **never** triggers a live engine boot (UX Priority 1).
- SEO/OG: per-universe metadata, shareable OG image for the sample.

**UX milestone**

- Landing achieves the **"arrival" feel honestly**: instant static sample; "Open this run" hydrates from cache; the "Build a strategy" CTA **begins warm-on-intent** (idle-callback Pyodide/duckdb-wasm preload + coverage-manifest prefetch) so that by the time Phase 4 ships the builder, run #1 is warm (UX Priority 1).
- Accessibility baseline set for the universe: charts ship with a visually-hidden data-summary / table toggle; the `[data-pl="cb"]` color-blind remap is verified on any P&L color (UX Priority 10).

**Acceptance criteria**

- [ ] Lighthouse: landing is fully interactive with **zero** engine/WASM boot on first paint; sample result renders from static data.
- [ ] Route string is consistent everywhere (`D8`) — no `/backtest` literals remain.
- [ ] The universe is reachable from the marketing header on desktop and mobile; signed-out and signed-in chrome both correct.
- [ ] Warm-on-intent prefetch fires on CTA intent and is cancellable/idempotent; it never blocks paint.

---

### Phase 4 — No-code builder + live preview (the flagship)

> **Goal:** the persistent two-pane builder (stepper + always-on live payoff rail) for desktop, and a **first-class** mobile builder with a **live mini-payoff in the sticky bar** (not gated behind a tap). This is the product's soul.
>
> **Blocking decisions:** `→ D7` (delta selector), `→ D11` ("Edit all" power mode in v1 or v2), `→ D2` (substitution UX in the strike ladder).

**Deliverables**

- The builder shell, stepper (Setup → Legs → Timing → Risk → Review & Run), and the strategy store wired to the engine worker.
- **Strike ladder as a real interaction** (UX Priority 3): defined rung count (≈7 visible, ATM-centered, virtualized), desktop horizontal scroll that never hijacks page scroll, a "± offset" numeric jump, and a **kind tap on a dimmed rung** — popover offering the covered neighbour, never a silent no-op.
- Live preview rail (desktop) using `payoff.ts` (`legPayoffAt`/`buildPayoffCurve`/`classifyStrategy`), updating on every change.
- **Mobile: persistent collapsed mini-payoff** (40px sparkline + Max P / Max L / POP) that updates live in the sticky bottom bar (UX Priority 2). Full sheet is for inspection only.
- ⌘K power flow + keyboard shortcuts (these _are_ the power-user surface — see `D11`).
- `degrade-on-low-power` path: if `navigator.hardwareConcurrency` is low or a compute is active, drop rolling counters to snap and skip the live sparkline so compute stays smooth (UX cross-cutting caution).

**UX milestone**

- The **iteration loop is designed in from the start** (UX Priority 4): the builder retains the previous run so that after an edit-and-re-run, the results screen (Phase 5) can show a ghosted previous curve + per-stat deltas. This is the "can't put it down" loop.
- The **warm-start payoff** from Phase 3 is realized: pressing Run on a 3-month NIFTY straddle finds the runtime warm and the first slice cached.

**Acceptance criteria**

- [ ] On mobile, changing any leg updates the sticky mini-payoff **without a tap** (UX Priority 2 verified on a real mid-range Android).
- [ ] The strike ladder handles a 4-leg iron condor: each leg's strike is selectable with an overview (the right rail _is_ the multi-leg overview; per-leg "connecting line to the kink" is dropped beyond 2 legs — UX Priority 3).
- [ ] Tapping a low-coverage rung shows the neighbour popover (`Use 22,700 (88%) / Use anyway`), never a no-op.
- [ ] Coverage chips obey quiet-by-default (per-rung % only on the focused leg or below-threshold rungs) — Step 2 is not a wall of percentages (UX Priority 9).
- [ ] The builder runs a full strategy end-to-end against the engine worker and the live preview matches the engine's leg marks.
- [ ] `D11` resolved: if "Edit all" is deferred, the wizard + ⌘K alone serve power users for v1.

---

### Phase 5 — Results, run/notify loop & honesty layer

> **Goal:** the beautiful, honest results report (verdict → evidence → drill-down), the polished run state machine (modal → mini-pill → toast), and the honesty layer (coverage chips, derivation tap-reveal, overfitting coaching).
>
> **Blocking decisions:** `→ D10` (verdict-headline tone — descriptive vs. evaluative), `→ D12` (anonymous share = real persisted public run vs. ephemeral).

**Deliverables**

- Results screen: the 6-stat strip, equity curve (with the **ghosted previous-run overlay + per-stat deltas** from Phase 4's iteration loop), payoff, trade table, Monte-Carlo cone (if `D3` R is defined).
- **Trust-the-number drill** (UX Priority 15): each stat card + the charges chip tap-to-reveal its derivation ("Net = gross ₹X − charges ₹Y (Zerodha) − slippage ₹Z") from the Phase-2 trace.
- Run state machine: running modal with **honest first-run copy** ("Warming up — first run is the slowest", per Phase 0's measured number), mini-pill, completion toast, error & empty states.
- **Edit-&-re-run** as a first-class button in the running modal (cancel + return to builder with state intact), not just "Cancel" (UX Priority 8).
- Verdict headlines with a **neutral-zone template** for marginal results ("Roughly break-even after costs") and the overfitting caveat **adjacent** to any "✓" so a green check never reads as endorsement (UX Priority 7, `D10`).
- Honest degraded/empty states: `empty:no-coverage` with one-tap fix; low-coverage banner; selection-bias disclaimer (`B2`).

**UX milestone**

- The **verdict → evidence → drill-down** hierarchy is fully realized and the result carries `engineVersion` + data-snapshot id so a shared/re-run result never silently disagrees (determinism honesty).
- ARIA live-region announces running counters/ETA; equity & payoff charts have a text-alternative table toggle (UX Priority 10).

**Acceptance criteria**

- [ ] Every headline stat is tap-to-derive; the charges chip shows the active broker profile and the exact `computeCharges` components (UX Priority 15).
- [ ] A marginal (+0.3% over 2y) result renders the **neutral** verdict, never "✓ Profitable" (UX Priority 7).
- [ ] A re-run after an edit shows the ghosted previous curve + deltas (UX Priority 4).
- [ ] Backgrounded run behaviour is defined and implemented (`→ D8`-adjacent / UX Priority 8): leaving the backtesting universe either carries the pill or warns before abandoning the worker — no silent data-loss surprise.
- [ ] Result is fully usable, shareable (per `D12`), and savable-gated **only at this moment** (login nudge appears here, never earlier).

---

### Phase 6 — Accounts, save/share & async server tier

> **Goal:** the login-nudge-at-results flow, saved strategies/runs, real shareable public runs, notifications, and the **optional** long-run server tier (inline ≤ 300s + `after()` + email + in-app notification + polling; QStash only if a run could exceed 300s).
>
> **Blocking decisions:** `→ D6` (notifications mechanism — extend `notify()` union + `postId`-reuse vs. new `backtest_id` column), `→ D12` (anonymous share persistence), `→ D13` (server tier in v1 or deferred).

**Deliverables**

- Two platform-DB tables (`backtest_strategies`, `backtest_runs`) + migration (`platform-schema.ts` / `migrate-platform.ts`).
- Auth claim flow: anonymous run → "save/share/notify" nudge → better-auth sign-in → claim the run.
- **Notifications**: extend `notify()`'s closed `type` union with `backtest_done`/`backtest_failed` **and** decide the join key (`→ D6`: reuse `postId` as run id vs. add a `backtest_id` column + `ALTER`). Reconcile the two docs that currently disagree.
- Resend email for completed/failed server runs; in-app bell entries.
- Server tier (`→ D13`, may be deferred): Next.js route + `after()` for ≤ 300s; rate-limited via `src/server/rate-limit.ts`; **security framing corrected** — the AST allowlist is a UX/fast-fail filter, **not** a security boundary; the deny-all-egress microVM is the real control (`E3`).

**UX milestone**

- Login nudge is **single-touchpoint, fatigue-free**: it appears only at save/share/schedule/notify, never mid-build (`00` North Star promise #4). The anonymous share (`D12`) produces a link that actually works for a WhatsApp recipient (UX Priority 12) — gating the viral mechanic behind login fights our own growth.

**Acceptance criteria**

- [ ] Anonymous → claim flow loses no strategy/run state across sign-in.
- [ ] `backtest_done`/`backtest_failed` notifications render in the existing bell with a deep link to the result; the schema change (`D6`) is migrated and the two docs reconciled.
- [ ] If server tier ships: a run is rate-limited, runs in deny-all-egress isolation, emails on completion, and never claims AST scanning as security.
- [ ] A shared anonymous link opens the exact result (with snapshot/engineVersion) on a fresh device with no account (`D12`).

---

### Phase 7 — Bring-your-own-code (Pyodide harness)

> **Goal:** the in-browser Python harness — code editor, Pyodide + duckdb-wasm execution, and the user-facing `ctx` data API — proven feasible in Phase 0.
>
> **Blocking decisions:** `→ D3` (Arrow→pandas boundary, proven in Phase 0), `→ D13` (server tier framing for heavy BYOC runs).

**Deliverables**

- Code editor UX with the data-discoverability on-ramp (how to import data + specify index/date range — the highest-leverage BYOC gap from `09`).
- Pyodide Web Worker harness using the **proven** boundary mechanism from Phase 0 (`D3`), not the assumed `pd.read_feather`.
- Starter templates + the `ctx` API (data slices via duckdb-wasm from HF).
- Honest first-run copy (cold-start is multi-second; say so).
- Optional server run path reuses the Phase 6 tier with the corrected security framing.

**UX milestone**

- BYOC first-run guidance is reassuring and concrete; the run loop and error surfacing match the no-code polish bar.

**Acceptance criteria**

- [ ] A user can paste a starter strategy, run it entirely client-side against real HF data, and see a result with the same honesty/coverage surfaces as no-code.
- [ ] The Arrow→Pyodide boundary uses the benchmarked mechanism and meets the Phase-0 latency budget.
- [ ] Security framing in UI/docs is correct (AST = fast-fail filter, not a boundary).

---

### Post-launch / explicitly deferred (NOT v1)

These are named in the spec set but **cut from v1 scope** to protect the launch and re-allocate effort to Priority-1 (warm-start) and Priority-4 (iteration diff):

- **"Edit all" power mode** (`D11`) — a parallel dense layout doubles QA surface for an unvalidated product; ship the wizard + ⌘K alone and add this only after watching real experts hit the wizard ceiling (UX Priority 14).
- **Schedule** (`D14`) — against a fixed historical dataset, "schedule a backtest" is conceptually undefined. **Cut from the nudge/nav for v1**, or redefine honestly as "alert me when the dataset extends / re-run weekly as new data lands" before it can ship (UX Priority 5).
- **Compare screen (S8)** as a standalone multi-column route — the _inline_ iteration diff (Phase 4/5) delivers most of the value; the dedicated multi-strategy compare route is deferred until the diff proves demand (and its mobile story is designed — 4 columns on a phone is unsolved).
- **Delta strike selector** (`D7`) — if the spike shows finite-difference/realized-vol delta is too noisy on sparse 1-min bars, defer until a defensible IV source exists (`B3`).
- **Paid server tier at scale / QStash** (`D13`) — inline `after()` ≤ 300s covers v1; QStash only when a real run exceeds 300s.

---

## 2. Risk register

RAG = current residual severity after planned mitigation. **Owner** is the role accountable for the gate. **Trigger** is the observable that flips the risk live.

### 🔴 Critical — can sink the project

| #   | Risk                                                                                                                                                                                                                 | Why it's critical                                                                                                                                                          | Mitigation                                                                                                                                                                                                                  | Trigger / early warning                                                                                      | Owner       | Phase |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------- | ----- |
| R1  | **Patchy options coverage is a _correctness_ problem, not just UX.** 40–68% of strikes missing (worst: SENSEX). Nearest-strike substitution silently changes the backtested strategy's risk profile (`B1`).          | This is the exact sin (`00`) we accuse incumbents of: a confidently-wrong curve built on substituted data. With most strikes missing, substitution is the **common** case. | `→ D2`: define a **premium-relative substitution ceiling** — annotate within ceiling, **hard-fail** beyond it. Annotate every substitution in the result (requested vs served, distance). Selection-bias disclaimer (`B2`). | Any leg's served strike is > X% of premium away from requested; SENSEX runs frequently hit hard-fail.        | Engine/Data | 1–2   |
| R2  | **COEP `require-corp` vs cross-origin HF reads** could kill the default $0 path if HF's CDN lacks compatible CORP/CORS headers (`A1`).                                                                               | The entire free/in-browser promise depends on duckdb-wasm range-reading HF parquet. If COEP is required _and_ HF headers are incompatible, **all data fetches fail**.      | Phase 0 spike: first establish whether COEP is even **needed** (Pyodide + duckdb-wasm are single-threaded; no `SharedArrayBuffer`), then verify HF headers with a real range read. `→ D1`.                                  | Phase 0 measurement shows fetch failure under `require-corp`, or a future feature needs `SharedArrayBuffer`. | Eng/Founder | 0     |
| R3  | **Client-side performance is asserted, never modeled.** `<2 MB`/`30s` budgets likely optimistic 5–50× on mid-range mobile (`A2`). The single biggest lever (parquet row-group sort) lives in an **ETL no doc owns**. | If run #1 is 15s+ on mobile, the funnel dies at first run regardless of UI polish.                                                                                         | Phase 0 measures the canonical case on real mobile; `→ D9` owns the ETL/row-group sort; warm-on-intent (Phase 3/4) hides cold start; copy is written against the _measured_ number.                                         | Phase 0 wall-clock exceeds the revised budget; HF parquet is found unsorted.                                 | Eng         | 0–1   |

### 🟠 High — material rework or a broken promise if unmanaged

| #   | Risk                                                                                                                                                                                  | Why                                                                                                                 | Mitigation                                                                                                                                | Trigger                                                          | Owner       | Phase |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------- | ----- |
| R4  | **`06-engine-semantics.md` may be missing on disk** (`A3`). It's the correctness contract for mark-to-market, fills, square-off, re-entry, expiry.                                    | The engine cannot be built correctly from a phantom doc; A1-equivalent semantics gaps appear silently as wrong P&L. | `→ D5`: confirm present on disk or rewrite **before** Phase 2 starts. Phase 2 is blocked until it exists.                                 | Phase 2 kickoff finds no `06-*.md`.                              | Eng/Founder | 2     |
| R5  | **Monte-Carlo cone has no defined R denominator** (`C2`). `runSimulation` requires per-trade returns in R; option strategies often have no hard per-trade stop (EOD-exited straddle). | A meaningless/arbitrary R makes the cone misleading on an honesty-first product.                                    | `→ D3`: define 1R (per-trade SL / avg loss / capital-at-risk), **or** disable R-based MC and bootstrap raw ₹ P&L.                         | Phase 2 metrics work reaches the MC integration with no R rule.  | Eng         | 2     |
| R6  | **Flat slippage on illiquid strikes overstates realism** (`C1`). Marking from a near-fictional 1-min close on `medVol≈120` strikes.                                                   | Backtests fill at fantasy prices; the "honest" product produces dishonest fills.                                    | `→ D4`: liquidity-scaled slippage keyed off the coverage manifest's median volume, not a flat per-strategy `pts`.                         | Golden tests on illiquid strikes show implausibly good fills.    | Eng         | 2     |
| R7  | **Notifications "reuse" is actually a schema + type change** (`D1`-eng / `D6`). `notify()` union is closed; row carries only `postId`/`commentId`; two docs disagree on mechanism.    | Mis-scoped as "drop-in reuse"; ships late or breaks the existing notifications table.                               | `→ D6`: extend the union with `backtest_done`/`backtest_failed`; choose `postId`-reuse vs `backtest_id` column + `ALTER`; reconcile docs. | Phase 6 notification work finds the union/schema mismatch.       | Eng         | 6     |
| R8  | **Cold-start vs the "arrival/<375ms" promise** (`A2`/UX-theme-1). No prefetch/warm strategy was specified originally.                                                                 | Expectation set by landing copy the architecture can't meet on run #1 → bounce.                                     | Warm-on-intent (Phase 3/4); pre-baked static landing sample; honest "first run is slowest" copy.                                          | Run #1 measured > a few seconds and copy still promises instant. | UX/Eng      | 0,3,4 |

### 🟡 Medium — quality/scope risks, manageable within a phase

| #   | Risk                                                                                                                                                                                                               | Mitigation                                                                                                                               | Owner       | Phase |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----- |
| R9  | **Selection/survivorship bias toward liquid strikes** (`B2`) — coverage correlates with liquidity/moneyness/regime; a 95%-coverage backtest can still be biased. Confidence score measures completeness, not bias. | Explicit disclaimer on results; a "regime coverage" view post-launch.                                                                    | Data/UX     | 1,5   |
| R10 | **"By delta" selector is a fabricated number** (`B3`) — no IV feed; finite-difference/realized-vol delta is noisy.                                                                                                 | `→ D7`: ship with honest "approx delta" labelling, or defer until a defensible IV source.                                                | Eng/Founder | 4     |
| R11 | **Verdict headline edges into advice** (`B`/UX-7) on a no-advice educational product; templates misfire on marginal results.                                                                                       | `→ D10`: neutral-zone template; descriptive-not-evaluative copy; overfitting caveat adjacent to any "✓".                                 | UX/Founder  | 5     |
| R12 | **Coverage chip overload** (UX-9) — 6 simultaneous touchpoints become the "wall of fields" we're beating.                                                                                                          | Quiet-by-default / loud-on-problem rule established in Phase 1 and enforced in Phase 4.                                                  | UX          | 1,4   |
| R13 | **Mobile loses the live-feedback loop** (UX-2/3) in a mobile-first product.                                                                                                                                        | Persistent live mini-payoff in the sticky bar (Phase 4); mobile is a Phase-4 acceptance gate, not an afterthought.                       | UX          | 4     |
| R14 | **Empty Explore/Templates galleries on day one** (UX-6) — a public gallery with zero runs at launch.                                                                                                               | Seed Explore with ~12 curated "house" backtests (also powering templates), clearly labelled official; design the true empty state too.   | UX          | 3,4   |
| R15 | **Backgrounded run abandoned on universe-switch** (UX-8) — silent data-loss surprise.                                                                                                                              | Phase 5: carry the pill or warn before abandoning the worker.                                                                            | UX/Eng      | 5     |
| R16 | **Anonymous share dead-end** (UX-12) — ephemeral in-session link burns the sharer's credibility.                                                                                                                   | `→ D12`: persist anonymous runs as real public immutable blobs (compute is already $0; storing a small blob is cheap).                   | UX/Eng      | 5,6   |
| R17 | **Motion budget janks during active WASM compute** on mid-range Android (UX cross-cutting).                                                                                                                        | `degrade-on-low-power` path (Phase 4): drop counters to snap + skip sparkline during compute or on low `hardwareConcurrency`.            | UX/Eng      | 4     |
| R18 | **Determinism not guaranteed** — re-run of same config can differ if coverage/float order varies.                                                                                                                  | State the guarantee (same config + snapshot + engineVersion = byte-identical) and surface snapshot/engineVersion on results (Phase 2/5). | Eng         | 2,5   |

### 🟢 Low — watch items

| #   | Risk                                                                                                                             | Mitigation                                                                                          | Phase |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----- |
| R19 | **Calendar is a hand-generated single-point-of-failure** (`C3`); a wrong expiry weekday silently mis-resolves weekly strategies. | Golden tests vs known historical expiries (Phase 1 acceptance gate).                                | 1     |
| R20 | **OPFS cache under-budgeted as a "mirror"** — it's greenfield (the local adapter is IndexedDB/sql.js only).                      | Budget OPFS quota/eviction/worker-access as new surface (Phase 1).                                  | 1     |
| R21 | **Route-string inconsistency** (`E1`) `/backtest` vs `/backtesting`.                                                             | `→ D8`: lock `/backtesting`, global-replace before scaffolding (Phase 3 gate).                      | 3     |
| R22 | **AST scan mis-framed as security** (`E3`).                                                                                      | Frame as UX/fast-fail filter; microVM deny-all egress is the boundary (Phase 6/7).                  | 6,7   |
| R23 | **Educational/regulatory:** must show overfitting + "past performance" disclaimers responsibly.                                  | Proportional overfitting coaching + disclaimers baked into results (Phase 5).                       | 5     |
| R24 | **6-stat strip order** (UX-11) leads with Return/MaxDD over Win% — retail anchors on Win%/per-day P&L.                           | Consider Net P&L → Win% → Max DD → Return/DD → Expectancy → Sharpe, or adaptive emphasis (Phase 5). | 5     |

---

## 3. Open decisions for the founder

> Each decision blocks the phase noted in **Blocks**. A phase **may not start** until its decisions are locked. Decisions marked _(spike-resolvable)_ can be answered by Phase 0's measurements.

1. **D1 — Is COEP `require-corp` required at all, and do HF range reads send compatible CORP/CORS headers?** _(spike-resolvable)_
   _Recommendation:_ Default to **no COEP** (Pyodide + duckdb-wasm are single-threaded; no `SharedArrayBuffer` needed). Only adopt COEP if a future feature requires SAB, and only after verifying HF headers.
   **Blocks:** Phase 0 exit, all data fetching. **Risk:** R2.

2. **D2 — Nearest-strike substitution policy: when does substitution _invalidate_ a run vs. merely _annotate_ it?**
   _Recommendation:_ A **premium-relative ceiling** (e.g. hard-fail if the served strike's distance implies a premium delta > N% of requested premium), not a flat points cap. Always annotate; hard-fail beyond ceiling rather than silently serving.
   **Blocks:** Phase 1 (`resolveStrike`), Phase 2 (engine annotation), Phase 4 (ladder UX). **Risk:** R1.

3. **D3 — Define "1R" for the Monte-Carlo cone, or replace R-based MC with raw-₹ bootstrap. Also: the Arrow→Pyodide boundary mechanism.** _(boundary part spike-resolvable)_
   _Recommendation:_ For strategies with a hard per-trade SL, R = that SL; for EOD-exited strategies, either capital-at-risk or **bootstrap raw ₹** and skip R-based MC. Confirm the Arrow→pandas path in Phase 0 (do **not** assume `pd.read_feather`).
   **Blocks:** Phase 2 (metrics/MC), Phase 7 (BYOC hot path). **Risk:** R5.

4. **D4 — Slippage model: flat per-strategy `pts` vs. liquidity-scaled.**
   _Recommendation:_ **Liquidity-scaled**, keyed off the coverage manifest's median volume. The dataset forces this to be credible.
   **Blocks:** Phase 2 (`fill-model.ts`). **Risk:** R6.

5. **D5 — Resurrect or confirm `docs/backtesting/06-engine-semantics.md` on disk.**
   _Recommendation:_ Confirm/rewrite **before** Phase 2 kickoff; it is the correctness contract. Phase 2 is hard-blocked without it.
   **Blocks:** Phase 2. **Risk:** R4.

6. **D6 — Notifications mechanism: extend `notify()`'s closed type union and choose the join key.**
   _Recommendation:_ Add `backtest_done`/`backtest_failed` to the union; add a dedicated **`backtest_id`** column (cleaner than overloading `postId`); migrate via `platform-schema.ts`/`migrate-platform.ts`; reconcile the two docs that disagree.
   **Blocks:** Phase 6. **Risk:** R7.

7. **D7 — Ship the "by delta" strike selector in MVP, or defer?**
   _Recommendation:_ If Phase-0/Phase-2 shows finite-difference/realized-vol delta is too noisy on sparse 1-min bars, **defer** behind a clearly-labelled "approx" until a defensible IV source exists. Lean defer for v1.
   **Blocks:** Phase 4 (builder), Phase 2 (resolve-strike delta path). **Risk:** R10.

8. **D8 — Canonical route string: `/backtest` vs `/backtesting`.**
   _Recommendation:_ **`/backtesting`** (matches the existing placeholder noun and the natural English noun). Global-replace before scaffolding routes/redirects/OG/localStorage keys.
   **Blocks:** Phase 3 (scaffolding). **Risk:** R21.

9. **D9 — Who owns the ETL/parquet write conventions (row-group sort + column stats)?** _(spike-resolvable)_
   _Recommendation:_ Treat the ETL as an **owned deliverable**. Verify the hosted dataset is sorted `(trading_day, strike, option_type)` with stats; if not, schedule a re-ETL before Phase 1. The perf budgets are meaningless without this.
   **Blocks:** Phase 0 exit, Phase 1. **Risk:** R3.

10. **D10 — Verdict-headline tone: descriptive vs. evaluative.**
    _Recommendation:_ **Descriptive by default**, with a neutral-zone template for marginal results and the overfitting caveat adjacent to any "✓". Never let a green check read as endorsement on a no-advice product.
    **Blocks:** Phase 5. **Risk:** R11.

11. **D11 — "Edit all" power mode in v1, or v2?**
    _Recommendation:_ **v2.** Ship the wizard + ⌘K + keyboard shortcuts for v1; add the parallel dense layout only after watching real experts hit the wizard ceiling. Re-allocate effort to warm-start (D1/Phase 0) and the iteration diff (Phase 4/5).
    **Blocks:** Phase 4 scope. **Risk:** scope/QA.

12. **D12 — Anonymous share: ephemeral in-session link vs. real persisted public run.**
    _Recommendation:_ **Persist** anonymous runs as small immutable public blobs (compute is already $0; storage is cheap; this is the viral loop). Nudge login only to _claim/manage/delete_.
    **Blocks:** Phase 5/6. **Risk:** R16.

13. **D13 — Async server tier in v1, or deferred?**
    _Recommendation:_ Ship inline `after()` ≤ 300s + email + bell + polling for v1; **defer** QStash and the paid microVM tier until a real run exceeds 300s or demand is proven. Frame AST scanning as a fast-fail filter, never as security.
    **Blocks:** Phase 6/7 scope. **Risk:** R22.

14. **D14 — "Schedule": cut from v1, or redefine honestly?**
    _Recommendation:_ **Cut** from the v1 nudge/nav. A schedule against a fixed historical dataset is undefined. If kept later, redefine as "alert me when the dataset extends / re-run weekly as new data lands and email me the drift."
    **Blocks:** Phase 5/6 nudge + nav. **Risk:** trust erosion (UX-5).

15. **D15 — Day-one Explore/Templates seed: how many curated "house" backtests, and who curates them?**
    _Recommendation:_ Seed ~12 curated, labelled-official house runs (also powering templates, ideally with a tiny historical result chip per template — UX-13). Founder signs off on the curated set's honesty (no cherry-picked winners).
    **Blocks:** Phase 3/4 galleries. **Risk:** R14.

---

## 4. Roadmap-at-a-glance

| Phase        | Theme                                            | Gate proves                                                                    | Blocking decisions |
| ------------ | ------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------ |
| **0**        | Feasibility spike                                | The $0 client path is physically real (COEP, HF reads, Pyodide boundary, perf) | D1, D3\*, D9       |
| **1**        | Data layer + calendar + coverage manifest        | Honest, tested data access; the coverage moat                                  | D2, D9             |
| **2**        | Deterministic engine                             | Correct, deterministic, honestly-substituted P&L                               | D2, D3, D4, D5, D7 |
| **3**        | Public universe + landing                        | Instant static landing; warm-on-intent; route locked                           | D8                 |
| **4**        | No-code builder + live preview                   | Effortless build; live payoff on desktop **and** mobile                        | D7, D11, D2        |
| **5**        | Results + run/notify + honesty                   | Beautiful, honest verdict→evidence→drill-down; iteration diff                  | D10, D12           |
| **6**        | Accounts, save/share, server tier                | Login-nudge-at-value; working shares; notifications                            | D6, D12, D13       |
| **7**        | Bring-your-own-code                              | Client-side Python with the same honesty surfaces                              | D3, D13            |
| **Deferred** | Edit-all, Schedule, Compare route, delta, QStash | —                                                                              | D11, D14, D7, D13  |

> **The one rule that outranks this whole table:** if any deliverable makes a result less _free_, less _in-browser_, less _honest_, or demands _login before the moment of value_ — it is wrong, regardless of which phase it sits in.
