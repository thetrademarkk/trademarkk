/**
 * Volatility indicators — ATR, NATR, Bollinger Bands, Keltner Channels,
 * Donchian Channels, rolling StdDev, Chaikin Volatility.
 *
 * Pure, deterministic, dependency-free. Output aligned to input length; NaN
 * during warmup; no look-ahead (out[i] depends only on bars[0..i]). Composes
 * from ./smoothing primitives (sma/ema/wilderSmooth) rather than reinventing.
 *
 * Seeding choices (pinned, per design doc — stated per indicator below):
 *  - ATR/NATR: Wilder smoothing (alpha = 1/period) with an SMA seed over the
 *    first `period` True-Range values. TR starts at index 1 (needs prior close),
 *    so the first ATR lands at index `period`. (TA-Lib parity.)
 *  - Bollinger basis + StdDev: SMA basis; population standard deviation
 *    (ddof = 0) to match TA-Lib BBANDS / STDDEV. First value at index period-1.
 *  - Keltner: EMA basis (2/(n+1), SMA seed) +/- mult * ATR(period). Because the
 *    ATR warmup (index period) is one bar longer than the EMA warmup
 *    (index period-1), the bands' first non-NaN is at index `period`.
 *  - Donchian: rolling max(high)/min(low) over a window INCLUDING the current
 *    bar; first value at index period-1.
 *  - Chaikin Volatility: EMA(high-low, period) then percent rate-of-change over
 *    `period` bars; first value at index 2*period-1.
 *
 * References (declared per indicator, asserted in volatility.test.ts):
 *  - ATR / NATR / Bollinger / StdDev: TA-Lib 0.6.8 (offline pandas oracle).
 *  - Keltner: TradingView Pine `ta` Keltner formula (EMA basis + ATR band),
 *    composed from TA-Lib EMA + ATR primitives.
 *  - Donchian: StockCharts / standard price-channel definition (rolling
 *    high/low), composed from numpy rolling max/min.
 *  - Chaikin Volatility: Marc Chaikin / Metastock-StockCharts formula
 *    (percent ROC of an EMA of the high-low range), composed from TA-Lib EMA.
 */

import { ema, sma } from "./smoothing";
import type { IndicatorDef } from "./registry";
import { assertPeriod, type IndicatorStream, type MultiIndicatorStream, type OHLCV } from "./types";

/**
 * True Range series. tr[0] = NaN (no prior close); for i>=1:
 *   TR = max(high-low, |high-prevClose|, |low-prevClose|)
 * Reference: Wilder 1978.
 */
export function trueRange(bars: readonly OHLCV[]): number[] {
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    const h = bars[i]!.high;
    const l = bars[i]!.low;
    const pc = bars[i - 1]!.close;
    out[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return out;
}

/**
 * Average True Range (Wilder, 1978). Wilder-smoothed TR with α = 1/period and
 * an SMA seed over the first `period` TRs. TR begins at index 1, so the first
 * ATR lands at index `period`.
 * Reference: TA-Lib ATR (0.6.8).
 */
export function atr(bars: readonly OHLCV[], period: number): number[] {
  assertPeriod(period);
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < period + 1) return out;
  const tr = trueRange(bars);
  // Seed: SMA of TR[1..period].
  let seed = 0;
  for (let i = 1; i <= period; i++) seed += tr[i]!;
  let prev = seed / period;
  out[period] = prev;
  for (let i = period + 1; i < n; i++) {
    prev = prev + (tr[i]! - prev) / period;
    out[i] = prev;
  }
  return out;
}

/**
 * Normalized ATR: 100 * ATR / close. Same warmup as ATR.
 * Reference: TA-Lib NATR (0.6.8).
 */
export function natr(bars: readonly OHLCV[], period: number): number[] {
  const a = atr(bars, period);
  return a.map((v, i) => (Number.isNaN(v) ? NaN : (100 * v) / bars[i]!.close));
}

/** Streaming ATR — Wilder-smoothed TR, reproduces atr() exactly. */
export function createATR(period: number): IndicatorStream<OHLCV> {
  assertPeriod(period);
  let prevClose = NaN;
  let count = 0; // bars seen
  let seedSum = 0;
  let prev = NaN;
  return {
    push(bar: OHLCV): number {
      count++;
      if (count === 1) {
        prevClose = bar.close;
        return NaN;
      }
      const tr = Math.max(
        bar.high - bar.low,
        Math.abs(bar.high - prevClose),
        Math.abs(bar.low - prevClose)
      );
      prevClose = bar.close;
      const trIndex = count - 1; // TR count (1-based)
      if (trIndex < period) {
        seedSum += tr;
        return NaN;
      }
      if (trIndex === period) {
        seedSum += tr;
        prev = seedSum / period;
        return prev;
      }
      prev = prev + (tr - prev) / period;
      return prev;
    },
  };
}

/**
 * Population standard deviation (ddof = 0) over a rolling window. Matches
 * TA-Lib STDDEV(nbdev=1). First value at index period-1.
 *   stddev[i] = sqrt(mean(x^2) - mean(x)^2) over the window.
 * Reference: TA-Lib STDDEV (0.6.8).
 */
export function stddev(x: readonly number[], period: number): number[] {
  assertPeriod(period);
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = x[i]!;
    sum += v;
    sumSq += v * v;
    if (i >= period) {
      const old = x[i - period]!;
      sum -= old;
      sumSq -= old * old;
    }
    if (i >= period - 1) {
      const mean = sum / period;
      const variance = sumSq / period - mean * mean;
      out[i] = Math.sqrt(Math.max(0, variance));
    }
  }
  return out;
}

/** Bollinger Bands output: basis (mid), upper, lower, %B and bandwidth. */
export interface BollingerBands {
  middle: number[];
  upper: number[];
  lower: number[];
  /** %B = (close - lower) / (upper - lower). */
  percentB: number[];
  /** Bandwidth = (upper - lower) / middle. */
  bandwidth: number[];
}

/**
 * Bollinger Bands. Basis = SMA(close, period); band = mult * population stddev.
 *   upper = basis + mult*sd;  lower = basis - mult*sd
 *   %B    = (close - lower) / (upper - lower)
 *   bw    = (upper - lower) / basis
 * First value at index period-1. Population stddev (ddof = 0) for TA-Lib parity.
 * Reference: TA-Lib BBANDS (0.6.8), matype = SMA.
 */
export function bollinger(x: readonly number[], period: number, mult = 2): BollingerBands {
  assertPeriod(period);
  const n = x.length;
  const middle = sma(x, period);
  const sd = stddev(x, period);
  const upper = new Array<number>(n).fill(NaN);
  const lower = new Array<number>(n).fill(NaN);
  const percentB = new Array<number>(n).fill(NaN);
  const bandwidth = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(middle[i]!)) continue;
    const u = middle[i]! + mult * sd[i]!;
    const l = middle[i]! - mult * sd[i]!;
    upper[i] = u;
    lower[i] = l;
    const width = u - l;
    percentB[i] = width === 0 ? 0 : (x[i]! - l) / width;
    bandwidth[i] = middle[i] === 0 ? NaN : width / middle[i]!;
  }
  return { middle, upper, lower, percentB, bandwidth };
}

/** Keltner Channels output. */
export interface KeltnerChannels {
  middle: number[];
  upper: number[];
  lower: number[];
}

/**
 * Keltner Channels. Basis = EMA(close, period); band = mult * ATR(period).
 *   upper = basis + mult*ATR;  lower = basis - mult*ATR
 * The EMA basis warms at index period-1 but the ATR warms at index period, so
 * the bands' first non-NaN is at index `period`.
 * Reference: TradingView Pine `ta` Keltner (EMA basis + ATR band).
 */
export function keltner(bars: readonly OHLCV[], period: number, mult = 2): KeltnerChannels {
  assertPeriod(period);
  const n = bars.length;
  const basis = ema(
    bars.map((b) => b.close),
    period
  );
  const a = atr(bars, period);
  const middle = basis.slice();
  const upper = new Array<number>(n).fill(NaN);
  const lower = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(basis[i]!) || Number.isNaN(a[i]!)) continue;
    upper[i] = basis[i]! + mult * a[i]!;
    lower[i] = basis[i]! - mult * a[i]!;
  }
  return { middle, upper, lower };
}

/** Donchian Channels output. */
export interface DonchianChannels {
  upper: number[];
  lower: number[];
  middle: number[];
}

/**
 * Donchian Channels. Rolling extremes over a window INCLUDING the current bar.
 *   upper = max(high[i-period+1..i]);  lower = min(low[i-period+1..i])
 *   middle = (upper + lower) / 2
 * First value at index period-1.
 * Reference: StockCharts / standard price-channel definition.
 */
export function donchian(bars: readonly OHLCV[], period: number): DonchianChannels {
  assertPeriod(period);
  const n = bars.length;
  const upper = new Array<number>(n).fill(NaN);
  const lower = new Array<number>(n).fill(NaN);
  const middle = new Array<number>(n).fill(NaN);
  for (let i = period - 1; i < n; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j]!.high > hi) hi = bars[j]!.high;
      if (bars[j]!.low < lo) lo = bars[j]!.low;
    }
    upper[i] = hi;
    lower[i] = lo;
    middle[i] = (hi + lo) / 2;
  }
  return { upper, lower, middle };
}

/**
 * Chaikin Volatility. Smooth the high-low range with an EMA, then take the
 * percent rate-of-change of that EMA over `period` bars:
 *   ema_hl = EMA(high - low, period)
 *   CV[i]  = 100 * (ema_hl[i] - ema_hl[i-period]) / ema_hl[i-period]
 * EMA warms at index period-1; the ROC needs `period` more bars, so the first
 * value lands at index 2*period-1. Div-by-zero (ema_hl[i-period] == 0) -> NaN.
 * Reference: Marc Chaikin / Metastock-StockCharts Chaikin Volatility.
 */
export function chaikinVolatility(bars: readonly OHLCV[], period: number): number[] {
  assertPeriod(period);
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  const hl = bars.map((b) => b.high - b.low);
  const emaHl = ema(hl, period);
  for (let i = period; i < n; i++) {
    const cur = emaHl[i]!;
    const past = emaHl[i - period]!;
    if (Number.isNaN(cur) || Number.isNaN(past) || past === 0) continue;
    out[i] = (100 * (cur - past)) / past;
  }
  return out;
}

/** Streaming Bollinger Bands — reproduces bollinger() exactly. */
export function createBollinger(
  period: number,
  mult = 2
): MultiIndicatorStream<number, BollingerBandsPoint> {
  assertPeriod(period);
  const buf: number[] = [];
  let sum = 0;
  let sumSq = 0;
  return {
    push(v: number): BollingerBandsPoint {
      buf.push(v);
      sum += v;
      sumSq += v * v;
      if (buf.length > period) {
        const old = buf.shift()!;
        sum -= old;
        sumSq -= old * old;
      }
      if (buf.length < period) {
        return { middle: NaN, upper: NaN, lower: NaN, percentB: NaN, bandwidth: NaN };
      }
      const mean = sum / period;
      const variance = sumSq / period - mean * mean;
      const sd = Math.sqrt(Math.max(0, variance));
      const upper = mean + mult * sd;
      const lower = mean - mult * sd;
      const width = upper - lower;
      return {
        middle: mean,
        upper,
        lower,
        percentB: width === 0 ? 0 : (v - lower) / width,
        bandwidth: mean === 0 ? NaN : width / mean,
      };
    },
  };
}

/** One streaming Bollinger sample. */
export interface BollingerBandsPoint {
  middle: number;
  upper: number;
  lower: number;
  percentB: number;
  bandwidth: number;
}

/** Indicator definitions contributed by this category. */
export const volatilityIndicators: IndicatorDef[] = [
  {
    id: "atr",
    label: "Average True Range",
    category: "volatility",
    inputs: ["ohlcv"],
    params: [{ key: "period", label: "Period", type: "int", default: 14, min: 1 }],
    reference: "TA-Lib ATR (0.6.8) — Wilder smoothing, SMA-seeded TR",
    compute: (bars, p) => atr(bars, p.period ?? 14),
  },
  {
    id: "natr",
    label: "Normalized ATR",
    category: "volatility",
    inputs: ["ohlcv"],
    params: [{ key: "period", label: "Period", type: "int", default: 14, min: 1 }],
    reference: "TA-Lib NATR (0.6.8) — 100 * ATR / close",
    compute: (bars, p) => natr(bars, p.period ?? 14),
  },
  {
    id: "bbands",
    label: "Bollinger Bands",
    category: "volatility",
    inputs: ["close"],
    params: [
      { key: "period", label: "Period", type: "int", default: 20, min: 1 },
      { key: "mult", label: "StdDev Mult", type: "float", default: 2, min: 0 },
    ],
    reference: "TA-Lib BBANDS (0.6.8) — SMA basis, population stddev",
    compute: (bars, p) => {
      const b = bollinger(
        bars.map((x) => x.close),
        p.period ?? 20,
        p.mult ?? 2
      );
      return {
        middle: b.middle,
        upper: b.upper,
        lower: b.lower,
        percentB: b.percentB,
        bandwidth: b.bandwidth,
      };
    },
  },
  {
    id: "stddev",
    label: "Standard Deviation",
    category: "volatility",
    inputs: ["close"],
    params: [{ key: "period", label: "Period", type: "int", default: 20, min: 1 }],
    reference: "TA-Lib STDDEV (0.6.8) — population (ddof=0)",
    compute: (bars, p) =>
      stddev(
        bars.map((x) => x.close),
        p.period ?? 20
      ),
  },
  {
    id: "keltner",
    label: "Keltner Channels",
    category: "volatility",
    inputs: ["ohlcv"],
    params: [
      { key: "period", label: "Period", type: "int", default: 20, min: 1 },
      { key: "mult", label: "ATR Mult", type: "float", default: 2, min: 0 },
    ],
    reference: "TradingView Pine ta Keltner — EMA basis + ATR band",
    compute: (bars, p) => {
      const k = keltner(bars, p.period ?? 20, p.mult ?? 2);
      return { middle: k.middle, upper: k.upper, lower: k.lower };
    },
  },
  {
    id: "donchian",
    label: "Donchian Channels",
    category: "volatility",
    inputs: ["high", "low"],
    params: [{ key: "period", label: "Period", type: "int", default: 20, min: 1 }],
    reference: "StockCharts standard price-channel (rolling high/low)",
    compute: (bars, p) => {
      const d = donchian(bars, p.period ?? 20);
      return { upper: d.upper, lower: d.lower, middle: d.middle };
    },
  },
  {
    id: "chaikinvol",
    label: "Chaikin Volatility",
    category: "volatility",
    inputs: ["high", "low"],
    params: [{ key: "period", label: "Period", type: "int", default: 10, min: 1 }],
    reference: "Chaikin / Metastock-StockCharts — percent ROC of EMA(high-low)",
    compute: (bars, p) => chaikinVolatility(bars, p.period ?? 10),
  },
];
