/**
 * Monte-Carlo robustness (BT-11) — "how much of this result could be luck?"
 *
 * Pure, deterministic, market-data-free. Extends the existing MC cone
 * (mc-cone.ts → runSimulation) with two complementary resamplings of the
 * REALIZED per-trade-day returns:
 *
 *   1. BOOTSTRAP (sample with replacement) — already provided by runSimulation;
 *      we surface the terminal-P&L and max-drawdown percentile DISTRIBUTIONS
 *      (not just the cone) so the user sees the spread of outcomes.
 *   2. ORDER-SHUFFLE (permute the realized trades, no replacement) — keeps the
 *      exact trade set but reshuffles sequence, isolating how much the result
 *      depended on the LUCKY ORDER (a big early win that compounds vs. a late
 *      one). This is the classic "trade-order Monte-Carlo" robustness check.
 *
 * D3 unit choice is inherited from mc-cone: RAW RUPEES for no-stop EOD straddles
 * (each day's net is a sample, cone from 0) vs R-MULTIPLES for hard-SL strategies
 * (net / day-risk). We reuse `hasHardStop` + the same sample extraction so the
 * basis is identical to the existing cone.
 *
 * Gated at MIN_TRADES = 30 (reused) — below that everything returns null and the
 * UI shows the honest "too few trades to be meaningful" note.
 *
 * DETERMINISM: a single `seed` drives mulberry32 for BOTH the bootstrap (via
 * runSimulation) and the shuffle. Same seed ⇒ identical distributions ⇒ a stable
 * hash (distributionHash) the tests pin.
 */

import { MIN_TRADES, mulberry32, percentile, runSimulation } from "../montecarlo/simulate";
import { hasHardStop, monteCarloFromRun, type ConeBasis } from "./mc-cone";
import type { RunResult } from "../../features/backtest/shared/run-result";

export { MIN_TRADES };

/** Percentile summary of a simulated outcome metric. */
export interface OutcomeDistribution {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  mean: number;
  /** The actually-realized value of this metric (the observed backtest). */
  observed: number;
  /** Fraction of simulated paths at or below the observed value, 0..1. */
  observedPercentile: number;
}

export interface RobustnessResult {
  basis: ConeBasis;
  unit: "₹" | "R";
  sampleSize: number;
  paths: number;
  /** Terminal P&L distribution across resampled paths. */
  terminalPnl: OutcomeDistribution;
  /** Max-drawdown distribution (positive magnitude) across resampled paths. */
  maxDrawdown: OutcomeDistribution;
  /** Order-shuffle terminal stays equal to observed (no replacement) but its
   *  max-DD varies; this is the shuffle-only max-DD distribution. */
  shuffleMaxDrawdown: OutcomeDistribution;
  /** Fraction of bootstrap paths finishing net-positive (cone's probNetPositive). */
  probNetPositive: number;
  /** Risk of ruin from the cone (0 for the raw-rupee basis by design). */
  riskOfRuin: number;
  /** Deterministic hash of the headline percentiles (seed-stable; tested). */
  distributionHash: string;
  /** Plain-language descriptive summary (D10). */
  summary: string;
  /** The seed used (echoed for reproducibility). */
  seed: number;
}

/** Per-day samples in the cone's basis (R or rupees), mirroring mc-cone's routing. */
function extractSamples(run: RunResult): { samples: number[]; basis: ConeBasis } {
  const hardStop = hasHardStop(run.config);
  if (hardStop) {
    const cone = monteCarloFromRun(run, { paths: 1 });
    // monteCarloFromRun returns null when < MIN_TRADES; caller already gates.
    // For the samples we re-derive in R the same way mc-cone does:
    const rSamples: number[] = [];
    for (const row of run.blotter) {
      if (row.legs.length === 0) continue;
      const risk = dayRisk(run, row);
      if (risk === null) continue;
      rSamples.push(row.net / risk);
    }
    if (cone && cone.basis === "R" && rSamples.length >= MIN_TRADES) {
      return { samples: rSamples, basis: "R" };
    }
    // Fall through to raw rupees if no usable R risk existed.
  }
  const rupees = run.blotter.filter((r) => r.legs.length > 0).map((r) => r.net);
  return { samples: rupees, basis: "rupees" };
}

/** Mirror of mc-cone's per-day risk (kept local so the modules stay decoupled). */
function dayRisk(run: RunResult, row: RunResult["blotter"][number]): number | null {
  const config = run.config;
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

/** Max peak-to-trough drawdown (positive magnitude) of a cumulative-sum sequence. */
function maxDrawdownOf(samplesInOrder: number[], start = 0): number {
  let equity = start;
  let peak = start;
  let maxDd = 0;
  for (const s of samplesInOrder) {
    equity += s;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

/** Build an OutcomeDistribution from a list of simulated values + the observed value. */
function distribution(values: number[], observed: number): OutcomeDistribution {
  const sorted = [...values].sort((a, b) => a - b);
  const atOrBelow = sorted.filter((v) => v <= observed).length;
  return {
    p5: round2(percentile(sorted, 0.05)),
    p25: round2(percentile(sorted, 0.25)),
    p50: round2(percentile(sorted, 0.5)),
    p75: round2(percentile(sorted, 0.75)),
    p95: round2(percentile(sorted, 0.95)),
    mean: round2(values.reduce((s, v) => s + v, 0) / Math.max(1, values.length)),
    observed: round2(observed),
    observedPercentile: round4(sorted.length ? atOrBelow / sorted.length : 0),
  };
}

/**
 * Run the robustness analysis for a finished RunResult. Returns null when fewer
 * than MIN_TRADES tradeable days exist (honest "not enough data").
 *
 * Determinism: every random draw flows through mulberry32(seed). The bootstrap
 * cone uses runSimulation (which seeds internally with the same seed); the
 * order-shuffle and the bootstrap terminal/DD distributions use a single
 * sequential PRNG seeded from `seed + 1` (distinct stream, still deterministic).
 */
export function robustnessFromRun(
  run: RunResult,
  opts: { paths?: number } = {}
): RobustnessResult | null {
  const { samples, basis } = extractSamples(run);
  if (samples.length < MIN_TRADES) return null;

  const seed = run.config.execution.seed;
  const paths = Math.max(100, Math.min(50_000, Math.floor(opts.paths ?? 10_000)));
  const n = samples.length;
  const start = basis === "R" ? 0 : 0; // both cones start flat for terminal-P&L purposes

  // ── Cone (reuse runSimulation) for the standard equity cone + ROR + prob+ ──
  const coneStart = basis === "R" ? 100 : 0;
  const cone = runSimulation({
    rSamples: samples,
    trades: n,
    paths,
    startEquityR: coneStart,
    ruinFloorFraction: basis === "R" ? 0.5 : 0,
    seed,
  });

  // ── Bootstrap (with replacement): terminal P&L + max-DD distributions ──
  const rand = mulberry32(seed + 1);
  const bootTerminal = new Array<number>(paths);
  const bootMaxDd = new Array<number>(paths);
  for (let p = 0; p < paths; p++) {
    let equity = start;
    let peak = start;
    let maxDd = 0;
    for (let i = 0; i < n; i++) {
      equity += samples[(rand() * n) | 0]!;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDd) maxDd = dd;
    }
    bootTerminal[p] = equity;
    bootMaxDd[p] = maxDd;
  }

  // ── Order-shuffle (permutation, no replacement): terminal is invariant, but
  //    the max-DD depends on sequence → its distribution is the "lucky order" test.
  const shuffleMaxDd = new Array<number>(paths);
  const work = samples.slice();
  for (let p = 0; p < paths; p++) {
    // Fisher-Yates using the same deterministic stream.
    for (let i = work.length - 1; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const tmp = work[i]!;
      work[i] = work[j]!;
      work[j] = tmp;
    }
    shuffleMaxDd[p] = maxDrawdownOf(work, start);
  }

  const observedTerminal = samples.reduce((s, v) => s + v, 0);
  const observedMaxDd = maxDrawdownOf(samples, start);

  const terminalPnl = distribution(bootTerminal, observedTerminal);
  const maxDrawdown = distribution(bootMaxDd, observedMaxDd);
  const shuffleMaxDrawdown = distribution(shuffleMaxDd, observedMaxDd);

  const distributionHash = hashPercentiles([
    terminalPnl.p5,
    terminalPnl.p50,
    terminalPnl.p95,
    maxDrawdown.p50,
    maxDrawdown.p95,
    shuffleMaxDrawdown.p95,
    round4(cone.probNetPositive),
  ]);

  const summary = buildSummary(terminalPnl, basis, cone.probNetPositive, n);

  return {
    basis,
    unit: basis === "R" ? "R" : "₹",
    sampleSize: n,
    paths,
    terminalPnl,
    maxDrawdown,
    shuffleMaxDrawdown,
    probNetPositive: round4(cone.probNetPositive),
    riskOfRuin: round4(cone.riskOfRuin),
    distributionHash,
    summary,
    seed,
  };
}

/** Plain-language descriptive summary (never evaluative). */
function buildSummary(
  terminal: OutcomeDistribution,
  basis: ConeBasis,
  probNetPositive: number,
  n: number
): string {
  const fmt = (v: number) =>
    basis === "R" ? `${Math.round(v * 10) / 10}R` : `₹${Math.round(v).toLocaleString("en-IN")}`;
  const posPct = Math.round(probNetPositive * 100);
  return `Resampling ${n} trade-days, simulated outcomes span ${fmt(terminal.p5)} (5th pct) to ${fmt(terminal.p95)} (95th pct), median ${fmt(terminal.p50)}; ${posPct}% of resampled paths finished net-positive. The wider this spread, the more the single observed result could owe to luck.`;
}

/** Stable, order-sensitive hash of a number list (FNV-1a over fixed-precision strings). */
export function hashPercentiles(nums: number[]): string {
  let h = 2166136261 >>> 0;
  const str = nums.map((n) => n.toFixed(4)).join("|");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
