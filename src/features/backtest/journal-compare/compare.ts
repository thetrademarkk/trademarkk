/**
 * BT-12 journal-compare — COMPARISON ENGINE (pure, deterministic, paise-correct).
 *
 * Given a set of REAL journaled trades over a period + a backtest RunResult for
 * the SAME instrument (a point-in-time MECHANICAL baseline of "what a rules-only
 * version of this idea would have done"), produce an honest side-by-side:
 *
 *   - a cumulative EQUITY OVERLAY (your real trading vs the mechanical baseline),
 *     aligned on the union of trading days inside the date overlap;
 *   - a set of DESCRIPTIVE discipline/edge metrics — win-rate delta, average-hold
 *     delta, total-P&L gap, trade-frequency delta;
 *   - DIVERGENCES: days you traded the instrument that the baseline did NOT
 *     ("discretionary deviations"), and baseline signal-days you skipped
 *     ("signals the plan had that you didn't take").
 *
 * HONEST FRAMING (D10): this is a MIRROR for self-review, NOT a verdict on skill.
 * A backtest is a point-in-time mechanical baseline, not truth. Nothing here ever
 * says you were "right" or "wrong" — only WHERE your real trading DIVERGED from
 * the mechanical baseline. The journal is the hero.
 *
 * Robust to messy real data:
 *   - INSTRUMENT NOT IN ARCHIVE → an honest "no comparable backtest data" state.
 *   - PARTIAL date overlap → comparison is scoped to the overlap, with the gap
 *     surfaced (we never compare apples to a window of oranges).
 *   - TOO FEW trades → a low-sample note (never suppressed, never overclaimed).
 *
 * Money is rupees with paise (2-dp) precision; we round only at the boundaries.
 */

import { computeMetrics, type DailyReturn } from "@/lib/backtest/metrics";
import type { RunResult } from "@/features/backtest/shared/run-result";
import type { CompareIndex, JournalTrade } from "./adapter";
import { realizedTrades } from "./adapter";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Min realized journal trades for the comparison to read as more than indicative. */
export const MIN_SAMPLE_TRADES = 10;

/** Why a comparison could not be produced (honest, non-blaming reasons). */
export type CompareUnavailableReason =
  | "no-journal-trades" // the user has no realized trades at all
  | "no-comparable-instrument" // none of their trades map to a backtestable index
  | "no-backtest" // no baseline run was provided/available
  | "no-date-overlap"; // journal trades and the baseline never overlap in time

/** Equity is in cumulative rupees by IST trading day for BOTH series. */
export interface OverlayPoint {
  /** "YYYY-MM-DD" IST trading day. */
  day: string;
  /** Cumulative real (journal) net P&L through this day, or null if no real day yet. */
  real: number | null;
  /** Cumulative baseline (backtest) net P&L through this day, or null. */
  baseline: number | null;
}

/** A descriptive side-by-side metric (real vs baseline + their delta). */
export interface DisciplineMetric {
  key: "totalPnl" | "winRate" | "avgHold" | "tradeFrequency" | "profitFactor" | "maxDrawdown";
  label: string;
  /** Real (journal) value in the metric's native unit. */
  real: number;
  /** Baseline (backtest) value in the metric's native unit. */
  baseline: number;
  /** real − baseline, native unit (descriptive sign only — never "better/worse"). */
  delta: number;
  /** "rupees" | "pct" (0..1 fraction) | "minutes" | "count" | "ratio". */
  unit: "rupees" | "pct" | "minutes" | "count" | "ratio";
}

/** One divergence row — a day where real & baseline trading diverged. */
export interface Divergence {
  day: string;
  kind: "discretionary" | "skipped-signal";
  /** Your realized net on that day (0 for a skipped baseline signal). */
  realNet: number;
  /** The baseline's net on that day (0 for a discretionary deviation). */
  baselineNet: number;
  /** How many real trades you took that day on the comparable instrument. */
  realTradeCount: number;
}

/** The summary of how the two trading streams diverged. */
export interface DivergenceSummary {
  /** Days you traded the instrument that the baseline did not. */
  discretionaryDays: number;
  /** Σ realized net on your discretionary days. */
  discretionaryNet: number;
  /** Baseline signal-days you logged no trade on. */
  skippedSignalDays: number;
  /** Σ baseline net on the signals you skipped. */
  skippedSignalNet: number;
  /** Days both you and the baseline traded. */
  overlapDays: number;
  rows: Divergence[];
}

/** The complete, descriptive comparison result. */
export interface JournalCompare {
  index: CompareIndex;
  /** The IST day window the comparison covers (the journal × baseline overlap). */
  period: { from: string; to: string };
  /** Realized comparable-instrument trades inside the overlap. */
  sampleTrades: number;
  /** True when sampleTrades < MIN_SAMPLE_TRADES — read as indicative only. */
  lowSample: boolean;
  /**
   * How much of the user's realized comparable trades fell OUTSIDE the baseline's
   * date range (partial overlap). 0 when the baseline fully covers their trading.
   */
  outOfRangeTrades: number;
  overlay: OverlayPoint[];
  metrics: DisciplineMetric[];
  divergences: DivergenceSummary;
}

/** Either a usable comparison, or an honest reason it could not be produced. */
export type JournalCompareResult =
  | { ok: true; compare: JournalCompare }
  | {
      ok: false;
      reason: CompareUnavailableReason;
      /** The index that WOULD have been compared (when an instrument matched). */
      index: CompareIndex | null;
      /** How many realized comparable trades existed (for the empty-state copy). */
      comparableTrades: number;
    };

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
function dayKeyFromEpoch(ts: number): string {
  return new Date(ts + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Per-day net P&L (rupees) from the backtest blotter (one cycle = one day). */
export function baselineDailyReturns(run: RunResult): DailyReturn[] {
  return run.blotter
    .filter((b) => b.legs.length > 0)
    .map((b) => ({ day: b.day, net: b.net }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** The baseline's mean hold in minutes (exit − entry of each booked cycle). */
function baselineAvgHoldMinutes(run: RunResult): number {
  const holds = run.blotter
    .filter((b) => b.legs.length > 0 && b.exitTs > b.entryTs)
    .map((b) => (b.exitTs - b.entryTs) / 60_000);
  if (holds.length === 0) return 0;
  return r2(holds.reduce((s, h) => s + h, 0) / holds.length);
}

/** Per-day realized net from journal trades, bucketed by EXIT IST day. */
function journalDailyReturns(trades: JournalTrade[]): DailyReturn[] {
  const byDay = new Map<string, number>();
  for (const t of trades) {
    if (t.exitTs === null) continue;
    const day = dayKeyFromEpoch(t.exitTs);
    byDay.set(day, r2((byDay.get(day) ?? 0) + t.netPnl));
  }
  return [...byDay.entries()]
    .map(([day, net]) => ({ day, net }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** Mean hold (minutes) over realized journal trades with a known hold. */
function journalAvgHoldMinutes(trades: JournalTrade[]): number {
  const holds = trades.map((t) => t.holdMinutes).filter((h): h is number => h !== null);
  if (holds.length === 0) return 0;
  return r2(holds.reduce((s, h) => s + h, 0) / holds.length);
}

/** Build the union-of-days cumulative equity overlay for both series. */
function buildOverlay(journalDaily: DailyReturn[], baselineDaily: DailyReturn[]): OverlayPoint[] {
  const realByDay = new Map(journalDaily.map((d) => [d.day, d.net]));
  const baseByDay = new Map(baselineDaily.map((d) => [d.day, d.net]));
  const days = [...new Set([...realByDay.keys(), ...baseByDay.keys()])].sort((a, b) =>
    a.localeCompare(b)
  );

  let realCum = 0;
  let baseCum = 0;
  let realSeen = false;
  let baseSeen = false;
  const out: OverlayPoint[] = [];
  for (const day of days) {
    const realDelta = realByDay.get(day);
    const baseDelta = baseByDay.get(day);
    if (realDelta !== undefined) {
      realCum = r2(realCum + realDelta);
      realSeen = true;
    }
    if (baseDelta !== undefined) {
      baseCum = r2(baseCum + baseDelta);
      baseSeen = true;
    }
    out.push({
      day,
      real: realSeen ? realCum : null,
      baseline: baseSeen ? baseCum : null,
    });
  }
  return out;
}

/**
 * Detect divergences day-by-day across the overlap window.
 *  - discretionary  : you traded the instrument, the baseline did NOT that day.
 *  - skipped-signal : the baseline had a trade, you logged none that day.
 * Days both traded are counted as overlap (not a divergence).
 */
function buildDivergences(
  journalDaily: DailyReturn[],
  baselineDaily: DailyReturn[],
  tradeCountByDay: Map<string, number>
): DivergenceSummary {
  const realByDay = new Map(journalDaily.map((d) => [d.day, d.net]));
  const baseByDay = new Map(baselineDaily.map((d) => [d.day, d.net]));
  const days = [...new Set([...realByDay.keys(), ...baseByDay.keys()])].sort((a, b) =>
    a.localeCompare(b)
  );

  const rows: Divergence[] = [];
  let discretionaryDays = 0;
  let discretionaryNet = 0;
  let skippedSignalDays = 0;
  let skippedSignalNet = 0;
  let overlapDays = 0;

  for (const day of days) {
    const traded = realByDay.has(day);
    const signalled = baseByDay.has(day);
    if (traded && signalled) {
      overlapDays++;
      continue;
    }
    if (traded && !signalled) {
      const net = realByDay.get(day)!;
      discretionaryDays++;
      discretionaryNet = r2(discretionaryNet + net);
      rows.push({
        day,
        kind: "discretionary",
        realNet: net,
        baselineNet: 0,
        realTradeCount: tradeCountByDay.get(day) ?? 0,
      });
    } else if (!traded && signalled) {
      const net = baseByDay.get(day)!;
      skippedSignalDays++;
      skippedSignalNet = r2(skippedSignalNet + net);
      rows.push({
        day,
        kind: "skipped-signal",
        realNet: 0,
        baselineNet: net,
        realTradeCount: 0,
      });
    }
  }

  rows.sort((a, b) => a.day.localeCompare(b.day));
  return {
    discretionaryDays,
    discretionaryNet: r2(discretionaryNet),
    skippedSignalDays,
    skippedSignalNet: r2(skippedSignalNet),
    overlapDays,
    rows,
  };
}

/**
 * Compare REAL journaled trades against a MECHANICAL baseline backtest. Returns
 * either a descriptive comparison or an honest unavailable reason.
 *
 * @param allTrades  every normalized journal trade (open + closed, all segments).
 * @param run        the baseline RunResult, or null if none is available.
 */
export function compareJournalToBacktest(
  allTrades: JournalTrade[],
  run: RunResult | null
): JournalCompareResult {
  const realized = realizedTrades(allTrades);

  if (realized.length === 0) {
    return { ok: false, reason: "no-journal-trades", index: null, comparableTrades: 0 };
  }

  if (!run) {
    // We can still tell the user whether ANY of their trades are comparable.
    const anyIndex = realized.find((t) => t.index !== null)?.index ?? null;
    return {
      ok: false,
      reason: "no-backtest",
      index: anyIndex,
      comparableTrades: realized.filter((t) => t.index !== null).length,
    };
  }

  const index = run.config.market.symbol as CompareIndex;
  // Only trades on the SAME index as the baseline are comparable.
  const comparable = realized.filter((t) => t.index === index);
  if (comparable.length === 0) {
    return {
      ok: false,
      reason: "no-comparable-instrument",
      index,
      comparableTrades: 0,
    };
  }

  const baselineDaily = baselineDailyReturns(run);
  if (baselineDaily.length === 0) {
    return { ok: false, reason: "no-backtest", index, comparableTrades: comparable.length };
  }

  // The baseline's date span — comparison is scoped to the journal × baseline
  // OVERLAP so we never compare a trader's window against a different one.
  const baseFrom = baselineDaily[0]!.day;
  const baseTo = baselineDaily[baselineDaily.length - 1]!.day;

  const inRange = comparable.filter((t) => {
    const d = dayKeyFromEpoch(t.exitTs!);
    return d >= baseFrom && d <= baseTo;
  });
  const outOfRangeTrades = comparable.length - inRange.length;

  if (inRange.length === 0) {
    return { ok: false, reason: "no-date-overlap", index, comparableTrades: comparable.length };
  }

  const journalDaily = journalDailyReturns(inRange);

  // Per-day trade counts (for the divergence rows) over the in-range comparable set.
  const tradeCountByDay = new Map<string, number>();
  for (const t of inRange) {
    const d = dayKeyFromEpoch(t.exitTs!);
    tradeCountByDay.set(d, (tradeCountByDay.get(d) ?? 0) + 1);
  }

  // The shared window = the union of real & baseline day extremes inside range.
  const allDays = [...journalDaily.map((d) => d.day), ...baselineDaily.map((d) => d.day)].sort(
    (a, b) => a.localeCompare(b)
  );
  const from = allDays[0]!;
  const to = allDays[allDays.length - 1]!;

  const jMetrics = computeMetrics(journalDaily);
  const bMetrics = computeMetrics(baselineDaily);
  const jHold = journalAvgHoldMinutes(inRange);
  const bHold = baselineAvgHoldMinutes(run);

  const metrics: DisciplineMetric[] = [
    {
      key: "totalPnl",
      label: "Total net P&L",
      real: jMetrics.totalNet,
      baseline: bMetrics.totalNet,
      delta: r2(jMetrics.totalNet - bMetrics.totalNet),
      unit: "rupees",
    },
    {
      key: "winRate",
      label: "Win rate (by day)",
      real: jMetrics.winRate,
      baseline: bMetrics.winRate,
      delta: Math.round((jMetrics.winRate - bMetrics.winRate) * 10000) / 10000,
      unit: "pct",
    },
    {
      key: "avgHold",
      label: "Average hold",
      real: jHold,
      baseline: bHold,
      delta: r2(jHold - bHold),
      unit: "minutes",
    },
    {
      key: "tradeFrequency",
      label: "Trading days",
      real: journalDaily.length,
      baseline: baselineDaily.length,
      delta: journalDaily.length - baselineDaily.length,
      unit: "count",
    },
    {
      key: "profitFactor",
      label: "Profit factor",
      real: jMetrics.profitFactor,
      baseline: bMetrics.profitFactor,
      delta: Math.round((jMetrics.profitFactor - bMetrics.profitFactor) * 100) / 100,
      unit: "ratio",
    },
    {
      key: "maxDrawdown",
      label: "Max drawdown",
      real: jMetrics.maxDrawdown,
      baseline: bMetrics.maxDrawdown,
      delta: r2(jMetrics.maxDrawdown - bMetrics.maxDrawdown),
      unit: "rupees",
    },
  ];

  const overlay = buildOverlay(journalDaily, baselineDaily);
  const divergences = buildDivergences(journalDaily, baselineDaily, tradeCountByDay);

  return {
    ok: true,
    compare: {
      index,
      period: { from, to },
      sampleTrades: inRange.length,
      lowSample: inRange.length < MIN_SAMPLE_TRADES,
      outOfRangeTrades,
      overlay,
      metrics,
      divergences,
    },
  };
}
