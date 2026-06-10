/** Pure trading-performance statistics. All functions take closed trades. */

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

/** Map of YYYY-MM-DD → net P&L for that day (by close time). */
export function dailyPnl(trades: TradeLike[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of trades) {
    if (!t.closed_at) continue;
    const d = t.closed_at.slice(0, 10);
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

export const byHourOfDay = (trades: TradeLike[]) =>
  groupBy(trades, (t) => {
    const h = new Date(t.opened_at).getHours();
    return `${String(h).padStart(2, "0")}:00`;
  }).sort((a, b) => a.key.localeCompare(b.key));

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const byWeekday = (trades: TradeLike[]) =>
  groupBy(trades, (t) => WEEKDAYS[new Date(t.opened_at).getDay()] ?? "?").sort(
    (a, b) => WEEKDAYS.indexOf(a.key) - WEEKDAYS.indexOf(b.key)
  );

export const bySymbol = (trades: TradeLike[]) => groupBy(trades, (t) => t.symbol);
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
