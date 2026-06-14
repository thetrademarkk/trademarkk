/** Pure trading-performance statistics. All functions take closed trades. */

import { istDateKey } from "@/lib/tax/fy";

/**
 * Hour-of-day (0–23) and weekday (Sun=0…Sat=6) of an ISO instant in IST — the
 * timezone Indian brokers settle on (UTC+5:30, no DST). Shifting the instant by
 * the IST offset and reading the UTC getters gives IST wall-clock parts without
 * depending on the viewer's local zone (CORR-04). Falls back to local getters
 * only when the timestamp is unparseable.
 */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
function istHourWeekday(iso: string): { hour: number; weekday: number } {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) {
    const d = new Date(iso);
    return { hour: d.getHours(), weekday: d.getDay() };
  }
  const shifted = new Date(t + IST_OFFSET_MS);
  return { hour: shifted.getUTCHours(), weekday: shifted.getUTCDay() };
}

export interface TradeLike {
  id: string;
  net_pnl: number;
  gross_pnl: number;
  r_multiple: number | null;
  opened_at: string;
  closed_at: string | null;
  status: string;
  symbol: string;
  segment: string;
  direction: string;
  playbook_id: string | null;
  /** Optional — needed only by the "More statistics" pack. */
  qty?: number;
  avg_entry?: number;
  confidence?: number | null;
}

export const closedOnly = <T extends TradeLike>(trades: T[]): T[] =>
  trades.filter((t) => t.status === "closed");

export function netPnl(trades: TradeLike[]): number {
  return trades.reduce((s, t) => s + t.net_pnl, 0);
}

export function winRate(trades: TradeLike[]): number {
  if (trades.length === 0) return 0;
  return trades.filter((t) => t.net_pnl > 0).length / trades.length;
}

export function profitFactor(trades: TradeLike[]): number {
  const wins = trades.filter((t) => t.net_pnl > 0).reduce((s, t) => s + t.net_pnl, 0);
  const losses = Math.abs(trades.filter((t) => t.net_pnl < 0).reduce((s, t) => s + t.net_pnl, 0));
  if (losses === 0) return wins > 0 ? Infinity : 0;
  return wins / losses;
}

/** Expectancy = average net P&L per trade. */
export function expectancy(trades: TradeLike[]): number {
  if (trades.length === 0) return 0;
  return netPnl(trades) / trades.length;
}

export function avgR(trades: TradeLike[]): number | null {
  const withR = trades.filter((t) => t.r_multiple != null);
  if (withR.length === 0) return null;
  return withR.reduce((s, t) => s + (t.r_multiple ?? 0), 0) / withR.length;
}

export function avgWinLoss(trades: TradeLike[]): { avgWin: number; avgLoss: number } {
  const wins = trades.filter((t) => t.net_pnl > 0);
  const losses = trades.filter((t) => t.net_pnl < 0);
  return {
    avgWin: wins.length ? netPnl(wins) / wins.length : 0,
    avgLoss: losses.length ? netPnl(losses) / losses.length : 0,
  };
}

export interface EquityPoint {
  date: string;
  equity: number;
  pnl: number;
}

/** Cumulative equity curve by close date (sorted ascending). */
export function equityCurve(trades: TradeLike[], startingCapital = 0): EquityPoint[] {
  const daily = dailyPnl(trades);
  const dates = [...daily.keys()].sort();
  let equity = startingCapital;
  return dates.map((date) => {
    const pnl = daily.get(date) ?? 0;
    equity += pnl;
    return { date, equity, pnl };
  });
}

/**
 * Prepend a starting-capital point one day before the first trading day.
 * Cumulative P&L starts at zero, so a single day of trades still renders
 * as a curve instead of an invisible lone point.
 */
export function withStartBaseline(points: EquityPoint[], startingCapital = 0): EquityPoint[] {
  if (points.length === 0) return points;
  const dayBefore = new Date(points[0]!.date + "T12:00:00Z");
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  return [
    { date: dayBefore.toISOString().slice(0, 10), equity: startingCapital, pnl: 0 },
    ...points,
  ];
}

/**
 * Map of YYYY-MM-DD → net P&L for that day, bucketed by the IST calendar date of
 * the close (CORR-03). ISO timestamps are stored in UTC, so a trade closed at
 * 2026-03-31T20:00:00Z is 2026-04-01 IST — keying on the raw UTC date would put
 * 00:00–05:30 IST closes on the previous day and disagree with horizon/FY/spans,
 * which all bucket in IST. The equity curve inherits this via dailyPnl.
 */
export function dailyPnl(trades: TradeLike[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of trades) {
    if (!t.closed_at) continue;
    const d = istDateKey(t.closed_at);
    map.set(d, (map.get(d) ?? 0) + t.net_pnl);
  }
  return map;
}

export function maxDrawdown(curve: EquityPoint[]): number {
  let peak = -Infinity;
  let maxDd = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.equity);
    maxDd = Math.max(maxDd, peak - p.equity);
  }
  return maxDd;
}

export interface StreakInfo {
  current: number; // positive = win streak, negative = loss streak
  longestWin: number;
  longestLoss: number;
}

export function streaks(trades: TradeLike[]): StreakInfo {
  const sorted = [...trades]
    .filter((t) => t.closed_at)
    .sort((a, b) => (a.closed_at! < b.closed_at! ? -1 : 1));
  let current = 0;
  let longestWin = 0;
  let longestLoss = 0;
  for (const t of sorted) {
    if (t.net_pnl > 0) current = current > 0 ? current + 1 : 1;
    else if (t.net_pnl < 0) current = current < 0 ? current - 1 : -1;
    else continue;
    longestWin = Math.max(longestWin, current);
    longestLoss = Math.min(longestLoss, current);
  }
  return { current, longestWin, longestLoss: Math.abs(longestLoss) };
}

export interface GroupStat {
  key: string;
  trades: number;
  netPnl: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
}

export function groupBy(trades: TradeLike[], keyFn: (t: TradeLike) => string): GroupStat[] {
  const groups = new Map<string, TradeLike[]>();
  for (const t of trades) {
    const k = keyFn(t);
    const arr = groups.get(k);
    if (arr) arr.push(t);
    else groups.set(k, [t]);
  }
  return [...groups.entries()]
    .map(([key, ts]) => ({
      key,
      trades: ts.length,
      netPnl: netPnl(ts),
      winRate: winRate(ts),
      profitFactor: profitFactor(ts),
      expectancy: expectancy(ts),
    }))
    .sort((a, b) => b.netPnl - a.netPnl);
}

// Entry-time grouping is bucketed in IST (CORR-04) so the day/hour stats match
// the trading session the user actually traded, independent of the viewer's
// local timezone.
export const byHourOfDay = (trades: TradeLike[]) =>
  groupBy(trades, (t) => {
    const h = istHourWeekday(t.opened_at).hour;
    return `${String(h).padStart(2, "0")}:00`;
  }).sort((a, b) => a.key.localeCompare(b.key));

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const byWeekday = (trades: TradeLike[]) =>
  groupBy(trades, (t) => WEEKDAYS[istHourWeekday(t.opened_at).weekday] ?? "?").sort(
    (a, b) => WEEKDAYS.indexOf(a.key) - WEEKDAYS.indexOf(b.key)
  );

export const bySymbol = (trades: TradeLike[]) => groupBy(trades, (t) => t.symbol);

/**
 * Options trades on expiry day vs other days — the classic Indian FnO question.
 * The expiry date is an IST calendar day, so the entry is compared against the
 * IST date of `opened_at` (CORR-04), not its raw UTC date.
 */
export const byExpiryDay = (trades: (TradeLike & { expiry?: string | null })[]) =>
  groupBy(
    trades.filter((t) => t.segment === "OPT" && t.expiry),
    (t) =>
      (t as { expiry?: string | null }).expiry === istDateKey(t.opened_at)
        ? "Expiry day"
        : "Before expiry"
  );
export const bySegment = (trades: TradeLike[]) => groupBy(trades, (t) => t.segment);
export const byDirection = (trades: TradeLike[]) => groupBy(trades, (t) => t.direction);

/** R-multiple histogram buckets. */
export function rHistogram(trades: TradeLike[]): { bucket: string; count: number }[] {
  const buckets = new Map<string, number>();
  const order: string[] = [];
  const label = (r: number) => {
    if (r <= -2) return "≤ -2R";
    if (r >= 3) return "≥ 3R";
    const lo = Math.floor(r * 2) / 2;
    return `${lo}R`;
  };
  for (const t of trades) {
    if (t.r_multiple == null) continue;
    const l = label(t.r_multiple);
    if (!buckets.has(l)) order.push(l);
    buckets.set(l, (buckets.get(l) ?? 0) + 1);
  }
  return order
    .sort((a, b) => parseFloat(a) - parseFloat(b))
    .map((bucket) => ({ bucket, count: buckets.get(bucket) ?? 0 }));
}

/* ────────────────────────────────────────────────────────────────────────
 * More statistics pack — duration buckets, day×time heatmap, streak-length
 * distribution, expectancy-by-confidence, R-percentiles, position sizing.
 * All pure; every bucket carries its own sample count so the UI can gate
 * honesty (MIN_SAMPLE) and show a "not enough data" state per bucket.
 * ──────────────────────────────────────────────────────────────────────── */

/** Minimum trades behind a bucket before it counts as signal, not noise. */
export const MIN_SAMPLE = 5;

const holdMs = (t: TradeLike): number | null => {
  if (!t.closed_at) return null;
  const ms = new Date(t.closed_at).getTime() - new Date(t.opened_at).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
};

export interface DurationBucket {
  /** Bucket label, e.g. "<1m", "1–5m". */
  key: string;
  trades: number;
  netPnl: number;
  /** Average net P&L per trade in the bucket. */
  avgPnl: number;
  winRate: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// Upper bound (exclusive) for each bucket; the last bucket catches the rest.
const DURATION_EDGES: { key: string; max: number }[] = [
  { key: "<1m", max: 1 * MIN },
  { key: "1–5m", max: 5 * MIN },
  { key: "5–30m", max: 30 * MIN },
  { key: "30m–2h", max: 2 * HOUR },
  { key: "2h–1d", max: 1 * DAY },
  { key: ">1d", max: Infinity },
];

/** Which bucket a given hold-duration (ms) lands in. Boundaries are [lo, hi). */
export function durationBucketKey(ms: number): string {
  for (const e of DURATION_EDGES) {
    if (ms < e.max) return e.key;
  }
  return DURATION_EDGES[DURATION_EDGES.length - 1]!.key;
}

/** Count, total + average net P&L and win rate per hold-duration bucket. */
export function durationBuckets(trades: TradeLike[]): DurationBucket[] {
  const groups = new Map<string, TradeLike[]>();
  for (const t of trades) {
    const ms = holdMs(t);
    if (ms == null) continue;
    const key = durationBucketKey(ms);
    const arr = groups.get(key);
    if (arr) arr.push(t);
    else groups.set(key, [t]);
  }
  return DURATION_EDGES.filter((e) => groups.has(e.key)).map((e) => {
    const ts = groups.get(e.key)!;
    return {
      key: e.key,
      trades: ts.length,
      netPnl: netPnl(ts),
      avgPnl: expectancy(ts),
      winRate: winRate(ts),
    };
  });
}

export interface HeatCell {
  weekday: number; // 0 = Sun … 6 = Sat
  hour: number; // entry hour, 0–23, IST
  trades: number;
  netPnl: number;
  winRate: number;
}

/**
 * Weekday × entry-hour aggregation for the heatmap. Returns only populated
 * cells; the component lays them onto a fixed weekday×hour grid. Entry time is
 * `opened_at` in IST (CORR-04), matching byHourOfDay/byWeekday so the day-stats
 * tell the same story regardless of the viewer's local zone.
 */
export function dayTimeHeatmap(trades: TradeLike[]): HeatCell[] {
  const groups = new Map<string, TradeLike[]>();
  for (const t of trades) {
    const { hour: h, weekday: wd } = istHourWeekday(t.opened_at);
    if (Number.isNaN(wd) || Number.isNaN(h)) continue;
    const k = `${wd}:${h}`;
    const arr = groups.get(k);
    if (arr) arr.push(t);
    else groups.set(k, [t]);
  }
  return [...groups.entries()]
    .map(([k, ts]) => {
      const [wd, h] = k.split(":").map(Number) as [number, number];
      return { weekday: wd, hour: h, trades: ts.length, netPnl: netPnl(ts), winRate: winRate(ts) };
    })
    .sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);
}

export interface StreakLengthRow {
  /** Run length (1, 2, 3…). */
  length: number;
  /** How many separate win-runs of this length occurred. */
  wins: number;
  /** How many separate loss-runs of this length occurred. */
  losses: number;
}

/**
 * Distribution of completed streak lengths — "how often did a 3-win run
 * happen?". Trades are ordered by close time; scratches (net 0) break a run
 * without counting toward either side. A trailing run still counts.
 */
export function streakLengthDistribution(trades: TradeLike[]): StreakLengthRow[] {
  const sorted = [...trades]
    .filter((t) => t.closed_at)
    .sort((a, b) => (a.closed_at! < b.closed_at! ? -1 : 1));
  const wins = new Map<number, number>();
  const losses = new Map<number, number>();
  let run = 0; // signed: + win run, − loss run
  const flush = () => {
    if (run > 0) wins.set(run, (wins.get(run) ?? 0) + 1);
    else if (run < 0) losses.set(-run, (losses.get(-run) ?? 0) + 1);
    run = 0;
  };
  for (const t of sorted) {
    const dir = t.net_pnl > 0 ? 1 : t.net_pnl < 0 ? -1 : 0;
    if (dir === 0) {
      flush();
      continue;
    }
    if (run === 0 || Math.sign(run) === dir) run += dir;
    else {
      flush();
      run = dir;
    }
  }
  flush();
  const lengths = new Set<number>([...wins.keys(), ...losses.keys()]);
  return [...lengths]
    .sort((a, b) => a - b)
    .map((length) => ({
      length,
      wins: wins.get(length) ?? 0,
      losses: losses.get(length) ?? 0,
    }));
}

export interface ConfidenceBin {
  /** Confidence rating 1–5. */
  confidence: number;
  trades: number;
  winRate: number;
  /** Expectancy = average net P&L per trade in the bin. */
  expectancy: number;
  /** True once the bin clears MIN_SAMPLE; the UI suppresses the rest. */
  enough: boolean;
}

/**
 * Win% + expectancy per confidence rating (1–5). Surfaces over/under-confidence
 * — e.g. high win rate on the trades you rated "2". Bins below MIN_SAMPLE are
 * still returned but flagged `enough:false` so the UI can grey them out.
 */
export function expectancyByConfidence(trades: TradeLike[]): ConfidenceBin[] {
  const groups = new Map<number, TradeLike[]>();
  for (const t of trades) {
    const c = t.confidence;
    if (c == null || !Number.isInteger(c) || c < 1 || c > 5) continue;
    const arr = groups.get(c);
    if (arr) arr.push(t);
    else groups.set(c, [t]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([confidence, ts]) => ({
      confidence,
      trades: ts.length,
      winRate: winRate(ts),
      expectancy: expectancy(ts),
      enough: ts.length >= MIN_SAMPLE,
    }));
}

/**
 * Linear-interpolated percentile (R7 / numpy default) over a sorted numeric
 * array. p in [0,1]. Returns null for an empty array.
 */
export function percentile(sortedAsc: number[], p: number): number | null {
  const n = sortedAsc.length;
  if (n === 0) return null;
  if (n === 1) return sortedAsc[0]!;
  const rank = p * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const frac = rank - lo;
  return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * frac;
}

export interface RPercentiles {
  p10: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  /** Trades with a non-null R-multiple. */
  count: number;
}

/** p10/p25/median/p75/p90 of r_multiple over trades where it is set. */
export function rPercentiles(trades: TradeLike[]): RPercentiles | null {
  const rs = trades
    .map((t) => t.r_multiple)
    .filter((r): r is number => r != null && Number.isFinite(r))
    .sort((a, b) => a - b);
  if (rs.length === 0) return null;
  return {
    p10: percentile(rs, 0.1)!,
    p25: percentile(rs, 0.25)!,
    median: percentile(rs, 0.5)!,
    p75: percentile(rs, 0.75)!,
    p90: percentile(rs, 0.9)!,
    count: rs.length,
  };
}

export interface NotionalBucket {
  key: string;
  /** Lower edge of the bucket (₹ notional), for ordering. */
  lo: number;
  trades: number;
  netPnl: number;
  avgPnl: number;
  winRate: number;
}

/** Notional = qty × avg_entry (absolute). Null when either field is missing. */
const notionalOf = (t: TradeLike): number | null => {
  if (t.qty == null || t.avg_entry == null) return null;
  const n = Math.abs(t.qty * t.avg_entry);
  return Number.isFinite(n) ? n : null;
};

// ₹ notional edges (exclusive upper bound), tuned for Indian retail FnO sizing.
const NOTIONAL_EDGES: { key: string; max: number }[] = [
  { key: "<₹25k", max: 25_000 },
  { key: "₹25k–1L", max: 100_000 },
  { key: "₹1L–5L", max: 500_000 },
  { key: "₹5L–10L", max: 1_000_000 },
  { key: "₹10L–25L", max: 2_500_000 },
  { key: ">₹25L", max: Infinity },
];

/** Which notional bucket a value lands in. */
export function notionalBucketKey(notional: number): string {
  for (const e of NOTIONAL_EDGES) {
    if (notional < e.max) return e.key;
  }
  return NOTIONAL_EDGES[NOTIONAL_EDGES.length - 1]!.key;
}

/**
 * Position-size analysis: win rate + average P&L by notional bucket
 * (qty × avg_entry), to flag over/under-sizing. Trades missing qty/avg_entry
 * are skipped.
 */
export function notionalBuckets(trades: TradeLike[]): NotionalBucket[] {
  const groups = new Map<string, TradeLike[]>();
  for (const t of trades) {
    const n = notionalOf(t);
    if (n == null) continue;
    const key = notionalBucketKey(n);
    const arr = groups.get(key);
    if (arr) arr.push(t);
    else groups.set(key, [t]);
  }
  return NOTIONAL_EDGES.filter((e) => groups.has(e.key)).map((e) => {
    const idx = NOTIONAL_EDGES.indexOf(e);
    const ts = groups.get(e.key)!;
    return {
      key: e.key,
      lo: idx === 0 ? 0 : NOTIONAL_EDGES[idx - 1]!.max,
      trades: ts.length,
      netPnl: netPnl(ts),
      avgPnl: expectancy(ts),
      winRate: winRate(ts),
    };
  });
}
