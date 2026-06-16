/**
 * Run adapter (BT-06 → BT-05 worker). Bridges a builder StrategyDef to a
 * runnable (strategy, dataPayload) pair for `useBacktest`.
 *
 * Until the BT-08 live data layer (duckdb-wasm over the HF range-proxy) lands,
 * the only committed data source is the golden NIFTY 2024-07-24..25 slice. So a
 * builder "Run" executes the user's ACTUAL legs/timing/risk against that real
 * two-day window: we keep every leg/timing/risk choice, but clamp the market to
 * the golden snapshot's symbol + date range so the engine has data. This is the
 * honest fixture path the plan describes; swapping in BT-08 changes only the
 * data payload `kind`, not this adapter's shape.
 *
 * Pure (no React); the Review step calls it and hands the result to the layout
 * worker runner.
 */

import { loadGoldenSnapshot } from "@/lib/backtest/__fixtures__/golden-loader";
import type { BacktestDataPayload } from "@/lib/backtest/worker/messages";
import type { FixtureSnapshot } from "@/lib/backtest/engine/adapters/fixture-source";
import type { StrategyDef } from "../shared/strategy-def";

/**
 * LIVE data payload — the builder runs the user's ACTUAL strategy (their symbol,
 * interval and date range, unchanged) against the real HuggingFace 1-minute
 * dataset via the duckdb-wasm data layer in the worker. `bandPts` optionally
 * widens the prefetched option-chain band; the worker derives a sensible default
 * from the legs when omitted. When the chosen window has no data the run resolves
 * to an honest `empty` state — never fabricated.
 */
export function builderHfPayload(bandPts?: number): BacktestDataPayload {
  return { kind: "hf", bandPts };
}

/** The committed golden slice — kept only as the no-Worker synchronous fallback. */
export function builderDataPayload(): BacktestDataPayload {
  const snapshot: FixtureSnapshot = loadGoldenSnapshot();
  return { kind: "fixture", snapshot };
}

/**
 * Adapt the builder draft to a strategy the engine can run against the golden
 * fixture: preserve the user's legs/timing/risk/execution, but force the symbol
 * + date range to the golden window so real data exists. NIFTY-only for now
 * (the golden slice is NIFTY); a non-NIFTY draft is mapped onto the NIFTY slice
 * with its leg structure intact (clearly a preview-data run, surfaced in the UI).
 */
export function adaptDraftForGoldenRun(draft: StrategyDef): StrategyDef {
  const snapshot = loadGoldenSnapshot();
  const days = snapshot.days.map((d) => d.day).sort();
  const start = days[0]!;
  const end = days[days.length - 1]!;
  return {
    ...draft,
    market: {
      ...draft.market,
      symbol: snapshot.symbol,
      interval: "1m", // the golden slice is 1-minute
      dateRange: { start, end },
    },
  };
}

/** True when the draft already targets the golden window (no clamp needed for messaging). */
export function isGoldenAligned(draft: StrategyDef): boolean {
  const snapshot = loadGoldenSnapshot();
  return draft.market.symbol === snapshot.symbol;
}
