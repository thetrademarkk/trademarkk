/**
 * Derived equity + underwater (drawdown) series for the HERO chart and the Risk
 * tab, plus the top drawdown episodes. Pure & deterministic.
 *
 * The RunResult stores `equityCurve` as cumulative net by day (ts, equity). The
 * underwater series is `equity − runningPeak`, always ≤ 0, on the SAME x-axis —
 * exactly the TradingView canon the spec calls for. We also surface the top-N
 * peak-to-trough episodes for the Risk tab's drawdown-periods table.
 */

import type { EquityPoint } from "@/features/backtest/shared/run-result";

export interface HeroPoint {
  ts: number;
  /** "YYYY-MM-DD" derived from ts (IST day key) for axis labels. */
  day: string;
  equity: number;
  /** Underwater value = equity − running peak (≤ 0). */
  drawdown: number;
}

function dayKey(ts: number): string {
  // ts is an IST minute-boundary epoch-ms; the day is its UTC+5:30 calendar date.
  const d = new Date(ts + 5.5 * 3600_000);
  return d.toISOString().slice(0, 10);
}

/** Build the shared-axis equity + underwater series. */
export function buildHeroSeries(curve: EquityPoint[]): HeroPoint[] {
  let peak = curve.length ? curve[0]!.equity : 0;
  if (peak < 0) peak = 0; // peak starts at the better of 0 / first equity
  return curve.map((p) => {
    if (p.equity > peak) peak = p.equity;
    return {
      ts: p.ts,
      day: dayKey(p.ts),
      equity: p.equity,
      drawdown: Math.round((p.equity - peak) * 100) / 100,
    };
  });
}

export interface DrawdownEpisode {
  /** Depth (negative rupees, peak − trough). */
  depth: number;
  /** Duration in points (days) from peak to recovery (or end). */
  durationDays: number;
  startTs: number;
  troughTs: number;
}

/**
 * Top-N peak-to-trough drawdown episodes, deepest first. An episode runs from a
 * peak, through its trough, until equity reclaims that peak (or the series ends).
 */
export function topDrawdownEpisodes(curve: EquityPoint[], n = 5): DrawdownEpisode[] {
  if (curve.length === 0) return [];
  const episodes: DrawdownEpisode[] = [];
  let peak = curve[0]!.equity;
  let peakIdx = 0;
  let troughVal = curve[0]!.equity;
  let troughIdx = 0;
  let inDd = false;

  const close = (recoverIdx: number) => {
    if (!inDd) return;
    episodes.push({
      depth: Math.round((troughVal - peak) * 100) / 100,
      durationDays: recoverIdx - peakIdx,
      startTs: curve[peakIdx]!.ts,
      troughTs: curve[troughIdx]!.ts,
    });
    inDd = false;
  };

  for (let i = 1; i < curve.length; i++) {
    const eq = curve[i]!.equity;
    if (eq >= peak) {
      close(i);
      peak = eq;
      peakIdx = i;
    } else {
      if (!inDd) {
        inDd = true;
        troughVal = eq;
        troughIdx = i;
      } else if (eq < troughVal) {
        troughVal = eq;
        troughIdx = i;
      }
    }
  }
  close(curve.length - 1);

  return episodes
    .filter((e) => e.depth < 0)
    .sort((a, b) => a.depth - b.depth)
    .slice(0, n);
}
