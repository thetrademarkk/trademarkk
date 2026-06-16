/**
 * Trend indicators — moving averages and trend-following studies.
 *
 * FOUNDATION (reference pattern): SMA, EMA. This category also implements the
 * moving-average family: WMA, DEMA, TEMA, HMA, KAMA, VWMA, ALMA, T3 (Tillson).
 * Category agents append their IndicatorDef objects to `trendIndicators` below
 * and add a co-located golden test; they do NOT edit registry.ts or index.ts.
 *
 * Seeding conventions (pinned, TA-Lib 0.6.8 parity unless noted):
 *  - EMA: 2/(n+1) multiplier, SMA-of-first-n seed; first non-NaN at index n-1.
 *  - WMA: linearly-weighted (weight i+1 for the i-th in window); first at n-1.
 *  - DEMA/TEMA: composed from SMA-seeded EMA; warmup = 2*(n-1) / 3*(n-1).
 *  - HMA: Hull = WMA(2*WMA(n/2) - WMA(n), round(sqrt(n))); warmup composes.
 *  - KAMA: Kaufman adaptive; seed prev = x[n-1], first output at index n (TA-Lib).
 *  - VWMA: volume-weighted MA, sum(p*v)/sum(v) over the window; first at n-1.
 *  - ALMA: Arnaud Legoux MA (Gaussian window, offset/sigma); first at n-1.
 *  - T3: Tillson generalized DEMA of order 6; converges to TA-Lib T3.
 *
 * References (declared per indicator, see trend.test.ts):
 *  - SMA/EMA/WMA/DEMA/TEMA/KAMA/T3 = TA-Lib documented output (TA-Lib 0.6.8).
 *  - VWMA = canonical volume-weighted MA formula (sum(p*v)/sum(v)).
 *  - ALMA = Arnaud Legoux (2009) published Gaussian-weighted MA formula.
 *  - HMA = Alan Hull (2005) published WMA composition.
 */

import { ema, sma } from "./smoothing";
import type { IndicatorDef } from "./registry";
import { assertPeriod, closes, type IndicatorStream } from "./types";

export { sma, ema, createSMA, createEMA } from "./smoothing";

/**
 * NaN-aware EMA for composing higher-order MAs (DEMA/TEMA/T3). Identical to
 * `ema()` but it skips a leading NaN prefix (the warmup of an inner stage),
 * seeding from the first `period` finite values. Output aligned to input length.
 */
function emaCompose(x: readonly number[], period: number): number[] {
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  let start = 0;
  while (start < n && Number.isNaN(x[start]!)) start++;
  if (n - start < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = start; i < start + period; i++) seed += x[i]!;
  let prev = seed / period;
  out[start + period - 1] = prev;
  for (let i = start + period; i < n; i++) {
    prev = (x[i]! - prev) * k + prev;
    out[i] = prev;
  }
  return out;
}

/**
 * Weighted (linearly-weighted) Moving Average. The most recent value carries
 * weight `period`, the oldest weight 1. out[i] = sum(w_j * x) / sum(w_j) over
 * the window x[i-period+1 .. i]; NaN for i < period-1.
 *   WMA[i] = (period*x[i] + (period-1)*x[i-1] + ... + 1*x[i-period+1]) / (period*(period+1)/2)
 * Reference: TA-Lib WMA.
 */
export function wma(x: readonly number[], period: number): number[] {
  assertPeriod(period);
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < n; i++) {
    let acc = 0;
    for (let j = 0; j < period; j++) {
      // weight (period - j) on x[i-j]
      acc += (period - j) * x[i - j]!;
    }
    out[i] = acc / denom;
  }
  return out;
}

/** Streaming WMA — rolling window, reproduces wma() exactly. */
export function createWMA(period: number): IndicatorStream {
  assertPeriod(period);
  const buf: number[] = [];
  const denom = (period * (period + 1)) / 2;
  return {
    push(v: number): number {
      buf.push(v);
      if (buf.length > period) buf.shift();
      if (buf.length < period) return NaN;
      let acc = 0;
      for (let j = 0; j < period; j++) acc += (j + 1) * buf[j]!;
      return acc / denom;
    },
  };
}

/**
 * Double Exponential Moving Average (Mulloy, 1994).
 *   DEMA = 2*EMA(x) - EMA(EMA(x))
 * Composed from the SMA-seeded EMA, so the inner EMA(EMA) starts after the
 * first EMA's own warmup. First non-NaN at index 2*(period-1).
 * Reference: TA-Lib DEMA.
 */
export function dema(x: readonly number[], period: number): number[] {
  assertPeriod(period);
  const e1 = emaCompose(x, period);
  const e2 = emaCompose(e1, period);
  const out = new Array<number>(x.length).fill(NaN);
  for (let i = 0; i < x.length; i++) {
    if (!Number.isNaN(e2[i]!)) out[i] = 2 * e1[i]! - e2[i]!;
  }
  return out;
}

/**
 * Triple Exponential Moving Average (Mulloy, 1994).
 *   TEMA = 3*EMA - 3*EMA(EMA) + EMA(EMA(EMA))
 * First non-NaN at index 3*(period-1). Reference: TA-Lib TEMA.
 */
export function tema(x: readonly number[], period: number): number[] {
  assertPeriod(period);
  const e1 = emaCompose(x, period);
  const e2 = emaCompose(e1, period);
  const e3 = emaCompose(e2, period);
  const out = new Array<number>(x.length).fill(NaN);
  for (let i = 0; i < x.length; i++) {
    if (!Number.isNaN(e3[i]!)) out[i] = 3 * e1[i]! - 3 * e2[i]! + e3[i]!;
  }
  return out;
}

/**
 * Hull Moving Average (Alan Hull, 2005).
 *   HMA = WMA( 2*WMA(x, n/2) - WMA(x, n), round(sqrt(n)) )
 * `n/2` is floored, `sqrt(n)` is rounded — the standard published convention.
 * Reference: Alan Hull published WMA composition (cross-checked vs TA-Lib WMA).
 */
export function hma(x: readonly number[], period: number): number[] {
  assertPeriod(period);
  const half = Math.floor(period / 2);
  const sqrtP = Math.round(Math.sqrt(period));
  assertPeriod(half);
  assertPeriod(sqrtP);
  const wHalf = wma(x, half);
  const wFull = wma(x, period);
  const raw = new Array<number>(x.length).fill(NaN);
  for (let i = 0; i < x.length; i++) {
    if (!Number.isNaN(wFull[i]!)) raw[i] = 2 * wHalf[i]! - wFull[i]!;
  }
  return wmaWithNaNPrefix(raw, sqrtP);
}

/** WMA over a series that has a leading NaN prefix (composed inputs). */
function wmaWithNaNPrefix(x: readonly number[], period: number): number[] {
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < n; i++) {
    let acc = 0;
    let ok = true;
    for (let j = 0; j < period; j++) {
      const v = x[i - j]!;
      if (Number.isNaN(v)) {
        ok = false;
        break;
      }
      acc += (period - j) * v;
    }
    if (ok) out[i] = acc / denom;
  }
  return out;
}

/**
 * Kaufman Adaptive Moving Average (Kaufman, 1995).
 *   ER  = |x[i] - x[i-period]| / sum(|x[k]-x[k-1]|, k in window)
 *   SC  = (ER*(fastSC - slowSC) + slowSC)^2,  fastSC=2/3, slowSC=2/31
 *   KAMA[i] = KAMA[i-1] + SC*(x[i] - KAMA[i-1])
 * Seed: prev = x[period-1]; first output at index `period` (TA-Lib parity).
 * Div-by-zero: a flat window (sum of |moves| = 0) gives ER = 1.
 * Reference: TA-Lib KAMA (fast=2, slow=30 defaults).
 */
export function kama(x: readonly number[], period: number, fast = 2, slow = 30): number[] {
  assertPeriod(period);
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  if (n <= period) return out;
  const fastSC = 2 / (fast + 1);
  const slowSC = 2 / (slow + 1);
  let prev = x[period - 1]!;
  // Rolling sum of absolute one-step changes over the trailing `period` moves:
  // for index i the window is the diffs at indices (i-period+1 .. i).
  let volSum = 0;
  for (let k = 1; k <= period; k++) volSum += Math.abs(x[k]! - x[k - 1]!);
  for (let i = period; i < n; i++) {
    if (i > period) {
      // advance the window: add diff at i, drop diff at i-period.
      volSum += Math.abs(x[i]! - x[i - 1]!) - Math.abs(x[i - period]! - x[i - period - 1]!);
    }
    const change = Math.abs(x[i]! - x[i - period]!);
    const er = volSum !== 0 ? change / volSum : 1;
    const sc = (er * (fastSC - slowSC) + slowSC) ** 2;
    prev = prev + sc * (x[i]! - prev);
    out[i] = prev;
  }
  return out;
}

/** Streaming KAMA — reproduces kama() exactly (fast=2, slow=30 defaults). */
export function createKAMA(period: number, fast = 2, slow = 30): IndicatorStream {
  assertPeriod(period);
  const fastSC = 2 / (fast + 1);
  const slowSC = 2 / (slow + 1);
  const buf: number[] = []; // last period+1 prices for window + diffs
  let count = 0;
  let prev = NaN;
  return {
    push(v: number): number {
      buf.push(v);
      if (buf.length > period + 1) buf.shift();
      count++;
      if (count < period) return NaN;
      if (count === period) {
        prev = v; // x[period-1] seed; no output yet
        return NaN;
      }
      // buf holds up to period+1 values: oldest .. current
      let volSum = 0;
      for (let k = 1; k < buf.length; k++) volSum += Math.abs(buf[k]! - buf[k - 1]!);
      const change = Math.abs(buf[buf.length - 1]! - buf[0]!);
      const er = volSum !== 0 ? change / volSum : 1;
      const sc = (er * (fastSC - slowSC) + slowSC) ** 2;
      prev = prev + sc * (v - prev);
      return prev;
    },
  };
}

/**
 * Volume-Weighted Moving Average. out[i] = sum(p*v) / sum(v) over the window
 * x[i-period+1 .. i]; NaN for i < period-1. Div-by-zero: sum(v)=0 -> NaN.
 * Reference: canonical VWMA formula (sum(price*volume)/sum(volume)).
 */
export function vwma(
  price: readonly number[],
  volume: readonly number[],
  period: number
): number[] {
  assertPeriod(period);
  const n = price.length;
  const out = new Array<number>(n).fill(NaN);
  let pvSum = 0;
  let vSum = 0;
  for (let i = 0; i < n; i++) {
    pvSum += price[i]! * volume[i]!;
    vSum += volume[i]!;
    if (i >= period) {
      pvSum -= price[i - period]! * volume[i - period]!;
      vSum -= volume[i - period]!;
    }
    if (i >= period - 1) out[i] = vSum !== 0 ? pvSum / vSum : NaN;
  }
  return out;
}

/**
 * Arnaud Legoux Moving Average (Legoux & Lux, 2009). A Gaussian window of
 * `period` weights centred at `offset*(period-1)` with spread `period/sigma`,
 * applied over x[i-period+1 .. i]; NaN for i < period-1.
 *   w_j = exp( -(j - m)^2 / (2*s^2) ),  m = offset*(n-1),  s = n/sigma
 *   ALMA[i] = sum(w_j * x[i-(n-1)+j]) / sum(w_j)
 * Reference: Arnaud Legoux published ALMA formula (offset 0.85, sigma 6).
 */
export function alma(x: readonly number[], period: number, offset = 0.85, sigma = 6): number[] {
  assertPeriod(period);
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  const m = offset * (period - 1);
  const s = period / sigma;
  const w = new Array<number>(period);
  let wSum = 0;
  for (let j = 0; j < period; j++) {
    w[j] = Math.exp(-((j - m) ** 2) / (2 * s * s));
    wSum += w[j]!;
  }
  for (let i = period - 1; i < n; i++) {
    let acc = 0;
    for (let j = 0; j < period; j++) acc += w[j]! * x[i - period + 1 + j]!;
    out[i] = acc / wSum;
  }
  return out;
}

/**
 * T3 — Tillson generalized DEMA (Tim Tillson, TASC 1998). A 6-fold EMA chain
 * with a volume-factor weighting:
 *   GD(x) = EMA(x)*(1+v) - EMA(EMA(x))*v
 *   T3    = GD(GD(GD(x)))
 * which expands to a fixed combination of the 3rd..6th nested EMAs:
 *   c1=-v^3; c2=3v^2+3v^3; c3=-6v^2-3v-3v^3; c4=1+3v+v^3+3v^2
 *   T3 = c1*e6 + c2*e5 + c3*e4 + c4*e3
 * Composed from the SMA-seeded EMA (this library's seed). The early bars differ
 * from TA-Lib only by the seeding transient; the series converges to TA-Lib T3
 * (asserted on the converged tail). First non-NaN at index 6*(period-1).
 * Reference: Tillson published T3 formula; converged tail vs TA-Lib T3.
 */
export function t3(x: readonly number[], period: number, vfactor = 0.7): number[] {
  assertPeriod(period);
  const v = vfactor;
  const e1 = emaCompose(x, period);
  const e2 = emaCompose(e1, period);
  const e3 = emaCompose(e2, period);
  const e4 = emaCompose(e3, period);
  const e5 = emaCompose(e4, period);
  const e6 = emaCompose(e5, period);
  const c1 = -(v ** 3);
  const c2 = 3 * v * v + 3 * v ** 3;
  const c3 = -6 * v * v - 3 * v - 3 * v ** 3;
  const c4 = 1 + 3 * v + v ** 3 + 3 * v * v;
  const out = new Array<number>(x.length).fill(NaN);
  for (let i = 0; i < x.length; i++) {
    if (!Number.isNaN(e6[i]!)) out[i] = c1 * e6[i]! + c2 * e5[i]! + c3 * e4[i]! + c4 * e3[i]!;
  }
  return out;
}

const PERIOD = (label = "Period", def = 14): IndicatorDef["params"][number] => ({
  key: "period",
  label,
  type: "int",
  default: def,
  min: 1,
});

/** Indicator definitions contributed by this category. */
export const trendIndicators: IndicatorDef[] = [
  {
    id: "sma",
    label: "Simple Moving Average",
    category: "trend",
    inputs: ["close"],
    params: [{ key: "period", label: "Period", type: "int", default: 14, min: 1 }],
    reference: "TA-Lib SMA (0.6.8)",
    compute: (bars, p) => sma(closes(bars), p.period ?? 14),
  },
  {
    id: "ema",
    label: "Exponential Moving Average",
    category: "trend",
    inputs: ["close"],
    params: [{ key: "period", label: "Period", type: "int", default: 14, min: 1 }],
    reference: "TA-Lib EMA (0.6.8) — 2/(n+1) multiplier, SMA seed",
    compute: (bars, p) => ema(closes(bars), p.period ?? 14),
  },
  {
    id: "wma",
    label: "Weighted Moving Average",
    category: "trend",
    inputs: ["close"],
    params: [PERIOD()],
    reference: "TA-Lib WMA (0.6.8)",
    compute: (bars, p) => wma(closes(bars), p.period ?? 14),
  },
  {
    id: "dema",
    label: "Double Exponential Moving Average",
    category: "trend",
    inputs: ["close"],
    params: [PERIOD()],
    reference: "TA-Lib DEMA (0.6.8)",
    compute: (bars, p) => dema(closes(bars), p.period ?? 14),
  },
  {
    id: "tema",
    label: "Triple Exponential Moving Average",
    category: "trend",
    inputs: ["close"],
    params: [PERIOD()],
    reference: "TA-Lib TEMA (0.6.8)",
    compute: (bars, p) => tema(closes(bars), p.period ?? 14),
  },
  {
    id: "hma",
    label: "Hull Moving Average",
    category: "trend",
    inputs: ["close"],
    params: [PERIOD("Period", 16)],
    reference: "Alan Hull (2005) published WMA composition; cross-checked vs TA-Lib WMA",
    compute: (bars, p) => hma(closes(bars), p.period ?? 16),
  },
  {
    id: "kama",
    label: "Kaufman Adaptive Moving Average",
    category: "trend",
    inputs: ["close"],
    params: [
      PERIOD("Period", 10),
      { key: "fast", label: "Fast EMA", type: "int", default: 2, min: 1 },
      { key: "slow", label: "Slow EMA", type: "int", default: 30, min: 1 },
    ],
    reference: "TA-Lib KAMA (0.6.8) — fast=2, slow=30",
    compute: (bars, p) => kama(closes(bars), p.period ?? 10, p.fast ?? 2, p.slow ?? 30),
  },
  {
    id: "vwma",
    label: "Volume-Weighted Moving Average",
    category: "trend",
    inputs: ["close", "volume"],
    params: [PERIOD()],
    reference: "Canonical VWMA formula: sum(price*volume)/sum(volume)",
    compute: (bars, p) =>
      vwma(
        closes(bars),
        bars.map((b) => b.volume),
        p.period ?? 14
      ),
  },
  {
    id: "alma",
    label: "Arnaud Legoux Moving Average",
    category: "trend",
    inputs: ["close"],
    params: [
      PERIOD("Period", 9),
      { key: "offset", label: "Offset", type: "float", default: 0.85, min: 0, max: 1 },
      { key: "sigma", label: "Sigma", type: "float", default: 6, min: 0.1 },
    ],
    reference: "Arnaud Legoux (2009) published ALMA formula (offset 0.85, sigma 6)",
    compute: (bars, p) => alma(closes(bars), p.period ?? 9, p.offset ?? 0.85, p.sigma ?? 6),
  },
  {
    id: "t3",
    label: "T3 (Tillson)",
    category: "trend",
    inputs: ["close"],
    params: [
      PERIOD("Period", 5),
      { key: "vfactor", label: "Volume factor", type: "float", default: 0.7, min: 0, max: 1 },
    ],
    reference: "Tillson (1998) published T3 formula; converged tail vs TA-Lib T3 (0.6.8)",
    compute: (bars, p) => t3(closes(bars), p.period ?? 5, p.vfactor ?? 0.7),
  },
];
