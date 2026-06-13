/**
 * The committed SAMPLE BACKTEST that proves the BT-05 worker runs end-to-end in
 * the browser. It feeds the real-archive golden NIFTY 2024-07-25 slice
 * (golden-nifty-2024-07.json, already committed for the engine's golden tests)
 * and a 9:20 ATM short straddle StrategyDef through `useBacktest`, exercising the
 * full status flow validating → booting → resolving-data → simulating →
 * aggregating → done and rendering the real headline stats.
 *
 * This is the minimal proof seam only — the full no-code builder is BT-06 and the
 * full results UI is BT-07. Deterministic: the engine + committed slice give the
 * same Net P&L every run (asserted in e2e-bt-run).
 */

import { loadGoldenSnapshot } from "@/lib/backtest/__fixtures__/golden-loader";
import type { FixtureSnapshot } from "@/lib/backtest/engine/adapters/fixture-source";
import type { BacktestDataPayload } from "@/lib/backtest/worker/messages";
import { makeDefaultStrategy, type StrategyDef } from "@/features/backtest/shared/strategy-def";

/** Date range of the committed golden slice (two real NIFTY trading days). */
const SAMPLE_RANGE = { start: "2024-07-24", end: "2024-07-25" } as const;

/** The sample strategy: a NIFTY 09:20 short ATM straddle over the golden window. */
export function makeSampleStrategy(): StrategyDef {
  const base = makeDefaultStrategy("sample-bt-run", "NIFTY");
  return {
    ...base,
    name: "NIFTY 9:20 short straddle (sample)",
    market: { symbol: "NIFTY", interval: "1m", dateRange: { ...SAMPLE_RANGE } },
    timing: { mode: "fixed_time", entryTime: "09:20", exitTime: "15:15" },
    legs: [
      {
        id: "ce",
        enabled: true,
        optionType: "CE",
        side: "sell",
        lots: 1,
        strike: { mode: "ATM_OFFSET", steps: 0 },
        expiry: "WEEKLY",
        squareOff: "partial",
      },
      {
        id: "pe",
        enabled: true,
        optionType: "PE",
        side: "sell",
        lots: 1,
        strike: { mode: "ATM_OFFSET", steps: 0 },
        expiry: "WEEKLY",
        squareOff: "partial",
      },
    ],
    execution: { ...base.execution, slippage: { unit: "pct", value: 0.5 } },
  };
}

/** Build the serializable data payload for the sample (the committed slice). */
export function makeSampleDataPayload(): BacktestDataPayload {
  const snapshot: FixtureSnapshot = loadGoldenSnapshot();
  return { kind: "fixture", snapshot };
}
