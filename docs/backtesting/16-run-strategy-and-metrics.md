# 16 — Run-Strategy LIVE + Signal Model + Metrics

## Goal

Remove every "coming soon" from the no-code run path: runs execute the user's REAL symbol/interval/date-range against REAL HF data, support indicator-based entries/exits, and flip `locked → run` automatically. The engine, results dashboard, persist/share, and all stats are **already built + golden-tested** — going live changes the **data payload** and **adds a signal path**, never the pure engine core.

## Drop the golden clamp

`run-adapter.ts::adaptDraftForGoldenRun` currently forces every run to the golden NIFTY 2024-07-24..25 fixture. Rewrite it to pass the user's real `market` through with the `{kind:'hf'}` payload from the Phase-1 data layer. `decidePresetRun` is fed real `(symbol,day)` availability so locked presets flip to run with **zero preset-code change**; remove the `review-step.tsx` "sample window / data layer on the way" copy.

## Indicator signal model

- Add `mode:'indicator'` to `timingConfigSchema` (alongside `'fixed_time'`) with `entryConditions`/`exitConditions` as a zod-validated **IndicatorRule tree** referencing Phase-2 `INDICATOR_REGISTRY` ids.
- Engine (`replayDay`): instantiate needed **stateful** indicators once per day with **cross-day warmup**; fold only **CLOSED** bars; evaluate the rule tree on bar close; fill entry on the **NEXT bar open** (Invariants 1+2 — no look-ahead). Indicator exits slot into the fixed within-bar order (per-leg SL/target → overall MTM → trailing → re-entry).
- DataSource loads a warmup lookback buffer (`maxLookback` bars before `dateRange.start`).

## Correctness gates (must land first)

- **D2 substitution hard-fail** (Phase 1): a too-far / too-low-coverage nearest-strike becomes `MISSING_LEG`, not a silent `confidence:'low'` fill. Surface served≠requested in loss-tone.
- **Underlying-basis stops**: thread the index bar into `computeRiskLevel`/`applyPerLegRisk` **before** relaxing the two `legSchema` refinements (L140-147). Golden-test an underlying-basis SL fill in spot space (AlgoTest parity).
- **Resampler**: non-1m intervals only after the 1m→Nm resampler is live (risk stays native 1m).

## Versioning

Extend `BlotterRow`/`BookedLeg` with `entryReason`/`exitReason` + indicator snapshots; **bump `RUN_RESULT_VERSION`** with a back-compat read path so existing `/backtesting/r/[shareId]` permalinks still parse. Add a golden test that an old v1 shared run parses.

## Metrics (already built — flow real data, no rework)

`metrics.ts` (Sharpe/Sortino/Calmar/MAR/maxDD/exposure/turnover/winRate/expectancy/profitFactor), `mc-cone.ts` (MC drawdown cone, R-multiple vs raw-₹ routing, MIN_TRADES=30 gate), `robustness.ts` (bootstrap + order-shuffle + riskOfRuin + distributionHash), `walkforward.ts` (IS/OOS folds + verdict), `deflated-sharpe.ts` (surface in risk tab), `payoff.ts` (at-expiry payoff rail), `charges.ts` (computeCharges once per leg round-trip). `results-view.tsx` + evidence tabs already consume these.

## Signal-strategy additions

Per-trade entry/exit reason + indicator values at entry/exit in the blotter drill-down (`trade-quick-view`); MAE/MFE scatter + per-leg payoff in the deepest tier. The MC cone already routes hard-stop vs no-stop bases — no MC change needed.
