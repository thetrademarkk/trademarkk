/**
 * Monte-Carlo drawdown cone for a backtest RunResult — REUSES the existing
 * runSimulation (montecarlo/simulate.ts), never re-implements the bootstrap.
 *
 * D3 (the decision this module encodes): a backtest produces two flavours of
 * trade samples, and the right bootstrap unit differs:
 *   - HARD-SL strategies have a well-defined per-trade RISK, so each day's
 *     net/risk is a meaningful R-multiple → bootstrap in R units (the journal's
 *     existing path), starting at 100R.
 *   - NO-STOP straddles exited at EOD have NO defined risk per trade, so an
 *     R-multiple is fiction. For these we bootstrap RAW RUPEES (each day's net
 *     P&L is a sample) → the cone is in rupees, starting at 0.
 *
 * Either way the cone is gated at MIN_TRADES = 30 (below which it is statistically
 * meaningless and we return null so the UI shows an honest "not enough data").
 * Determinism: config.seed flows straight into runSimulation → mulberry32.
 */

import { MIN_TRADES, runSimulation, type SimResult } from "../montecarlo/simulate";
import type { RunResult } from "../../features/backtest/shared/run-result";

export type ConeBasis = "R" | "rupees";

export interface BacktestConeResult {
  basis: ConeBasis;
  /** The unit of the cone bands ("R" or "₹"). */
  sim: SimResult;
  /** Number of trade-day samples bootstrapped. */
  sampleSize: number;
}

/** True if the strategy defines a hard risk (per-leg SL or overall MTM SL/maxLoss). */
export function hasHardStop(config: RunResult["config"]): boolean {
  const legSl = config.legs.some((l) => l.enabled && l.stopLoss);
  const overallSl = !!config.risk.stopLoss || !!config.risk.maxLossRupees;
  return legSl || overallSl;
}

/**
 * Per-day risk for the R-based path: the worst-case loss a hard-SL strategy
 * could take that day. We approximate it from the leg SLs (premium-distance ×
 * qty) + the overall MTM SL, taking the binding (smaller) cap. When no usable
 * risk exists the day is dropped from the R sample.
 */
function dayRiskRupees(
  config: RunResult["config"],
  row: RunResult["blotter"][number]
): number | null {
  let legRisk = 0;
  let any = false;
  for (const bl of row.legs) {
    const leg = config.legs.find((l) => l.id === bl.legId);
    if (!leg?.stopLoss) continue;
    any = true;
    const sl = leg.stopLoss;
    const dist = sl.unit === "pct" ? bl.entryPrice * (sl.value / 100) : sl.value;
    legRisk += dist * bl.qty;
  }
  const overall =
    config.risk.stopLoss?.unit === "rupees"
      ? Math.abs(config.risk.stopLoss.value)
      : config.risk.maxLossRupees
        ? Math.abs(config.risk.maxLossRupees)
        : 0;
  if (overall > 0) {
    any = true;
    legRisk = legRisk > 0 ? Math.min(legRisk, overall) : overall;
  }
  return any && legRisk > 0 ? legRisk : null;
}

/**
 * Build the MC cone for a RunResult. Returns null when fewer than MIN_TRADES
 * samples exist. `paths`/`trades` default to a 10k×(sampleSize) bootstrap.
 */
export function monteCarloFromRun(
  result: RunResult,
  opts: { paths?: number; trades?: number } = {}
): BacktestConeResult | null {
  const seed = result.config.execution.seed;
  const paths = opts.paths ?? 10_000;
  const hardStop = hasHardStop(result.config);

  if (hardStop) {
    // R-based path: net / day-risk per trade.
    const rSamples: number[] = [];
    for (const row of result.blotter) {
      if (row.legs.length === 0) continue; // skipped day
      const risk = dayRiskRupees(result.config, row);
      if (risk === null) continue;
      rSamples.push(row.net / risk);
    }
    if (rSamples.length < MIN_TRADES) return null;
    const sim = runSimulation({
      rSamples,
      trades: opts.trades ?? rSamples.length,
      paths,
      startEquityR: 100,
      ruinFloorFraction: 0.5,
      seed,
    });
    return { basis: "R", sim, sampleSize: rSamples.length };
  }

  // RAW-RUPEE path (D3): each day's net P&L is a sample, cone in rupees from 0.
  const rupeeSamples = result.blotter.filter((r) => r.legs.length > 0).map((r) => r.net);
  if (rupeeSamples.length < MIN_TRADES) return null;
  const sim = runSimulation({
    rSamples: rupeeSamples,
    trades: opts.trades ?? rupeeSamples.length,
    paths,
    startEquityR: 0, // rupees, start flat
    ruinFloorFraction: 0, // no R-ruin notion for the raw-rupee cone
    seed,
  });
  return { basis: "rupees", sim, sampleSize: rupeeSamples.length };
}
