import { formatINR, formatNumber, formatPct } from "@/lib/utils";
import type { GroupStat } from "@/lib/stats/stats";

/**
 * Pure builders for screen-reader summaries of the analytics charts.
 *
 * Recharts renders bare <svg> with no accessible name, so every chart that
 * matters carries a `role="img"` + `aria-label` derived from these helpers.
 * The label states the headline numbers a sighted user reads off the bars, so a
 * screen-reader user gets the same signal without the visual. Profit/loss is
 * always carried as a signed value (never colour alone). Kept side-effect-free
 * and unit-tested.
 */

/** "0 bars" / "1 bar" / "5 bars" — small grammar helper. */
function countLabel(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * Summary for a {@link GroupStat} bar chart (entry hour, weekday, setup,
 * instrument, segment, direction…). Names the chart, the best and worst groups
 * by net P&L, and the group count.
 */
export function groupBarAriaSummary(title: string, stats: GroupStat[]): string {
  if (stats.length === 0) return `${title}: not enough data yet.`;
  const sorted = [...stats].sort((a, b) => b.netPnl - a.netPnl);
  const best = sorted[0]!;
  const worst = sorted[sorted.length - 1]!;
  const head = `${title}, bar chart of net profit and loss across ${countLabel(stats.length, "group")}.`;
  const bestPart = `Best: ${best.key} at ${formatINR(best.netPnl, { signed: true })} over ${countLabel(best.trades, "trade")}.`;
  if (stats.length === 1) return `${head} ${bestPart}`;
  const worstPart = `Worst: ${worst.key} at ${formatINR(worst.netPnl, { signed: true })} over ${countLabel(worst.trades, "trade")}.`;
  return `${head} ${bestPart} ${worstPart}`;
}

/** Summary for the R-multiple distribution histogram. */
export function rHistogramAriaSummary(buckets: { bucket: string; count: number }[]): string {
  if (buckets.length === 0) return "R-multiple distribution: not enough data yet.";
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const peak = buckets.reduce((a, b) => (b.count > a.count ? b : a), buckets[0]!);
  return `R-multiple distribution histogram of ${countLabel(total, "trade")}. Most common outcome: ${peak.bucket} with ${countLabel(peak.count, "trade")}.`;
}

/** Summary for the cumulative equity (net-P&L) curve. */
export function equityCurveAriaSummary(points: { date: string; equity: number }[]): string {
  if (points.length < 2) return "Equity curve: log a few trades to see your curve.";
  const last = points[points.length - 1]!.equity;
  const peak = points.reduce((m, p) => Math.max(m, p.equity), -Infinity);
  const trough = points.reduce((m, p) => Math.min(m, p.equity), Infinity);
  return `Equity curve, cumulative net profit and loss over ${countLabel(points.length - 1, "step")}. Ends at ${formatINR(last, { signed: true })}. Peak ${formatINR(peak, { signed: true })}, low ${formatINR(trough, { signed: true })}.`;
}

/**
 * Summary for the backtest HERO equity curve: cumulative net P&L by trade-day
 * with the underwater drawdown band beneath. States the ending equity, the peak,
 * and the deepest drawdown — the headline numbers a sighted user reads off the
 * two areas.
 */
export function backtestEquityAriaSummary(curve: { ts: number; equity: number }[]): string {
  if (curve.length < 2) return "Backtest equity curve: not enough data yet.";
  const last = curve[curve.length - 1]!.equity;
  let peak = curve[0]!.equity;
  let maxDrawdown = 0;
  for (const p of curve) {
    if (p.equity > peak) peak = p.equity;
    const dd = p.equity - peak;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }
  return `Backtest equity curve, cumulative net profit and loss over ${countLabel(curve.length - 1, "trade-day")} with the drawdown band beneath. Ends at ${formatINR(last, { signed: true })}, peak ${formatINR(peak, { signed: true })}, deepest drawdown ${formatINR(maxDrawdown, { signed: true })}.`;
}

/**
 * Summary for the walk-forward IS/OOS equity curve: cumulative equity split at
 * the train→test boundary. States the in-sample versus out-of-sample ending
 * equity so a screen-reader user gets the same hold/degrade signal the two
 * shaded areas convey.
 */
export function walkForwardAriaSummary(
  curve: { isEquity: number | null; oosEquity: number | null }[]
): string {
  if (curve.length === 0) return "Walk-forward equity curve: not enough data yet.";
  let isEnd: number | null = null;
  let oosEnd: number | null = null;
  for (const p of curve) {
    if (p.isEquity != null) isEnd = p.isEquity;
    if (p.oosEquity != null) oosEnd = p.oosEquity;
  }
  const isPart = isEnd != null ? `In-sample ends at ${formatINR(isEnd, { signed: true })}.` : "";
  const oosPart =
    oosEnd != null
      ? ` Out-of-sample ends at ${formatINR(oosEnd, { signed: true })}.`
      : " No out-of-sample segment yet.";
  return `Walk-forward equity curve, cumulative net profit and loss split at the train to test boundary. ${isPart}${oosPart}`;
}

/**
 * Summary for the journal-compare overlay: your real journaled equity versus the
 * mechanical-baseline equity over the union of trading days. States both ending
 * equities and the gap — descriptive only, never which one is "right".
 */
export function compareOverlayAriaSummary(
  overlay: { real: number | null; baseline: number | null }[]
): string {
  if (overlay.length === 0) return "Journal versus baseline overlay: not enough data yet.";
  let realEnd: number | null = null;
  let baselineEnd: number | null = null;
  for (const p of overlay) {
    if (p.real != null) realEnd = p.real;
    if (p.baseline != null) baselineEnd = p.baseline;
  }
  const realPart =
    realEnd != null ? `Your trading ends at ${formatINR(realEnd, { signed: true })}.` : "";
  const basePart =
    baselineEnd != null
      ? ` Mechanical baseline ends at ${formatINR(baselineEnd, { signed: true })}.`
      : " No baseline segment yet.";
  const gapPart =
    realEnd != null && baselineEnd != null
      ? ` Gap ${formatINR(realEnd - baselineEnd, { signed: true })}.`
      : "";
  return `Your trading versus mechanical baseline, cumulative net profit and loss over ${countLabel(overlay.length, "trading day")}. ${realPart}${basePart}${gapPart}`;
}

/** Summary for the per-day discipline-score trend line (0–100). */
export function disciplineTrendAriaSummary(
  days: { date: string; score: number }[],
  average: number | null
): string {
  if (days.length === 0) return "Discipline score trend: not enough data yet.";
  const current = days[days.length - 1]!.score;
  const avgPart = average != null ? ` Average ${average} out of 100.` : "";
  return `Discipline score trend over ${countLabel(days.length, "day")}, scored out of 100. Latest ${current}.${avgPart}`;
}

/** Summary for a single Monte-Carlo equity cone (R units). */
export function equityConeAriaSummary(
  cone: { p5: number; p50: number; p95: number }[],
  startEquity: number
): string {
  if (cone.length === 0) return "Monte Carlo equity cone: not enough data yet.";
  const last = cone[cone.length - 1]!;
  return `Monte Carlo equity cone over ${countLabel(cone.length - 1, "trade")}, starting at ${formatNumber(startEquity, 0)}R. Projected end: median ${formatNumber(last.p50, 1)}R, pessimistic 5th percentile ${formatNumber(last.p5, 1)}R, optimistic 95th percentile ${formatNumber(last.p95, 1)}R.`;
}

/** Summary for a payoff-at-expiry diagram. */
export function payoffAriaSummary(args: {
  symbol: string;
  strategy: string;
  maxProfit: string;
  maxLoss: string;
  breakevens: number[];
}): string {
  const be =
    args.breakevens.length === 0
      ? "no breakeven"
      : `breakeven${args.breakevens.length === 1 ? "" : "s"} at ${args.breakevens
          .map((b) => formatNumber(b, 0))
          .join(" and ")}`;
  return `${args.symbol} ${args.strategy} payoff at expiry. Max profit ${args.maxProfit}, max loss ${args.maxLoss}, ${be}.`;
}

/**
 * The accessible value of a NumberFlow stat tile. NumberFlow paints its digits
 * `aria-hidden`, so the visible value is invisible to a screen reader — the
 * caller renders this string on an `aria-label` wrapper and hides the visual
 * NumberFlow. Mirrors NumberFlow's own Intl formatting so the two never drift.
 */
export function statTileAriaValue(
  value: number,
  opts?: { format?: Intl.NumberFormatOptions; prefix?: string; suffix?: string; locale?: string }
): string {
  const formatted = new Intl.NumberFormat(opts?.locale ?? "en-IN", opts?.format).format(value);
  return `${opts?.prefix ?? ""}${formatted}${opts?.suffix ?? ""}`;
}

/** A weekday × hour heatmap cell label — never relies on colour. */
export function heatCellAriaLabel(args: {
  weekday: string;
  hour: number;
  trades: number;
  winRate: number;
  netPnl: number;
  minSample: number;
}): string {
  const slot = `${args.weekday} ${String(args.hour).padStart(2, "0")}:00`;
  if (args.trades === 0) return `${slot}: no trades`;
  if (args.trades < args.minSample) {
    return `${slot}: only ${countLabel(args.trades, "trade")}, need ${args.minSample}`;
  }
  return `${slot}: ${countLabel(args.trades, "trade")}, ${formatPct(args.winRate, 0)} win rate, ${formatINR(args.netPnl, { signed: true })}`;
}

/** A calendar month-heatmap day-cell label. */
export function calendarCellAriaLabel(dateKey: string, pnl: number | undefined): string {
  if (pnl == null) return `${dateKey}: no trades`;
  return `${dateKey}: ${formatINR(pnl, { signed: true })}`;
}
