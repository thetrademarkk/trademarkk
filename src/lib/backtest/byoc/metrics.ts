/**
 * BYOC metrics — score a list of user trades (entry/exit indices + side) against a
 * candle series into close-to-close % returns + headline stats. Pure + deterministic
 * so it is unit-tested directly. Returns are compounded into an equity curve; this
 * is a SPOT-series backtest (no charges/slippage yet — clearly an educational
 * first pass, surfaced honestly in the UI).
 */

import type { ByocBar, ByocScoredTrade, ByocStats, ByocTrade } from "./types";

/** Score trades + compute stats. Trades are assumed pre-validated (in range). */
export function scoreTrades(
  trades: ByocTrade[],
  bars: ByocBar[]
): { scored: ByocScoredTrade[]; stats: ByocStats } {
  const scored: ByocScoredTrade[] = trades.map((t) => {
    const entry = bars[t.entryIndex]!;
    const exit = bars[t.exitIndex]!;
    const dir = t.side === "long" ? 1 : -1;
    const ret = entry.c === 0 ? 0 : ((exit.c - entry.c) / entry.c) * dir;
    return {
      ...t,
      entryTime: entry.t,
      exitTime: exit.t,
      entryPrice: entry.c,
      exitPrice: exit.c,
      ret,
    };
  });

  const n = scored.length;
  const equity: number[] = [];
  let eq = 1;
  let peak = 1;
  let maxDrawdown = 0;
  let wins = 0;
  let sum = 0;
  let best = n ? -Infinity : 0;
  let worst = n ? Infinity : 0;

  for (const s of scored) {
    eq *= 1 + s.ret;
    equity.push(eq);
    if (eq > peak) peak = eq;
    const dd = peak === 0 ? 0 : (peak - eq) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
    if (s.ret > 0) wins++;
    sum += s.ret;
    if (s.ret > best) best = s.ret;
    if (s.ret < worst) worst = s.ret;
  }

  const avgReturn = n ? sum / n : 0;
  const stats: ByocStats = {
    trades: n,
    wins,
    winRate: n ? wins / n : 0,
    totalReturn: eq - 1,
    avgReturn,
    bestReturn: n ? best : 0,
    worstReturn: n ? worst : 0,
    maxDrawdown,
    equity,
    expectancy: avgReturn, // mean per-trade return (the per-trade edge)
  };
  return { scored, stats };
}
