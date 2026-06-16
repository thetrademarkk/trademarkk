/**
 * Statistical indicators — rolling regression, correlation, dispersion, rank
 * and price-derived series.
 *
 * Category file (the foundation seeds the stub). These indicators are pure,
 * deterministic and dependency-free; each composes from first principles or the
 * shared smoothing primitives. Warmup prefix is NaN; no look-ahead.
 *
 * Pinned conventions (see types.ts / design doc 12-indicator-library.md):
 *  - Rolling stats use a window of the last `period` samples; out[i] depends
 *    only on x[0..i]. First non-NaN at index period-1 for window stats.
 *  - StdDev / z-score use POPULATION standard deviation (ddof = 0) to match
 *    TA-Lib STDDEV(nbdev=1). (Bollinger/StdDev parity.)
 *  - Linear regression is the ordinary least-squares fit over the window with
 *    x = 0..period-1; LINEARREG value is the fit AT the last point of the
 *    window (TA-Lib LINEARREG / LINEARREG_SLOPE parity).
 *  - Pivot points use the PRIOR bar's High/Low/Close (the previous period),
 *    emitted from index 1 onward (index 0 is NaN — no prior bar). Classic and
 *    Fibonacci variants per the standard published formulas.
 *
 * References per indicator (declared at each export and in the golden test):
 *  - LINEARREG / LINEARREG_SLOPE / CORREL / STDDEV / MIN / MAX / TRANGE /
 *    TYPPRICE: TA-Lib 0.6.8 (offline pandas oracle).
 *  - Z-score: composed from SMA + population StdDev, witnessed by TA-Lib
 *    SMA/STDDEV at 1e-6.
 *  - Percent-rank: standard rolling percentile-rank definition (count of window
 *    values strictly below the current value / period * 100), reference vector
 *    computed directly from the definition.
 *  - Pivot points (classic + fibonacci): standard published formulas
 *    (Investopedia / StockCharts pivot-point reference).
 */

import { assertPeriod, type IndicatorStream, type OHLCV } from "./types";
import { sma } from "./smoothing";
import type { IndicatorDef } from "./registry";

/**
 * Population standard deviation over a rolling window of `period` samples.
 *   sigma[i] = sqrt( mean(x_w^2) - mean(x_w)^2 ),  x_w = x[i-period+1 .. i]
 * ddof = 0 (population) to match TA-Lib STDDEV(nbdev=1). First value at index
 * period-1. Reference: TA-Lib STDDEV (0.6.8).
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
      // Clamp tiny negatives from float cancellation to 0 before sqrt.
      out[i] = Math.sqrt(variance > 0 ? variance : 0);
    }
  }
  return out;
}

/**
 * Rolling z-score: (x[i] - SMA(period)[i]) / stddev(period)[i], population sd.
 * Flat window -> sd = 0 -> z = 0 (no div-by-zero blowup). First value at index
 * period-1. Reference: composed from TA-Lib SMA + STDDEV (0.6.8).
 */
export function zscore(x: readonly number[], period: number): number[] {
  assertPeriod(period);
  const n = x.length;
  const mean = sma(x, period);
  const sd = stddev(x, period);
  const out = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(mean[i]!)) continue;
    const s = sd[i]!;
    out[i] = s === 0 ? 0 : (x[i]! - mean[i]!) / s;
  }
  return out;
}

/**
 * Rolling linear-regression: least-squares fit y = a + b*t over the window
 * t = 0..period-1, returning BOTH the slope `b` and the regression VALUE at the
 * last window point (a + b*(period-1)) — TA-Lib LINEARREG / LINEARREG_SLOPE.
 *
 * Closed form with t centered: sumT = period*(period-1)/2,
 *   b = (period*Sxy - Sx*Sy) / (period*Sxx - Sx^2),  a = (Sy - b*Sx)/period,
 *   value = a + b*(period-1).
 * Degenerate (period == 1): slope 0, value = x[i]. First value at index
 * period-1. Reference: TA-Lib LINEARREG / LINEARREG_SLOPE (0.6.8).
 */
export function linreg(x: readonly number[], period: number): { value: number[]; slope: number[] } {
  assertPeriod(period);
  const n = x.length;
  const value = new Array<number>(n).fill(NaN);
  const slope = new Array<number>(n).fill(NaN);
  // Sums over t = 0..period-1 (constant for the window).
  const sumT = (period * (period - 1)) / 2;
  let sumTT = 0;
  for (let t = 0; t < period; t++) sumTT += t * t;
  const denom = period * sumTT - sumT * sumT; // 0 only when period == 1
  for (let i = period - 1; i < n; i++) {
    let sumY = 0;
    let sumTY = 0;
    for (let t = 0; t < period; t++) {
      const y = x[i - period + 1 + t]!;
      sumY += y;
      sumTY += t * y;
    }
    let b: number;
    let a: number;
    if (denom === 0) {
      // period == 1: a single point, slope undefined -> 0, value = the point.
      b = 0;
      a = sumY; // == x[i]
    } else {
      b = (period * sumTY - sumT * sumY) / denom;
      a = (sumY - b * sumT) / period;
    }
    slope[i] = b;
    value[i] = a + b * (period - 1);
  }
  return { value, slope };
}

/** Linear-regression VALUE series (fit at the last window point). */
export function linregValue(x: readonly number[], period: number): number[] {
  return linreg(x, period).value;
}

/** Linear-regression SLOPE series. */
export function linregSlope(x: readonly number[], period: number): number[] {
  return linreg(x, period).slope;
}

/**
 * Rolling Pearson correlation between two equal-length series over `period`.
 *   r = (n*Sxy - Sx*Sy) / sqrt((n*Sxx - Sx^2)(n*Syy - Sy^2))
 * Zero variance in either window -> 0 (no div-by-zero). First value at index
 * period-1. Reference: TA-Lib CORREL (0.6.8).
 */
export function correl(x: readonly number[], y: readonly number[], period: number): number[] {
  assertPeriod(period);
  const n = Math.min(x.length, y.length);
  const out = new Array<number>(n).fill(NaN);
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i]!;
    const yi = y[i]!;
    sx += xi;
    sy += yi;
    sxx += xi * xi;
    syy += yi * yi;
    sxy += xi * yi;
    if (i >= period) {
      const ox = x[i - period]!;
      const oy = y[i - period]!;
      sx -= ox;
      sy -= oy;
      sxx -= ox * ox;
      syy -= oy * oy;
      sxy -= ox * oy;
    }
    if (i >= period - 1) {
      const covXY = period * sxy - sx * sy;
      const varX = period * sxx - sx * sx;
      const varY = period * syy - sy * sy;
      const d = varX * varY;
      out[i] = d <= 0 ? 0 : covXY / Math.sqrt(d);
    }
  }
  return out;
}

/**
 * Rolling minimum over the last `period` samples. First value at index
 * period-1. Reference: TA-Lib MIN (0.6.8).
 */
export function rollingMin(x: readonly number[], period: number): number[] {
  assertPeriod(period);
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = period - 1; i < n; i++) {
    let m = x[i]!;
    for (let j = i - period + 1; j < i; j++) if (x[j]! < m) m = x[j]!;
    out[i] = m;
  }
  return out;
}

/**
 * Rolling maximum over the last `period` samples. First value at index
 * period-1. Reference: TA-Lib MAX (0.6.8).
 */
export function rollingMax(x: readonly number[], period: number): number[] {
  assertPeriod(period);
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = period - 1; i < n; i++) {
    let m = x[i]!;
    for (let j = i - period + 1; j < i; j++) if (x[j]! > m) m = x[j]!;
    out[i] = m;
  }
  return out;
}

/**
 * Rolling percent-rank: percentage of the trailing window of `period` samples
 * strictly LESS than the current value: count(x_w < x[i]) / period * 100.
 * Range [0,100). First value at index period-1. Reference: standard rolling
 * percentile-rank definition.
 */
export function percentRank(x: readonly number[], period: number): number[] {
  assertPeriod(period);
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = period - 1; i < n; i++) {
    const cur = x[i]!;
    let cnt = 0;
    for (let j = i - period + 1; j <= i; j++) if (x[j]! < cur) cnt++;
    out[i] = (cnt / period) * 100;
  }
  return out;
}

/**
 * True Range. tr[i] = max(high-low, |high-prevClose|, |low-prevClose|).
 * Index 0 is NaN (no prior close). Reference: TA-Lib TRANGE (0.6.8) / Wilder.
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
 * Typical price = (high + low + close) / 3. No warmup (per-bar). Reference:
 * TA-Lib TYPPRICE (0.6.8).
 */
export function typicalPrice(bars: readonly OHLCV[]): number[] {
  return bars.map((b) => (b.high + b.low + b.close) / 3);
}

/** One set of pivot levels for a single period. */
export interface PivotLevels {
  pivot: number[];
  r1: number[];
  r2: number[];
  r3: number[];
  s1: number[];
  s2: number[];
  s3: number[];
}

/**
 * Classic (standard / floor-trader) pivot points, computed from the PRIOR bar's
 * High/Low/Close. Each level is constant for the bar it is computed at; index 0
 * is NaN (no prior bar).
 *   P  = (H + L + C) / 3
 *   R1 = 2P - L,  S1 = 2P - H
 *   R2 = P + (H - L),  S2 = P - (H - L)
 *   R3 = H + 2(P - L),  S3 = L - 2(H - P)
 * Reference: standard published classic pivot-point formulas (Investopedia /
 * StockCharts).
 */
export function pivotClassic(bars: readonly OHLCV[]): PivotLevels {
  const n = bars.length;
  const mk = () => new Array<number>(n).fill(NaN);
  const r: PivotLevels = {
    pivot: mk(),
    r1: mk(),
    r2: mk(),
    r3: mk(),
    s1: mk(),
    s2: mk(),
    s3: mk(),
  };
  for (let i = 1; i < n; i++) {
    const h = bars[i - 1]!.high;
    const l = bars[i - 1]!.low;
    const c = bars[i - 1]!.close;
    const p = (h + l + c) / 3;
    const range = h - l;
    r.pivot[i] = p;
    r.r1[i] = 2 * p - l;
    r.s1[i] = 2 * p - h;
    r.r2[i] = p + range;
    r.s2[i] = p - range;
    r.r3[i] = h + 2 * (p - l);
    r.s3[i] = l - 2 * (h - p);
  }
  return r;
}

/**
 * Fibonacci pivot points, computed from the PRIOR bar's High/Low/Close. Index 0
 * is NaN.
 *   P  = (H + L + C) / 3,  R = H - L
 *   R1 = P + 0.382R,  R2 = P + 0.618R,  R3 = P + 1.000R
 *   S1 = P - 0.382R,  S2 = P - 0.618R,  S3 = P - 1.000R
 * Reference: standard published Fibonacci pivot-point formulas (Investopedia /
 * StockCharts).
 */
export function pivotFibonacci(bars: readonly OHLCV[]): PivotLevels {
  const n = bars.length;
  const mk = () => new Array<number>(n).fill(NaN);
  const r: PivotLevels = {
    pivot: mk(),
    r1: mk(),
    r2: mk(),
    r3: mk(),
    s1: mk(),
    s2: mk(),
    s3: mk(),
  };
  for (let i = 1; i < n; i++) {
    const h = bars[i - 1]!.high;
    const l = bars[i - 1]!.low;
    const c = bars[i - 1]!.close;
    const p = (h + l + c) / 3;
    const range = h - l;
    r.pivot[i] = p;
    r.r1[i] = p + 0.382 * range;
    r.r2[i] = p + 0.618 * range;
    r.r3[i] = p + 1.0 * range;
    r.s1[i] = p - 0.382 * range;
    r.s2[i] = p - 0.618 * range;
    r.s3[i] = p - 1.0 * range;
  }
  return r;
}

// ----------------------------------------------------------------------------
// Streaming forms (reproduce the batch series exactly).
// ----------------------------------------------------------------------------

/** Streaming population StdDev — rolling window. Matches stddev() exactly. */
export function createStdDev(period: number): IndicatorStream {
  assertPeriod(period);
  const buf: number[] = [];
  let sum = 0;
  let sumSq = 0;
  return {
    push(v: number): number {
      buf.push(v);
      sum += v;
      sumSq += v * v;
      if (buf.length > period) {
        const old = buf.shift()!;
        sum -= old;
        sumSq -= old * old;
      }
      if (buf.length < period) return NaN;
      const mean = sum / period;
      const variance = sumSq / period - mean * mean;
      return Math.sqrt(variance > 0 ? variance : 0);
    },
  };
}

/** Streaming rolling min. Matches rollingMin() exactly. */
export function createRollingMin(period: number): IndicatorStream {
  assertPeriod(period);
  const buf: number[] = [];
  return {
    push(v: number): number {
      buf.push(v);
      if (buf.length > period) buf.shift();
      if (buf.length < period) return NaN;
      let m = buf[0]!;
      for (let j = 1; j < buf.length; j++) if (buf[j]! < m) m = buf[j]!;
      return m;
    },
  };
}

/** Streaming rolling max. Matches rollingMax() exactly. */
export function createRollingMax(period: number): IndicatorStream {
  assertPeriod(period);
  const buf: number[] = [];
  return {
    push(v: number): number {
      buf.push(v);
      if (buf.length > period) buf.shift();
      if (buf.length < period) return NaN;
      let m = buf[0]!;
      for (let j = 1; j < buf.length; j++) if (buf[j]! > m) m = buf[j]!;
      return m;
    },
  };
}

/** Streaming percent-rank. Matches percentRank() exactly. */
export function createPercentRank(period: number): IndicatorStream {
  assertPeriod(period);
  const buf: number[] = [];
  return {
    push(v: number): number {
      buf.push(v);
      if (buf.length > period) buf.shift();
      if (buf.length < period) return NaN;
      let cnt = 0;
      for (let j = 0; j < buf.length; j++) if (buf[j]! < v) cnt++;
      return (cnt / period) * 100;
    },
  };
}

/** Streaming z-score. Matches zscore() exactly. */
export function createZScore(period: number): IndicatorStream {
  assertPeriod(period);
  const buf: number[] = [];
  let sum = 0;
  let sumSq = 0;
  return {
    push(v: number): number {
      buf.push(v);
      sum += v;
      sumSq += v * v;
      if (buf.length > period) {
        const old = buf.shift()!;
        sum -= old;
        sumSq -= old * old;
      }
      if (buf.length < period) return NaN;
      const mean = sum / period;
      const variance = sumSq / period - mean * mean;
      const sd = Math.sqrt(variance > 0 ? variance : 0);
      return sd === 0 ? 0 : (v - mean) / sd;
    },
  };
}

/** Streaming linear-regression value. Matches linregValue() exactly. */
export function createLinRegValue(period: number): IndicatorStream {
  return linregStream(period, "value");
}

/** Streaming linear-regression slope. Matches linregSlope() exactly. */
export function createLinRegSlope(period: number): IndicatorStream {
  return linregStream(period, "slope");
}

function linregStream(period: number, which: "value" | "slope"): IndicatorStream {
  assertPeriod(period);
  const buf: number[] = [];
  const sumT = (period * (period - 1)) / 2;
  let sumTT = 0;
  for (let t = 0; t < period; t++) sumTT += t * t;
  const denom = period * sumTT - sumT * sumT;
  return {
    push(v: number): number {
      buf.push(v);
      if (buf.length > period) buf.shift();
      if (buf.length < period) return NaN;
      let sumY = 0;
      let sumTY = 0;
      for (let t = 0; t < period; t++) {
        sumY += buf[t]!;
        sumTY += t * buf[t]!;
      }
      let b: number;
      let a: number;
      if (denom === 0) {
        b = 0;
        a = sumY;
      } else {
        b = (period * sumTY - sumT * sumY) / denom;
        a = (sumY - b * sumT) / period;
      }
      return which === "slope" ? b : a + b * (period - 1);
    },
  };
}

// ----------------------------------------------------------------------------
// Registry definitions.
// ----------------------------------------------------------------------------

const close = (bars: readonly OHLCV[]): number[] => bars.map((b) => b.close);
const highs = (bars: readonly OHLCV[]): number[] => bars.map((b) => b.high);
const lows = (bars: readonly OHLCV[]): number[] => bars.map((b) => b.low);

/** Indicator definitions contributed by this category. */
export const statisticalIndicators: IndicatorDef[] = [
  {
    id: "linregvalue",
    label: "Linear Regression",
    category: "statistical",
    inputs: ["close"],
    params: [{ key: "period", label: "Period", type: "int", default: 14, min: 1 }],
    reference: "TA-Lib LINEARREG (0.6.8)",
    compute: (bars, p) => linregValue(close(bars), p.period ?? 14),
  },
  {
    id: "linregslope",
    label: "Linear Regression Slope",
    category: "statistical",
    inputs: ["close"],
    params: [{ key: "period", label: "Period", type: "int", default: 14, min: 1 }],
    reference: "TA-Lib LINEARREG_SLOPE (0.6.8)",
    compute: (bars, p) => linregSlope(close(bars), p.period ?? 14),
  },
  // NOTE: population StdDev is registered by the volatility category as "stddev"
  // (it is canonically a volatility study). We re-use the same convention here
  // via the internal `stddev()` helper for z-score, but do NOT register a second
  // "stddev" def — the registry enforces unique ids.
  {
    id: "zscore",
    label: "Z-Score",
    category: "statistical",
    inputs: ["close"],
    params: [{ key: "period", label: "Period", type: "int", default: 20, min: 1 }],
    reference: "Composed: TA-Lib SMA + STDDEV (0.6.8), population sd",
    compute: (bars, p) => zscore(close(bars), p.period ?? 20),
  },
  {
    id: "correl",
    label: "Rolling Correlation (High vs Low)",
    category: "statistical",
    inputs: ["high", "low"],
    params: [{ key: "period", label: "Period", type: "int", default: 30, min: 2 }],
    reference: "TA-Lib CORREL (0.6.8)",
    compute: (bars, p) => correl(highs(bars), lows(bars), p.period ?? 30),
  },
  {
    id: "min",
    label: "Rolling Minimum",
    category: "statistical",
    inputs: ["close"],
    params: [{ key: "period", label: "Period", type: "int", default: 14, min: 1 }],
    reference: "TA-Lib MIN (0.6.8)",
    compute: (bars, p) => rollingMin(close(bars), p.period ?? 14),
  },
  {
    id: "max",
    label: "Rolling Maximum",
    category: "statistical",
    inputs: ["close"],
    params: [{ key: "period", label: "Period", type: "int", default: 14, min: 1 }],
    reference: "TA-Lib MAX (0.6.8)",
    compute: (bars, p) => rollingMax(close(bars), p.period ?? 14),
  },
  {
    id: "percentrank",
    label: "Percent Rank",
    category: "statistical",
    inputs: ["close"],
    params: [{ key: "period", label: "Period", type: "int", default: 20, min: 1 }],
    reference: "Standard rolling percentile-rank definition (count below / period * 100)",
    compute: (bars, p) => percentRank(close(bars), p.period ?? 20),
  },
  {
    id: "trange",
    label: "True Range",
    category: "statistical",
    inputs: ["ohlcv"],
    params: [],
    reference: "TA-Lib TRANGE (0.6.8) / Wilder 1978",
    compute: (bars) => trueRange(bars),
  },
  {
    id: "typprice",
    label: "Typical Price",
    category: "statistical",
    inputs: ["ohlcv"],
    params: [],
    reference: "TA-Lib TYPPRICE (0.6.8)",
    compute: (bars) => typicalPrice(bars),
  },
  {
    id: "pivot_classic",
    label: "Pivot Points (Classic)",
    category: "statistical",
    inputs: ["ohlcv"],
    params: [],
    reference: "Standard classic pivot-point formulas (Investopedia / StockCharts)",
    compute: (bars) => pivotToRecord(pivotClassic(bars)),
  },
  {
    id: "pivot_fibonacci",
    label: "Pivot Points (Fibonacci)",
    category: "statistical",
    inputs: ["ohlcv"],
    params: [],
    reference: "Standard Fibonacci pivot-point formulas (Investopedia / StockCharts)",
    compute: (bars) => pivotToRecord(pivotFibonacci(bars)),
  },
];

/** Flatten PivotLevels to the registry's named-series record shape. */
function pivotToRecord(p: PivotLevels): Record<string, number[]> {
  return { pivot: p.pivot, r1: p.r1, r2: p.r2, r3: p.r3, s1: p.s1, s2: p.s2, s3: p.s3 };
}
