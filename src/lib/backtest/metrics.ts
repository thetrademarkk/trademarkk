/**
 * Backtest performance metrics on a DAILY net-return series — NONE of these
 * exist in src/lib/stats/stats.ts today (that module computes journal stats over
 * trade lists; this computes portfolio metrics over an equity/return series).
 *
 * Implemented (06-engine-semantics §11.2 + the BT-04 brief): Sharpe, Sortino,
 * Calmar, MAR, max-drawdown (₹ + duration in days), exposure, turnover, plus the
 * supporting win-rate / expectancy / profit-factor over day-trades. percentile()
 * is REUSED from lib/stats — not re-implemented.
 *
 * Pure & deterministic. Money in rupees; returns are per-day net P&L (rupees) so
 * the ratios are "per-trade-day" ratios — annualization is applied with the
 * standard √(tradingDaysPerYear) factor (252) so Sharpe is comparable to other
 * tools. All ratios are 0 (not NaN/Infinity) when undefined (zero variance,
 * zero downside, zero drawdown) so the JSON output is always finite.
 */

import { percentile } from "../stats/stats";

/** Trading days per year — the annualization base for Sharpe/Sortino. */
export const TRADING_DAYS_PER_YEAR = 252;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export interface DailyReturn {
  /** "YYYY-MM-DD" IST trading day. */
  day: string;
  /** Net P&L booked that day (rupees). */
  net: number;
  /** Minutes the strategy was in a position that day (for exposure). */
  inPositionMinutes?: number;
  /** Notional turnover that day = Σ |fill price × qty| over entries+exits. */
  turnover?: number;
}

export interface BacktestMetrics {
  /** Annualized Sharpe ratio (mean/σ × √252). 0 if σ = 0. */
  sharpe: number;
  /** Annualized Sortino ratio (mean/downsideσ × √252). 0 if no downside. */
  sortino: number;
  /** Calmar = annualized return / |max drawdown|. 0 if no drawdown. */
  calmar: number;
  /** MAR = total net P&L / |max drawdown|. 0 if no drawdown. */
  mar: number;
  /** Max peak-to-trough drawdown (negative rupees). */
  maxDrawdown: number;
  /** Longest peak-to-recovery span, in trading days. */
  maxDrawdownDurationDays: number;
  /** Mean daily net (rupees). */
  meanDailyReturn: number;
  /** Sample standard deviation of daily net (rupees). */
  stdDailyReturn: number;
  /** Total net P&L over the run (rupees). */
  totalNet: number;
  /** Fraction of session minutes the strategy held a position, 0..1. */
  exposure: number;
  /** Σ notional turnover (rupees). */
  turnover: number;
  /** Days with net > 0, fraction 0..1. */
  winRate: number;
  /** Mean net per day (= meanDailyReturn). */
  expectancy: number;
  /** Σ positive net / |Σ negative net|. Capped large when no losses. */
  profitFactor: number;
}

/** Sample mean. */
export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** Sample standard deviation (n−1 denominator). 0 for <2 points. */
export function stddev(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  const ss = xs.reduce((s, x) => s + (x - m) * (x - m), 0);
  return Math.sqrt(ss / (n - 1));
}

/** Downside deviation (n−1 over negative-only deviations from 0). 0 if none. */
export function downsideDeviation(xs: number[], target = 0): number {
  const n = xs.length;
  if (n < 2) return 0;
  const ss = xs.reduce((s, x) => {
    const d = Math.min(0, x - target);
    return s + d * d;
  }, 0);
  return Math.sqrt(ss / (n - 1));
}

/**
 * Max drawdown over the cumulative equity built from daily nets, plus its
 * duration (longest peak→recovery span in days). Drawdown is reported as a
 * NEGATIVE number (peak − trough). If equity never recovers, duration runs to
 * the end of the series.
 */
export function maxDrawdownWithDuration(daily: DailyReturn[]): {
  maxDrawdown: number;
  durationDays: number;
} {
  if (daily.length === 0) return { maxDrawdown: 0, durationDays: 0 };
  let equity = 0;
  let peak = 0;
  let peakIdx = 0;
  let maxDd = 0;
  let durationDays = 0;
  let curDdStart = 0;
  let inDd = false;
  for (let i = 0; i < daily.length; i++) {
    equity += daily[i]!.net;
    if (equity >= peak) {
      // New high → any drawdown that started has now recovered.
      if (inDd) {
        durationDays = Math.max(durationDays, i - curDdStart);
        inDd = false;
      }
      peak = equity;
      peakIdx = i;
    } else {
      if (!inDd) {
        inDd = true;
        curDdStart = peakIdx;
      }
      const dd = equity - peak; // negative
      if (dd < maxDd) maxDd = dd;
    }
  }
  // Unrecovered drawdown runs to the end.
  if (inDd) durationDays = Math.max(durationDays, daily.length - 1 - curDdStart);
  return { maxDrawdown: r2(maxDd), durationDays };
}

/**
 * Compute the full metrics pack from the daily-return series.
 * `sessionMinutesPerDay` (default 375) is used for the exposure ratio.
 */
export function computeMetrics(daily: DailyReturn[], sessionMinutesPerDay = 375): BacktestMetrics {
  const nets = daily.map((d) => d.net);
  const totalNet = r2(nets.reduce((s, x) => s + x, 0));
  const m = mean(nets);
  const sd = stddev(nets);
  const dd = downsideDeviation(nets, 0);
  const ann = Math.sqrt(TRADING_DAYS_PER_YEAR);

  const sharpe = sd > 0 ? r4((m / sd) * ann) : 0;
  const sortino = dd > 0 ? r4((m / dd) * ann) : 0;

  const { maxDrawdown, durationDays } = maxDrawdownWithDuration(daily);
  const absDd = Math.abs(maxDrawdown);
  const annualizedReturn = m * TRADING_DAYS_PER_YEAR;
  const calmar = absDd > 0 ? r4(annualizedReturn / absDd) : 0;
  const mar = absDd > 0 ? r4(totalNet / absDd) : 0;

  const wins = nets.filter((x) => x > 0);
  const losses = nets.filter((x) => x < 0);
  const grossWin = wins.reduce((s, x) => s + x, 0);
  const grossLoss = Math.abs(losses.reduce((s, x) => s + x, 0));
  const profitFactor = grossLoss > 0 ? r4(grossWin / grossLoss) : grossWin > 0 ? 9999 : 0;
  const winRate = nets.length > 0 ? r4(wins.length / nets.length) : 0;

  const totalInPos = daily.reduce((s, d) => s + (d.inPositionMinutes ?? 0), 0);
  const totalAvail = daily.length * sessionMinutesPerDay;
  const exposure = totalAvail > 0 ? r4(Math.min(1, totalInPos / totalAvail)) : 0;
  const turnover = r2(daily.reduce((s, d) => s + (d.turnover ?? 0), 0));

  return {
    sharpe,
    sortino,
    calmar,
    mar,
    maxDrawdown,
    maxDrawdownDurationDays: durationDays,
    meanDailyReturn: r2(m),
    stdDailyReturn: r2(sd),
    totalNet,
    exposure,
    turnover,
    winRate,
    expectancy: r2(m),
    profitFactor,
  };
}

/** Median daily return — exposed for the results screen (reuses percentile). */
export function medianDailyReturn(daily: DailyReturn[]): number {
  const sorted = [...daily.map((d) => d.net)].sort((a, b) => a - b);
  return r2(percentile(sorted, 0.5) ?? 0);
}
