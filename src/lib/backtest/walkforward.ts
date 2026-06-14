/**
 * Walk-forward analysis (BT-11) — pure, deterministic, market-data-free.
 *
 * Partitions a finished backtest's per-trade-day return series into rolling or
 * anchored IN-SAMPLE (IS) vs OUT-OF-SAMPLE (OOS) windows, runs the EXISTING
 * metrics pack (computeMetrics, BT-04) over each window, and aggregates an OOS
 * equity curve. The honest question this answers: "did the result hold up on
 * data the strategy didn't get to 'see' first?"
 *
 * DESIGN NOTE (honesty + reuse): the BT-04 engine books exactly one trade-cycle
 * per trading day (the AlgoTest day-trade convention), so the RunResult's
 * per-day net series IS the trade-return series. Partitioning that series into
 * contiguous IS/OOS day-blocks is equivalent to re-running the deterministic,
 * point-in-time engine on each date sub-range (the engine has no cross-day state
 * — every day is replayed independently from closed prior bars) while reusing
 * the already-computed, byte-identical results. We therefore never fabricate
 * extra runs; we slice the real, deterministic output. This keeps the layer
 * pure and seed-free (windowing has no randomness) and means a 2-day golden run
 * honestly reports "not enough data" rather than inventing windows.
 *
 * Everything here is DESCRIPTIVE (D10): the summary states what happened ("OOS
 * net P&L was X% of IS", "performance held / degraded out-of-sample") and never
 * says "good"/"bad" or recommends anything.
 *
 * Money is in rupees. Days are "YYYY-MM-DD" IST trading days.
 */

import { computeMetrics, type BacktestMetrics, type DailyReturn } from "./metrics";
import type { RunResult } from "../../features/backtest/shared/run-result";

/** Walk-forward scheme. ANCHORED = IS always starts at day 0 and grows; ROLLING
 *  = fixed-size IS window slides forward (the classic out-of-sample stress). */
export type WalkForwardScheme = "anchored" | "rolling";

/**
 * Minimum trade-days a window (IS or OOS) must contain to be statistically
 * usable. Below this the window is SKIPPED (flagged low-coverage), never
 * fabricated. Deliberately distinct from MC's MIN_TRADES=30: a walk-forward
 * fold is a coarser unit, and the IS/OOS split is descriptive, not a projection.
 */
export const MIN_WINDOW_DAYS = 5;

/** One IS→OOS fold. Indices are into the (chronological) trade-day series. */
export interface WalkForwardWindow {
  /** 1-based fold number for display. */
  index: number;
  /** In-sample day range (inclusive day strings). */
  isDays: { start: string; end: string; count: number };
  /** Out-of-sample day range (inclusive day strings). */
  oosDays: { start: string; end: string; count: number };
  isNet: number;
  oosNet: number;
  isMetrics: BacktestMetrics;
  oosMetrics: BacktestMetrics;
  /**
   * OOS net as a fraction of IS net, sign-aware. Null when IS net is ~0 (ratio
   * undefined — we never divide by zero or imply a meaning that isn't there).
   */
  oosToIsNetRatio: number | null;
  /** True when either side fell below MIN_WINDOW_DAYS (this fold is informational only). */
  lowCoverage: boolean;
}

/** Degradation classification — purely descriptive bucketing, never a verdict. */
export type WalkForwardVerdict =
  | "held" // OOS net ≥ 70% of IS net (and both positive)
  | "softened" // OOS net 30–70% of IS net
  | "degraded" // OOS net < 30% of IS, or flipped sign
  | "improved" // OOS net > IS net
  | "inconclusive"; // not enough usable windows / IS ~flat

export interface WalkForwardResult {
  scheme: WalkForwardScheme;
  windows: WalkForwardWindow[];
  /** Concatenated OOS equity curve (cumulative net across all OOS segments). */
  oosCurve: { day: string; equity: number }[];
  /** Σ IS net across usable folds (rupees). */
  totalIsNet: number;
  /** Σ OOS net across usable folds (rupees). */
  totalOosNet: number;
  /** Aggregate OOS net ÷ aggregate IS net, sign-aware. Null when IS ~0. */
  aggregateOosToIsRatio: number | null;
  /** Descriptive bucket (never evaluative). */
  verdict: WalkForwardVerdict;
  /** Plain-language, descriptive one-liner (D10). */
  summary: string;
  /** Usable (non-low-coverage) fold count. */
  usableWindows: number;
  /** Total trade-days the analysis spanned. */
  totalDays: number;
}

/** Config for the split. Sizes are in trade-DAYS (folds are built day-wise). */
export interface WalkForwardConfig {
  scheme?: WalkForwardScheme;
  /**
   * IS window length in trade-days. For ANCHORED this is the FIRST fold's IS
   * size (it grows thereafter). For ROLLING it's the fixed IS size.
   */
  isDays?: number;
  /** OOS window length in trade-days (constant for both schemes). */
  oosDays?: number;
}

/** Threshold a "held" classification needs (OOS ≥ 70% of IS). */
const HELD_RATIO = 0.7;
/** Threshold below which we call it "degraded". */
const SOFT_RATIO = 0.3;
/** IS-net magnitude (₹) below which the ratio is meaningless → inconclusive. */
const FLAT_IS_EPS = 1;

/** Trade-day rows the analysis runs on: only days that actually booked a cycle. */
function tradeDays(run: RunResult): DailyReturn[] {
  return run.blotter
    .filter((b) => b.legs.length > 0)
    .map((b) => ({ day: b.day, net: b.net }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** Sign-aware ratio: OOS net relative to IS net. Null when IS ~flat. */
function netRatio(isNet: number, oosNet: number): number | null {
  if (Math.abs(isNet) < FLAT_IS_EPS) return null;
  return oosNet / isNet;
}

/**
 * Build the fold boundaries (pure index arithmetic). Returns inclusive
 * [isStart,isEnd] / [oosStart,oosEnd] index pairs into the day array. The last
 * partial OOS block is kept (and may be flagged low-coverage) rather than dropped.
 */
function foldBounds(
  total: number,
  scheme: WalkForwardScheme,
  isLen: number,
  oosLen: number
): { isStart: number; isEnd: number; oosStart: number; oosEnd: number }[] {
  const folds: { isStart: number; isEnd: number; oosStart: number; oosEnd: number }[] = [];
  if (isLen < 1 || oosLen < 1) return folds;
  let oosStart = isLen;
  let rollStart = 0;
  while (oosStart < total) {
    const oosEnd = Math.min(oosStart + oosLen - 1, total - 1);
    const isStart = scheme === "anchored" ? 0 : rollStart;
    const isEnd = oosStart - 1;
    if (isEnd >= isStart) folds.push({ isStart, isEnd, oosStart, oosEnd });
    // Advance: OOS moves by its length; rolling IS slides by the same step so
    // the IS window stays a fixed size and never overlaps the prior OOS.
    oosStart = oosEnd + 1;
    rollStart += oosLen;
  }
  return folds;
}

/** Default split sizing from the available day count (sensible, deterministic). */
function defaultSizing(total: number): { isDays: number; oosDays: number } {
  // Aim for ~70/30 IS/OOS with at least MIN_WINDOW_DAYS each where possible, and
  // a handful of folds. Fully deterministic from `total` alone.
  const oos = Math.max(MIN_WINDOW_DAYS, Math.round(total * 0.2));
  const is = Math.max(MIN_WINDOW_DAYS, Math.round(total * 0.4));
  return { isDays: is, oosDays: oos };
}

/**
 * Run the walk-forward analysis over a finished RunResult. Pure & deterministic:
 * identical RunResult + config ⇒ identical WalkForwardResult.
 */
export function walkForward(run: RunResult, config: WalkForwardConfig = {}): WalkForwardResult {
  const scheme: WalkForwardScheme = config.scheme ?? "rolling";
  const days = tradeDays(run);
  const total = days.length;

  const sizing = defaultSizing(total);
  const isLen = Math.max(1, config.isDays ?? sizing.isDays);
  const oosLen = Math.max(1, config.oosDays ?? sizing.oosDays);

  const bounds = foldBounds(total, scheme, isLen, oosLen);
  const windows: WalkForwardWindow[] = [];
  const oosCurve: { day: string; equity: number }[] = [];
  let oosEquity = 0;
  let totalIsNet = 0;
  let totalOosNet = 0;
  let usableIsNet = 0;
  let usableOosNet = 0;

  bounds.forEach((b, i) => {
    const isSlice = days.slice(b.isStart, b.isEnd + 1);
    const oosSlice = days.slice(b.oosStart, b.oosEnd + 1);
    const isNet = round2(isSlice.reduce((s, d) => s + d.net, 0));
    const oosNet = round2(oosSlice.reduce((s, d) => s + d.net, 0));
    const lowCoverage = isSlice.length < MIN_WINDOW_DAYS || oosSlice.length < MIN_WINDOW_DAYS;

    windows.push({
      index: i + 1,
      isDays: {
        start: isSlice[0]!.day,
        end: isSlice[isSlice.length - 1]!.day,
        count: isSlice.length,
      },
      oosDays: {
        start: oosSlice[0]!.day,
        end: oosSlice[oosSlice.length - 1]!.day,
        count: oosSlice.length,
      },
      isNet,
      oosNet,
      isMetrics: computeMetrics(isSlice),
      oosMetrics: computeMetrics(oosSlice),
      oosToIsNetRatio: netRatio(isNet, oosNet),
      lowCoverage,
    });

    totalIsNet += isNet;
    totalOosNet += oosNet;
    if (!lowCoverage) {
      usableIsNet += isNet;
      usableOosNet += oosNet;
    }
    // The aggregate OOS curve stitches every OOS segment end-to-end.
    for (const d of oosSlice) {
      oosEquity = round2(oosEquity + d.net);
      oosCurve.push({ day: d.day, equity: oosEquity });
    }
  });

  const usableWindows = windows.filter((w) => !w.lowCoverage).length;
  totalIsNet = round2(totalIsNet);
  totalOosNet = round2(totalOosNet);
  const aggregateOosToIsRatio = netRatio(round2(usableIsNet), round2(usableOosNet));
  const verdict = classify(
    usableWindows,
    round2(usableIsNet),
    round2(usableOosNet),
    aggregateOosToIsRatio
  );
  const summary = buildSummary(verdict, aggregateOosToIsRatio, usableWindows, total, scheme);

  return {
    scheme,
    windows,
    oosCurve,
    totalIsNet,
    totalOosNet,
    aggregateOosToIsRatio,
    verdict,
    summary,
    usableWindows,
    totalDays: total,
  };
}

/** Descriptive bucketing of the aggregate IS→OOS relationship. */
function classify(
  usableWindows: number,
  isNet: number,
  oosNet: number,
  ratio: number | null
): WalkForwardVerdict {
  if (usableWindows < 1 || ratio === null || Math.abs(isNet) < FLAT_IS_EPS) return "inconclusive";
  // Sign flip (e.g. IS profit → OOS loss, or vice-versa) is always "degraded":
  // the out-of-sample result reversed direction.
  if (Math.sign(oosNet) !== Math.sign(isNet) && oosNet !== 0) return "degraded";
  if (ratio >= 1) return "improved";
  if (ratio >= HELD_RATIO) return "held";
  if (ratio >= SOFT_RATIO) return "softened";
  return "degraded";
}

/** Plain-language, descriptive summary (never evaluative). */
function buildSummary(
  verdict: WalkForwardVerdict,
  ratio: number | null,
  usableWindows: number,
  totalDays: number,
  scheme: WalkForwardScheme
): string {
  if (verdict === "inconclusive") {
    if (usableWindows < 1) {
      return `Not enough trade-days (${totalDays}) to form a meaningful in-sample / out-of-sample split.`;
    }
    return `In-sample result was near break-even, so the out-of-sample comparison is not meaningful.`;
  }
  const pct = ratio === null ? "" : `${Math.round(ratio * 100)}%`;
  const foldWord = usableWindows === 1 ? "fold" : "folds";
  const schemeWord = scheme === "anchored" ? "anchored" : "rolling";
  switch (verdict) {
    case "improved":
      return `Out-of-sample net P&L was ${pct} of in-sample across ${usableWindows} ${schemeWord} ${foldWord} — performance held up or strengthened out-of-sample.`;
    case "held":
      return `Out-of-sample net P&L was ${pct} of in-sample across ${usableWindows} ${schemeWord} ${foldWord} — performance largely held out-of-sample.`;
    case "softened":
      return `Out-of-sample net P&L was ${pct} of in-sample across ${usableWindows} ${schemeWord} ${foldWord} — performance softened out-of-sample.`;
    case "degraded":
      return `Out-of-sample net P&L was ${pct} of in-sample across ${usableWindows} ${schemeWord} ${foldWord} — performance degraded out-of-sample.`;
    default:
      return `Out-of-sample net P&L was ${pct} of in-sample.`;
  }
}

/** One point of the two-color IS/OOS equity curve (for the Recharts area). */
export interface WalkForwardCurvePoint {
  day: string;
  /** Cumulative equity (rupees) only while this point is IN-SAMPLE, else null. */
  isEquity: number | null;
  /** Cumulative equity (rupees) only while this point is OUT-OF-SAMPLE, else null. */
  oosEquity: number | null;
  /** The boundary point carries BOTH so the two areas join with no gap. */
  boundary: boolean;
}

/**
 * Build the two-color IS/OOS equity curve for the canonical "train then test"
 * view: the FULL cumulative equity over every trade-day, split at the boundary
 * of the LAST fold (everything before its OOS start = in-sample; its OOS block =
 * out-of-sample). Pure & deterministic. Returns an empty array when there are no
 * usable folds (the UI then shows the honest not-enough-data state).
 */
export function walkForwardCurve(run: RunResult, wf: WalkForwardResult): WalkForwardCurvePoint[] {
  const days = tradeDays(run);
  if (days.length === 0 || wf.windows.length === 0) return [];
  // Boundary = the OOS start day of the last usable fold (fall back to last fold).
  const usable = wf.windows.filter((w) => !w.lowCoverage);
  const ref = (usable.length ? usable : wf.windows)[
    (usable.length ? usable : wf.windows).length - 1
  ]!;
  const boundaryDay = ref.oosDays.start;
  const boundaryIdx = days.findIndex((d) => d.day === boundaryDay);
  // If we can't locate it, treat everything as in-sample (no split) — honest.
  const splitIdx = boundaryIdx < 0 ? days.length : boundaryIdx;

  let equity = 0;
  return days.map((d, i) => {
    equity = round2(equity + d.net);
    const isOos = i >= splitIdx;
    const boundary = i === splitIdx;
    return {
      day: d.day,
      // The boundary point belongs to BOTH series so the areas meet seamlessly.
      isEquity: !isOos || boundary ? equity : null,
      oosEquity: isOos ? equity : null,
      boundary,
    };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
