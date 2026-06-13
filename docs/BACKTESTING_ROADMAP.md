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
- [ ] **BT-05 worker-hook** — `backtest.worker` + `useBacktest` (clone the
      Monte-Carlo worker idiom), BacktestStatus state machine, throttled progress.
- [ ] **BT-06 builder** — no-code 5-node wizard + always-mounted live-payoff rail
      (reuses `payoff.ts`) + interactive strike ladder + mobile sheet.
- [ ] **BT-07 results** — verdict → evidence → drill-down, tap-to-derive charges,
      coverage chips everywhere, virtualized blotter → trade-quick-view modal.
- [ ] **BT-09 persistence** — `backtest_strategies` + `backtest_runs` platform
      tables, login-nudge only at save/share, anonymous-run claim flow.
- [ ] **BT-08 data-proxy** — `/api/mkt/[...path]` range-proxy + duckdb-wasm data
      layer (the HF integration seam; needs the owner-provided HF dataset).
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
  All LOCAL gates green: tsc, ext:typecheck, next lint 0-warn, build OK.
