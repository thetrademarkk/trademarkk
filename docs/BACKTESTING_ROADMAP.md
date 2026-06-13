# Backtesting platform — build roadmap

The public, anonymous-first `/backtesting` universe — a peer to `/community` and
`/blog`. Build with no code or bring your own; run 100% client-side; honest about
data coverage; login only at the moment of value. Full spec: the 13-doc set at
`origin/docs/backtesting-plan:docs/backtesting/*` and the enhanced plan in the
project memory `backtesting-plan.md`.

Canonical route string is **`/backtesting`** (D8 locked). Three instruments
only: NIFTY (lot 75), BANKNIFTY (lot 35), SENSEX (lot 20).

## Build queue

Status legend: ✅ done · ▢ pending · (accumulated, pending batch deploy) = built
locally on the `acc/backtest` lane under the deploy-conserving regime; NOT yet
merged to main.

- [x] **BT-03 calendar** ✅ (accumulated, pending batch deploy) — `src/lib/backtest/calendar/*` + `scripts/gen-market-calendar.mjs` → `public/backtest/calendar/nse-bse-calendar.json`.
      NSE/BSE holidays 2021–2027, date-aware EXPIRY_RULES (2024–25 weekly churn,
      BANKNIFTY weekly discontinuation, BSE SENSEX Fri→Tue), holiday-roll-back,
      per-index data starts. GOLDEN-tested against ≥20 known historical expiries.
- [x] **BT-02 models** ✅ (accumulated, pending batch deploy) —
      `src/features/backtest/shared/{instruments,strategy-def,run-result}.ts`.
      Versioned StrategyDef (legs 1–8, StrikeSelector ATM-offset/percent/premium/exact
      — delta deferred D7, timing, per-leg RiskTrigger, trailing, squareOff, ReEntry,
      execution→computeCharges) + self-contained RunResult (coverage-honesty layer,
      6 headline stats, quality chips, equity/monthly/trade series, blotter, perLeg,
      engineVersion + dataSnapshotId). All zod, fully unit-tested.
- [x] **BT-01 scaffold** ✅ (accumulated, pending batch deploy) — public `/backtesting`
      route + layout (clones the community layout: SiteHeader + QueryProvider + footer
      disclaimer), nav entry at index 2 (after Community), deleted the dead
      `/app/app/backtesting` placeholder + 308 redirect `/app/backtesting → /backtesting`,
      pre-baked STATIC sample result card (instant, zero WASM), localStorage `tmk.bt.*`.

### Next (not yet built)

- [x] **BT-04 engine** ✅ (accumulated, pending batch deploy) — deterministic
      1-minute bar-replay (`src/lib/backtest/engine/*`, engineVersion 1.0.0)
      against the LOCAL archive via a 6-fn `DataSource` interface (the BT-08 seam)
      with a `FixtureDataSource` + Node `local-source` adapter. IST integer
      epoch-ms, next-bar-open fills, point-in-time marks from option OHLC (never
      BS), expiry-at-LTP, SL-first tie-break, fixed within-bar order, risk at 1m,
      liquidity-scaled `fill-model`, `computeCharges` per round-trip (cent-for-cent
      vs charges.golden), NEW `metrics.ts`
      (Sharpe/Sortino/Calmar/MAR/DD-duration/exposure/turnover), `mc-cone.ts`
      reusing `runSimulation` with the D3 raw-rupee vs R-based split (MIN_TRADES 30),
      seeded mulberry32 → 100-run identical-hash determinism. 59 new tests: 10+
      hard-invariant edge tests, metrics vs hand-computed, charges cent-for-cent,
      determinism hash, MC routing, + 2 GOLDEN strategies (9:20 ATM short straddle
      & OTM strangle) on a committed REAL NIFTY 2024-07-25 archive slice.
- [x] **BT-05 worker-hook** ✅ (accumulated, pending batch deploy) —
      `backtest.worker` runs the BT-04 engine off-main-thread (clones the
      Monte-Carlo worker idiom: `new Worker(new URL(...), {type:"module"})`,
      request-id supersession, serializable `FixtureSnapshot` data payload behind
      a discriminated `data` union so the BT-08/HF source is a drop-in);
      `useBacktest` hook (cancel = terminate + respawn) owned by a
      `BacktestRunnerProvider` mounted at the backtesting LAYOUT so an in-flight
      run survives navigation; pure `BacktestStatus` machine
      (idle → validating → booting → resolving-data → simulating → aggregating →
      done, + partial/error/empty, guarded transitions); progress throttled
      ≤1/100ms. A minimal "Run sample backtest" CTA on `/backtesting/build` proves
      the worker end-to-end. +20 vitest (state-machine valid/guarded-invalid,
      message-contract round-trip, progress-throttle) + new `e2e-bt-run`
      (determinism: golden straddle Net P&L +₹1,899.29, zero console errors,
      360px clean).
- [x] **BT-06 builder** ✅ (accumulated, pending batch deploy) — no-code 5-node
      wizard (Setup · Legs · Timing · Risk · Review) with validate-on-Continue zod
      gates + zustand draft autosaved to `tmk.bt.draft.nocode`; an ALWAYS-MOUNTED
      live-payoff rail (reuses `payoff.ts` `buildPayoffCurve`/`classifyStrategy`)
      that updates as legs change (max P/L, breakevens, auto strategy name); a real
      interactive strike LADDER (`role=listbox`, keyboard-navigable, ATM ring,
      per-rung estimated premium + coverage pip, dimmed thin rungs, ATM±/Premium/
      Exact modes — Delta deferred D7); mobile sticky mini-payoff PEER bar + vaul
      bottom-sheet. Review's Run drives the BT-05 worker against the committed
      golden slice and shows the RunResult headline inline. +48 vitest + new
      `e2e-bt-builder`. New dep: `@radix-ui/react-slider`.
- [x] **BT-07 results** ✅ (accumulated, pending batch deploy) — the results UI:
      verdict → evidence → drill-down, rendered inline after Run on
      `/backtesting/build` (matches the BT-06 run flow). Tier 1 = a NEUTRAL
      template headline (D10, descriptive never evaluative) + a `QualityChipRow`
      (coverage / substituted / illiquid / excluded / sample / filled-bar fraction) + 6 `StatCards` in R24 lead order (Net P&L → Win% → Max DD → Expectancy →
      Profit Factor → Sharpe) + a `HeroEquityChart` (Recharts ComposedChart: equity
      area + underwater drawdown on a shared axis + opt-in NIFTY buy-&-hold overlay).
      TAP-TO-DERIVE: tapping Net P&L expands the honest gross → net waterfall
      (the `computeCharges` breakdown, re-derived CENT-FOR-CENT vs the engine's
      stored charges). Tier 2 = lazy Radix tabs (Returns monthly-heatmap with
      hatched no-data cells — never a faked 0; Risk drawdown-periods + the MC cone
      reusing `src/lib/montecarlo` via `mc-cone`, gated at MIN_TRADES=30; Calendar
      weekday grid + expiry-vs-non-expiry). Tier 3 = a `@tanstack/react-virtual`
      blotter (amber `*` substitute/illiquid rows + legend, CSV export) whose rows
      open a backtest trade-quick-view modal reusing the journal modal idiom. The
      iteration loop ("change one thing" → Legs) ghosts the previous run via
      per-stat deltas (zustand+localStorage `tmk.bt.prevrun`). 5 states (empty /
      running-with-skeletons / partial-low-coverage / error / done). +14 vitest
      (suite 1402 → 1416) + new `scripts/e2e-bt-results.mjs` (9/9). Reused the
      existing Recharts dep + react-virtual — NO new charting dep.
- [x] **BT-09 persistence + share** ✅ (accumulated, pending batch deploy) —
      `backtest_strategies` + `backtest_runs` platform tables (additive,
      idempotent migration), the login-nudge ONLY at save/share (building +
      running stay anonymous), the anonymous-run claim-on-login flow (held in
      IndexedDB, POSTed once on auth — never re-run), and immutable public share
      links at `/backtesting/r/[shareId]` (read-only for everyone, unguessable
      nanoid, idempotent re-share). D6: a `backtest_id` column + the
      `backtest_done` / `backtest_failed` notify types (additive). +28 vitest
      (suite 1416 → 1444) + new `scripts/e2e-bt-persistence.mjs` (13/13).
- [x] **ETL / HF-prep** ✅ (accumulated, pending batch deploy + owner HF token) —
      the D9 re-sort/normalize pipeline + the real COVERAGE MANIFEST + daily
      aggregates + dataset card + a ready (NOT executed) HF upload script, all in
      `scripts/etl/` over the LOCAL archive (read-only). `build_manifest.py` →
      the full per-`(symbol,expiry,strike,type)` `manifest.parquet` (211,286 rows
      = 91,773 captured + 119,513 absent-strike markers folded in; staged,
      gitignored) **and** a committed compact `public/backtest/manifest/coverage-summary.json`
      (~116 KB, 522 expiry rollups). `resort_normalize.py` collapses each expiry's
      hundreds of tiny per-strike files into one expiry parquet, normalizing the
      THREE timestamp dtypes (`string` / `tz=Asia/Kolkata` / `tz=+05:30`) to a
      canonical `timestamp[ns, tz=+05:30]`, sorted `(trading_day,strike,option_type,timestamp)`,
      ~1-day row groups, ZSTD, stats ON — measured on a 9-expiry sample: **~206×
      fewer files, output ≈ 40% of input bytes, single-day reads prune to ~1 of 8
      row groups (≈12% of the file)**. `build_daily_aggregates.py` = EOD daily/
      rollups. `upload_hf.py` = owner-gated `upload_large_folder` (REFUSES without
      `HF_TOKEN` + `--confirm`; never commits a token). `validate_manifest.py` =
      schema + invariant check. Plus an additive zod loader
      `src/lib/backtest/manifest/coverage-loader.ts` (+12 vitest, suite 1444 → 1456) so the engine/coverage chips can read real per-expiry numbers when
      present, falling back to the current default when absent. Coverage:
      **NIFTY ~51% · BANKNIFTY ~59% · SENSEX ~32% (worst)**. Docs:
      `docs/backtesting/DATASET_CARD.md` (frozen schema) +
      `docs/backtesting/ETL_RUNBOOK.md` (the crisp owner-ask + full run sequence).
      Upload is the ONLY blocker — owner must provide an HF org name, a
      fine-grained WRITE token scoped to ONE dataset repo, and a public+ungated
      confirmation.
- [ ] **BT-08 data-proxy** — `/api/mkt/[...path]` range-proxy + duckdb-wasm data
      layer (the HF integration seam; needs the owner-provided HF dataset + the
      ETL above uploaded).
- [ ] **BT-10..14** — presets, walk-forward+MC, compare-journal, BYOC (Pyodide),
      server leaderboard.

## Working rules (this lane)

- Deploy-conserving: accumulate locally on `acc/backtest`; NO push / PR / merge.
- Full LOCAL gates are the per-item quality bar (tsc + ext:typecheck, lint zero
  warnings, vitest + new tests, build, e2e-smoke + mobile-audit on :3600).
- No market-data/HF/LLM needed for BT-01/02/03 — all pure.
- lucide icons only (no emoji), inherit the 4 themes + semantic tokens (no raw
  hex), mobile 360px clean.

## Shipped by the lane

- 2026-06-14 — BT-01 + BT-02 + BT-03 (the backtesting foundation), accumulated on
  `acc/backtest` (deploy-conserving). 83 new vitest tests incl. the ≥20-row expiry
  golden table + holiday-roll-back.
- 2026-06-14 — BT-04 deterministic bar-replay ENGINE, accumulated (deploy-
  conserving). `src/lib/backtest/engine/*` + `metrics.ts` + `mc-cone.ts` + a
  committed real-archive golden fixture (`__fixtures__/golden-nifty-2024-07.json`,
  ~140 KB, via `scripts/gen-backtest-golden.py`). +59 vitest (suite 1275 → 1334).
- 2026-06-14 — BT-05 backtest worker + `useBacktest` hook + `BacktestStatus`
  state machine, accumulated (deploy-conserving). `src/lib/backtest/worker/*`
  (worker + message contract + progress throttle), `src/features/backtest/hooks/
use-backtest.ts`, `src/features/backtest/shared/backtest-status.ts`,
  `src/components/backtesting/backtest-runner-provider.tsx` (layout-level mount),
  and a "Run sample backtest" proof on `/backtesting/build`. +20 vitest (suite
  1334 → 1354) + new `scripts/e2e-bt-run.mjs` (4/4, determinism + zero console).
  All LOCAL gates green: tsc, ext:typecheck, next lint 0-warn, build OK.
- 2026-06-14 — BT-06 no-code BUILDER (5-node wizard + always-mounted live-payoff
  rail + interactive strike ladder), accumulated (deploy-conserving). Pure logic
  in `src/features/backtest/builder/*` (estimate-chain, payoff-rail, validation,
  templates, draft, builder-store) + UI in `src/components/backtesting/builder/*`
  (shell, stepper, live-payoff-rail, payoff-chart, strike-ladder, mobile-payoff,
  5 step panels) replacing the BT-05 placeholder on `/backtesting/build`. +48
  vitest (suite 1354 → 1402) + new `scripts/e2e-bt-builder.mjs` (7/7) + the
  retargeted `e2e-bt-run` (4/4, golden +₹1,899.29 through the builder). New dep:
  `@radix-ui/react-slider`. All LOCAL gates green: tsc, ext:typecheck, next lint
  0-warn, build (build page 67.9 kB static, worker bundled), e2e-smoke 36/36,
  mobile-audit clean incl. `/backtesting/build`.
- 2026-06-14 — BT-07 RESULTS UI (verdict → evidence → drill-down), accumulated
  (deploy-conserving). Pure layer in `src/features/backtest/results/*` (verdict
  neutral-template, stat-cards + per-stat deltas, charges-derive cent-for-cent
  gross→net waterfall, monthly-grid hatched-not-zero, calendar-buckets, equity/
  underwater series, blotter-csv, benchmark, prev-run store) + UI in
  `src/components/backtesting/results/*` (results-view orchestrator with 5 states,
  quality-chip-row, verdict-stat-strip tap-to-derive, hero-equity-chart Recharts
  ComposedChart, lazy evidence-tabs, virtualized trade-blotter, backtest
  trade-quick-view). Wired inline into the BT-06 Review step. +14 vitest (suite
  1402 → 1416) + new `scripts/e2e-bt-results.mjs` (9/9) + retargeted e2e-bt-run /
  e2e-bt-builder. Reused Recharts + `@tanstack/react-virtual` — NO new charting
  dep. All LOCAL gates green: tsc, ext:typecheck, next lint 0-warn, build (build
  page 85.1 kB static, worker + charts bundled, no SSR worker import), e2e-smoke
  36/36, mobile-audit clean.
- 2026-06-14 — BT-09 PERSISTENCE + SHARE, accumulated (deploy-conserving).
  Schema: `backtest_strategies` + `backtest_runs` (additive, idempotent migrate;
  `backtest_runs.share_id` UNIQUE) + a `notifications.backtest_id` column and the
  `backtest_done` / `backtest_failed` notify types (D6, additive — no existing
  caller breaks). Pure layer `src/features/backtest/persist/*` (serialize: the
  RunResult ↔ immutable stored-blob round-trip; share-id: 108-bit nanoid +
  validator; held-run: IndexedDB claim glue; api: shared zod contracts). Server
  module `src/server/backtest.ts` (saveRun/saveStrategy/getRunById/
  getRunByShareId/shareRun idempotent/canViewRun/deleteRun) + 4 API routes under
  `/api/backtest/*` (feedback-style guard chain) + the immutable public page
  `/backtesting/r/[shareId]` (read-only report + point-in-time disclaimer, OG
  meta). UI: a `SaveShareBar` wired into the results DoneState (login nudged ONLY
  at Save/Share via the existing SignInGate; anonymous build/run never gated) +
  an extracted `RunResultReport` shared verbatim with the share page. Account
  delete now sweeps backtest rows. +28 vitest (suite 1416 → 1444: serialize
  round-trip, share-id idempotency/unguessability, claim-not-re-run, notify-union
  additivity, + a file-backed server integration test proving save/claim/
  share-create/public-read + non-owner-cannot-mutate) + new
  `scripts/e2e-bt-persistence.mjs` (13/13: anonymous run → Save nudge → claim →
  idempotent share → no-auth read-only render + disclaimer + matching 6 stats,
  360px, cleanup sweeps only the synthetic user). All LOCAL gates green: tsc,
  ext:typecheck, next lint 0-warn, build (`/backtesting/r/[shareId]` dynamic, 4
  API routes), e2e-smoke 36/36, mobile-audit clean.
- 2026-06-14 — ETL / HF-dataset prep, accumulated (deploy-conserving; upload
  owner-gated). `scripts/etl/` (inspect_archive, build_manifest, resort_normalize,
  build_daily_aggregates, upload_hf, validate_manifest) run read-only over the
  local 3.65 GB / ~218k-file archive. Confirmed the timestamp-dtype mismatch is
  THREE physical types mixed across BOTH layers (string / tz=Asia/Kolkata /
  tz=+05:30) and `open_interest` mixed double/null — normalized to canonical
  `timestamp[ns, tz=+05:30]` (fixed IST offset; no IANA tz db needed — Windows-safe)
  - int64 OI. Full coverage manifest = 211,286 rows; committed compact summary
    `public/backtest/manifest/coverage-summary.json` (~116 KB, 522 expiry rollups);
    full `manifest.parquet` staged gitignored (~1.1 MB). Sample re-sort win: 1,856
    tiny files (65.7 MB) → 9 expiry files (26.0 MB) = 206× fewer files, 39.6% size,
    single-(day,strike) read prunes to ~1 of 8 row groups. Additive zod loader
    `src/lib/backtest/manifest/coverage-loader.ts` + 12 vitest (suite 1444 → 1456).
    Docs: `docs/backtesting/DATASET_CARD.md` + `ETL_RUNBOOK.md`. All LOCAL gates
    green: tsc, ext:typecheck, next lint 0-warn, vitest 1456, next build; python
    scripts ran successfully against the real archive; manifest schema validated.
    OWNER-ASK (only blocker): HF org name (e.g. `thetrademarkk`), a fine-grained
    WRITE token scoped to ONE dataset repo, and a public+ungated confirmation.
