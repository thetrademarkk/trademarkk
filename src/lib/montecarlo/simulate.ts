/**
 * Monte-Carlo equity simulator — pure, deterministic, market-data-free.
 *
 * Bootstraps the trader's own historical per-trade R-multiple distribution
 * (sampling WITH replacement) into N simulated sequences of M future trades,
 * then summarises the spread as an equity cone (p5/p50/p95), risk-of-ruin,
 * max-drawdown odds and the probability of finishing net-positive.
 *
 * Everything here is a pure function of its inputs + a seed, so the same call
 * always yields the same numbers (verified by unit tests). The heavy loop runs
 * inside a Web Worker (see montecarlo.worker.ts) to keep the UI responsive,
 * but the math itself has no DOM/worker dependency and is unit-testable alone.
 */

/** Minimum closed, R-bearing trades before a cone is statistically meaningful. */
export const MIN_TRADES = 30;

/* ────────────────────────────────────────────────────────────────────────
 * Seeded PRNG — mulberry32 (same family as the demo seeder). 32-bit, fast,
 * good enough for bootstrap resampling and fully reproducible from a seed.
 * ──────────────────────────────────────────────────────────────────────── */

/** Returns a deterministic generator of floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable string → 32-bit seed (so a label like a user id seeds reproducibly). */
export function hashSeed(input: string): number {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ────────────────────────────────────────────────────────────────────────
 * Percentiles (linear interpolation, R7 / numpy default) — identical formula
 * to lib/stats so cone bands and the stats pack agree.
 * ──────────────────────────────────────────────────────────────────────── */

/** Linear-interpolated percentile over a sorted ascending array. p in [0,1]. */
export function percentile(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  if (n === 1) return sortedAsc[0]!;
  const rank = p * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const frac = rank - lo;
  return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * frac;
}

/* ────────────────────────────────────────────────────────────────────────
 * Simulation
 * ──────────────────────────────────────────────────────────────────────── */

export interface SimInput {
  /**
   * The trader's historical per-trade returns, expressed in R (risk units).
   * Each future trade is bootstrapped (sampled with replacement) from this set,
   * so win% and the win/loss magnitude mix are preserved implicitly.
   */
  rSamples: number[];
  /** Trades per simulated path (the horizon). */
  trades: number;
  /** Number of simulated paths. */
  paths: number;
  /** Starting equity, expressed in R units (e.g. 100 = 100R of capital). */
  startEquityR: number;
  /**
   * Ruin floor as a fraction of starting equity (0–1). A path is "ruined" the
   * first time its running equity drops to or below startEquityR × this value.
   * e.g. 0.5 = account halved.
   */
  ruinFloorFraction: number;
  /** PRNG seed — same seed ⇒ identical output. */
  seed: number;
}

export interface ConeBand {
  /** Trade index, 0 = start (before any simulated trade), 1…trades after each. */
  step: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export interface SimResult {
  /** Equity (in R) percentile bands at every step — length = trades + 1. */
  cone: ConeBand[];
  /** Fraction of paths that breached the ruin floor at any point (0–1). */
  riskOfRuin: number;
  /** Fraction of paths whose final equity exceeded the starting equity (0–1). */
  probNetPositive: number;
  /** Median (p50) of each path's peak-to-trough drawdown, in R. */
  medianMaxDrawdown: number;
  /** Worst (p95) max drawdown across paths, in R. */
  worstMaxDrawdown: number;
  /** Final-equity (in R) percentiles across all paths. */
  finalEquity: { p5: number; p50: number; p95: number };
  /** Echo of the parameters actually used (after clamping). */
  meta: {
    trades: number;
    paths: number;
    startEquityR: number;
    ruinFloorR: number;
    sampleSize: number;
  };
}

/** Hard caps so a runaway input can't lock the worker for minutes. */
const MAX_PATHS = 200_000;
const MAX_TRADES = 2_000;

/**
 * Run the bootstrap Monte-Carlo. Pure and deterministic given `input.seed`.
 *
 * Memory note: each path is simulated once; at every step its equity is pushed
 * into that step's column so we can percentile down the columns afterwards.
 * That is trades×paths numbers total — fine for the capped ranges — and lets
 * the cone read off true cross-sectional percentiles rather than an
 * approximation.
 */
export function runSimulation(input: SimInput): SimResult {
  const paths = Math.max(1, Math.min(MAX_PATHS, Math.floor(input.paths)));
  const trades = Math.max(1, Math.min(MAX_TRADES, Math.floor(input.trades)));
  const startEquityR = Number.isFinite(input.startEquityR) ? input.startEquityR : 0;
  const ruinFloorR = startEquityR * clamp01(input.ruinFloorFraction);
  const samples = input.rSamples;
  const m = samples.length;
  const rand = mulberry32(input.seed);

  // With no R-samples there is nothing to bootstrap from. Bail out with a
  // well-defined NEUTRAL result rather than indexing samples[…]===undefined,
  // which would turn equity (and every derived figure) into NaN. The cone is a
  // flat line at the starting equity, no path ever moves, so finals sit on the
  // start and drawdown is zero. (The UI gates this at MIN_TRADES, but the math
  // guards itself so direct callers can't get NaN.)
  if (m === 0) {
    const cone: ConeBand[] = Array.from({ length: trades + 1 }, (_, step) => ({
      step,
      p5: startEquityR,
      p25: startEquityR,
      p50: startEquityR,
      p75: startEquityR,
      p95: startEquityR,
    }));
    return {
      cone,
      // A motionless path is "ruined" only if the floor already sits at/above
      // the (unchanging) starting equity.
      riskOfRuin: startEquityR <= ruinFloorR ? 1 : 0,
      // No path ever ends strictly above its start, so none finish net-positive.
      probNetPositive: 0,
      medianMaxDrawdown: 0,
      worstMaxDrawdown: 0,
      finalEquity: { p5: startEquityR, p50: startEquityR, p95: startEquityR },
      meta: { trades, paths, startEquityR, ruinFloorR, sampleSize: m },
    };
  }

  // columns[step] holds every path's equity at that step (step 0 = start).
  const columns: number[][] = Array.from({ length: trades + 1 }, () => new Array<number>(paths));
  const finals = new Array<number>(paths);
  const maxDrawdowns = new Array<number>(paths);
  let ruined = 0;
  let netPositive = 0;

  for (let p = 0; p < paths; p++) {
    let equity = startEquityR;
    let peak = equity;
    let maxDd = 0;
    let breached = false;
    columns[0]![p] = equity;

    for (let s = 1; s <= trades; s++) {
      // Bootstrap: pick a historical trade uniformly at random, with replacement.
      const r = samples[(rand() * m) | 0]!;
      equity += r;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDd) maxDd = dd;
      if (!breached && equity <= ruinFloorR) breached = true;
      columns[s]![p] = equity;
    }

    finals[p] = equity;
    maxDrawdowns[p] = maxDd;
    if (breached) ruined++;
    if (equity > startEquityR) netPositive++;
  }

  const cone: ConeBand[] = columns.map((col, step) => {
    const sorted = [...col].sort((a, b) => a - b);
    return {
      step,
      p5: percentile(sorted, 0.05),
      p25: percentile(sorted, 0.25),
      p50: percentile(sorted, 0.5),
      p75: percentile(sorted, 0.75),
      p95: percentile(sorted, 0.95),
    };
  });

  const ddSorted = [...maxDrawdowns].sort((a, b) => a - b);
  const finalsSorted = [...finals].sort((a, b) => a - b);

  return {
    cone,
    riskOfRuin: ruined / paths,
    probNetPositive: netPositive / paths,
    medianMaxDrawdown: percentile(ddSorted, 0.5),
    worstMaxDrawdown: percentile(ddSorted, 0.95),
    finalEquity: {
      p5: percentile(finalsSorted, 0.05),
      p50: percentile(finalsSorted, 0.5),
      p95: percentile(finalsSorted, 0.95),
    },
    meta: { trades, paths, startEquityR, ruinFloorR, sampleSize: m },
  };
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/* ────────────────────────────────────────────────────────────────────────
 * Helpers for turning trades → sim inputs (used by the UI before dispatch).
 * ──────────────────────────────────────────────────────────────────────── */

export interface RBearingTrade {
  r_multiple: number | null;
  status: string;
  opened_at?: string;
  closed_at?: string | null;
}

/** Finite, non-null R-multiples of closed trades — the bootstrap population. */
export function extractRSamples(trades: RBearingTrade[]): number[] {
  return trades
    .filter((t) => t.status === "closed")
    .map((t) => t.r_multiple)
    .filter((r): r is number => r != null && Number.isFinite(r));
}

/**
 * Estimate trades-per-year from a set of closed trades, for the default horizon.
 * Uses the open-time span; falls back to the sample count when the span is too
 * short to annualise. Returns a sensible default when there's no usable span.
 */
export function estimateTradesPerYear(trades: RBearingTrade[]): number {
  const times = trades
    .filter((t) => t.status === "closed")
    .map((t) => (t.opened_at ? new Date(t.opened_at).getTime() : NaN))
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);
  const n = times.length;
  if (n < 2) return Math.max(MIN_TRADES, n);
  const spanMs = times[n - 1]! - times[0]!;
  const spanDays = spanMs / (1000 * 60 * 60 * 24);
  if (spanDays < 7) return Math.max(MIN_TRADES, n);
  const perYear = Math.round((n / spanDays) * 365);
  // Clamp to a practical range so the default horizon is never silly.
  return Math.max(MIN_TRADES, Math.min(MAX_TRADES, perYear));
}
