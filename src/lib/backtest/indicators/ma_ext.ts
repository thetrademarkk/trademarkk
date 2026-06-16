/**
 * Moving-average extensions — additional MA-family studies that complement the
 * foundation trend module (./trend.ts: SMA, EMA, WMA, DEMA, TEMA, HMA, KAMA,
 * VWMA, ALMA, T3). These are NEW ids (none duplicate the foundation ten).
 *
 * Indicators in this module:
 *  - TRIMA  — Triangular Moving Average (double-smoothed SMA). TA-Lib oracle.
 *  - SMMA   — Smoothed MA / Wilder RMA (α = 1/n). Reuses ./smoothing.wilderSmooth.
 *  - ZLEMA  — Zero-Lag EMA (Ehlers & Way). De-lagged input then EMA.
 *  - LSMA   — Least-Squares (linear-regression endpoint) MA. TA-Lib LINEARREG.
 *  - VIDYA  — Chande Variable Index Dynamic Average (|CMO|-scaled EMA).
 *  - MCGD   — McGinley Dynamic (self-adjusting MA).
 *  - FRAMA  — Fractal Adaptive MA (Ehlers; fractal-dimension-scaled EMA).
 *
 * Category: all register under "trend" (the IndicatorCategory allowlist is the
 * six committed values; ma_ext maps to "trend").
 *
 * Seeding / warmup (pinned, verified against the declared oracle):
 *  - TRIMA(n): triangular weights over an n-bar window; first non-NaN at n-1.
 *  - SMMA(n) = Wilder RMA: SMA-of-first-n seed; first non-NaN at n-1.
 *  - ZLEMA(n): lag = floor((n-1)/2); EMA(n) over (x + (x - x[-lag])); the
 *    de-lagged series has a NaN prefix of length `lag`, so first non-NaN at
 *    lag + (n-1).
 *  - LSMA(n): least-squares fit value AT the last window point; first at n-1.
 *  - VIDYA(n, cmoPeriod): |CMO(cmoPeriod)|/1 scales α = 2/(n+1); seed prev =
 *    x[cmoPeriod-1]; first output at index cmoPeriod.
 *  - MCGD(n): SMA-of-first-n seed; first non-NaN at n-1, then recursive.
 *  - FRAMA(n): n even; fractal dimension over the n-bar window split in halves;
 *    seed prev = x[n-1]; first output at index n.
 *
 * References (declared per indicator, asserted in ma_ext.test.ts):
 *  - TRIMA  = TA-Lib 0.6.8 TRIMA (offline oracle).
 *  - LSMA   = TA-Lib 0.6.8 LINEARREG (offline oracle).
 *  - SMMA   = Wilder (1978) RMA / TradingView Pine ta.rma.
 *  - ZLEMA  = Ehlers & Way (2010) "Zero Lag" / TradingView Pine ta.* ZLEMA.
 *  - VIDYA  = Chande (1994) Variable Index Dynamic Average / TradingView VIDYA.
 *  - MCGD   = John R. McGinley published McGinley Dynamic formula.
 *  - FRAMA  = John Ehlers (2005) Fractal Adaptive Moving Average.
 *
 * Conventions (pinned, see types.ts): output aligned to input length; NaN during
 * warmup; no look-ahead; explicit warmup-prefix test; determinism test; one
 * div-by-zero / flat-range gotcha per indicator.
 */

import { wilderSmooth } from "./smoothing";
import type { IndicatorDef } from "./registry";
import { assertPeriod, closes, type IndicatorStream } from "./types";

export { wilderSmooth as smma, createWilder as createSMMA } from "./smoothing";

/**
 * Triangular Moving Average. A double-smoothed SMA expressed as a single pass
 * with triangular weights over the n-bar window x[i-n+1 .. i]:
 *   odd  n: weights 1,2,…,m,…,2,1   with m = (n+1)/2
 *   even n: weights 1,2,…,m,m,…,2,1 with m = n/2
 * normalised to sum 1. First non-NaN at index n-1. Matches TA-Lib TRIMA.
 * Reference: TA-Lib 0.6.8 TRIMA.
 */
export function trima(x: readonly number[], period: number): number[] {
  assertPeriod(period);
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  const w = trimaWeights(period);
  for (let i = period - 1; i < n; i++) {
    let acc = 0;
    for (let j = 0; j < period; j++) acc += w[j]! * x[i - period + 1 + j]!;
    out[i] = acc;
  }
  return out;
}

/**
 * Normalised triangular weights for a window of `period` (sum = 1). The ramp
 * peaks in the middle: odd periods have a single peak, even periods a flat
 * two-value peak — both produced by `t = min(j+1, period-j)`.
 */
function trimaWeights(period: number): number[] {
  const w = new Array<number>(period);
  let sum = 0;
  for (let j = 0; j < period; j++) {
    const t = Math.min(j + 1, period - j);
    w[j] = t;
    sum += t;
  }
  for (let j = 0; j < period; j++) w[j] = w[j]! / sum;
  return w;
}

/** Streaming TRIMA — rolling window over fixed triangular weights. */
export function createTRIMA(period: number): IndicatorStream {
  assertPeriod(period);
  const w = trimaWeights(period);
  const buf: number[] = [];
  return {
    push(v: number): number {
      buf.push(v);
      if (buf.length > period) buf.shift();
      if (buf.length < period) return NaN;
      let acc = 0;
      for (let j = 0; j < period; j++) acc += w[j]! * buf[j]!;
      return acc;
    },
  };
}

/**
 * Zero-Lag Exponential Moving Average (Ehlers & Way, 2010).
 *   lag = floor((period-1)/2)
 *   de-lagged d[i] = x[i] + (x[i] - x[i-lag])   (NaN for i < lag)
 *   ZLEMA = EMA(d, period)  (SMA-seeded, this library's EMA convention)
 * First non-NaN at index lag + (period-1).
 * Reference: Ehlers & Way (2010) / TradingView Pine ZLEMA.
 */
export function zlema(x: readonly number[], period: number): number[] {
  assertPeriod(period);
  const n = x.length;
  const lag = Math.floor((period - 1) / 2);
  const d = new Array<number>(n).fill(NaN);
  for (let i = lag; i < n; i++) d[i] = x[i]! + (x[i]! - x[i - lag]!);
  return emaWithNaNPrefix(d, period);
}

/** SMA-seeded EMA over a series that may carry a leading NaN prefix. */
function emaWithNaNPrefix(x: readonly number[], period: number): number[] {
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
 * Least-Squares (linear-regression endpoint) Moving Average. Over each n-bar
 * window x[i-n+1 .. i] fit y = a + b*t (t = 0..n-1) by ordinary least squares
 * and take the fitted value AT the last point (t = n-1): a + b*(n-1).
 * First non-NaN at index n-1. Identical to TA-Lib LINEARREG.
 * Reference: TA-Lib 0.6.8 LINEARREG.
 */
export function lsma(x: readonly number[], period: number): number[] {
  assertPeriod(period);
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  if (period === 1) {
    // Degenerate: the fit through a single point is that point.
    for (let i = 0; i < n; i++) out[i] = x[i]!;
    return out;
  }
  const p = period;
  // Sums over t = 0..p-1 (constant across windows).
  const sumT = (p * (p - 1)) / 2;
  const sumT2 = ((p - 1) * p * (2 * p - 1)) / 6;
  const denom = p * sumT2 - sumT * sumT;
  for (let i = p - 1; i < n; i++) {
    let sumY = 0;
    let sumTY = 0;
    for (let t = 0; t < p; t++) {
      const y = x[i - p + 1 + t]!;
      sumY += y;
      sumTY += t * y;
    }
    const b = (p * sumTY - sumT * sumY) / denom;
    const a = (sumY - b * sumT) / p;
    out[i] = a + b * (p - 1);
  }
  return out;
}

/**
 * Chande's Variable Index Dynamic Average (Tushar Chande, 1994). An EMA whose
 * smoothing constant is scaled by the absolute Chande Momentum Oscillator
 * (|CMO|, in [0,1]) over a `cmoPeriod` window of one-step changes:
 *   up = sum(positive moves), dn = sum(|negative moves|) over cmoPeriod
 *   k  = |up - dn| / (up + dn)          (0 when the window is flat)
 *   VIDYA[i] = α*k*x[i] + (1 - α*k)*VIDYA[i-1],  α = 2/(period+1)
 * Seed prev = x[cmoPeriod-1]; first output at index cmoPeriod.
 * Reference: Chande (1994) VIDYA / TradingView VIDYA.
 */
export function vidya(x: readonly number[], period: number, cmoPeriod = 9): number[] {
  assertPeriod(period);
  assertPeriod(cmoPeriod);
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  if (n <= cmoPeriod) return out;
  const alpha = 2 / (period + 1);
  // Rolling up/down sums over the trailing `cmoPeriod` one-step changes.
  let up = 0;
  let dn = 0;
  for (let j = 1; j <= cmoPeriod; j++) {
    const dlt = x[j]! - x[j - 1]!;
    if (dlt > 0) up += dlt;
    else dn += -dlt;
  }
  let prev = x[cmoPeriod - 1]!; // seed
  for (let i = cmoPeriod; i < n; i++) {
    if (i > cmoPeriod) {
      // advance window: add change at i, drop change at i-cmoPeriod.
      const add = x[i]! - x[i - 1]!;
      if (add > 0) up += add;
      else dn += -add;
      const drop = x[i - cmoPeriod]! - x[i - cmoPeriod - 1]!;
      if (drop > 0) up -= drop;
      else dn -= -drop;
    }
    const denom = up + dn;
    const k = denom === 0 ? 0 : Math.abs(up - dn) / denom;
    prev = alpha * k * x[i]! + (1 - alpha * k) * prev;
    out[i] = prev;
  }
  return out;
}

/**
 * McGinley Dynamic (John R. McGinley). A self-adjusting MA that speeds up in
 * down moves and slows in up moves via the (price/MD)^4 term:
 *   MD[i] = MD[i-1] + (x[i] - MD[i-1]) / (period * (x[i]/MD[i-1])^4)
 * Seed MD = SMA(first `period`); first non-NaN at index period-1, then recurse.
 * Div-by-zero: a zero/negative seed cannot arise for positive price series; the
 * ratio term is finite whenever the previous MD is non-zero.
 * Reference: John R. McGinley published McGinley Dynamic formula.
 */
export function mcginley(x: readonly number[], period: number): number[] {
  assertPeriod(period);
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += x[i]!;
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < n; i++) {
    const ratio = x[i]! / prev;
    prev = prev + (x[i]! - prev) / (period * ratio ** 4);
    out[i] = prev;
  }
  return out;
}

/**
 * Fractal Adaptive Moving Average (John Ehlers, 2005). Over each n-bar window
 * (n even) the fractal dimension D is estimated by box-counting the high-low
 * ranges of the two n/2 halves vs the full window:
 *   N1 = range(firstHalf)/(n/2),  N2 = range(secondHalf)/(n/2),  N3 = range(all)/n
 *   D  = (ln(N1+N2) - ln(N3)) / ln 2          (D = 1 if any range is zero)
 *   α  = clamp(exp(-4.6*(D-1)), 0.01, 1)
 *   FRAMA[i] = α*x[i] + (1-α)*FRAMA[i-1]
 * Seed prev = x[n-1]; first output at index n. This library uses the close as
 * the high/low source (a common single-series FRAMA form).
 * Reference: John Ehlers (2005) Fractal Adaptive Moving Average.
 */
export function frama(x: readonly number[], period: number): number[] {
  assertPeriod(period);
  if (period % 2 !== 0) {
    throw new RangeError(`FRAMA period must be even, got ${period}`);
  }
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  if (n <= period) return out;
  const half = period / 2;
  const ln2 = Math.log(2);
  let prev = x[period - 1]!;
  for (let i = period; i < n; i++) {
    let h1 = -Infinity;
    let l1 = Infinity;
    let h2 = -Infinity;
    let l2 = Infinity;
    let ha = -Infinity;
    let la = Infinity;
    for (let j = 0; j < period; j++) {
      const v = x[i - period + 1 + j]!;
      if (v > ha) ha = v;
      if (v < la) la = v;
      if (j < half) {
        if (v > h1) h1 = v;
        if (v < l1) l1 = v;
      } else {
        if (v > h2) h2 = v;
        if (v < l2) l2 = v;
      }
    }
    const n1 = (h1 - l1) / half;
    const n2 = (h2 - l2) / half;
    const n3 = (ha - la) / period;
    let d = 1;
    if (n1 > 0 && n2 > 0 && n3 > 0) d = (Math.log(n1 + n2) - Math.log(n3)) / ln2;
    let alpha = Math.exp(-4.6 * (d - 1));
    if (alpha < 0.01) alpha = 0.01;
    else if (alpha > 1) alpha = 1;
    prev = alpha * x[i]! + (1 - alpha) * prev;
    out[i] = prev;
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
export const maExtIndicators: IndicatorDef[] = [
  {
    id: "trima",
    label: "Triangular Moving Average",
    category: "trend",
    inputs: ["close"],
    params: [PERIOD("Period", 30)],
    reference: "TA-Lib 0.6.8 TRIMA",
    compute: (bars, p) => trima(closes(bars), p.period ?? 30),
  },
  {
    id: "smma",
    label: "Smoothed Moving Average (Wilder RMA)",
    category: "trend",
    inputs: ["close"],
    params: [PERIOD("Period", 14)],
    reference: "Wilder (1978) RMA / TradingView Pine ta.rma",
    compute: (bars, p) => wilderSmooth(closes(bars), p.period ?? 14),
  },
  {
    id: "zlema",
    label: "Zero-Lag Exponential Moving Average",
    category: "trend",
    inputs: ["close"],
    params: [PERIOD("Period", 14)],
    reference: "Ehlers & Way (2010) Zero Lag / TradingView Pine ZLEMA",
    compute: (bars, p) => zlema(closes(bars), p.period ?? 14),
  },
  {
    id: "lsma",
    label: "Least-Squares Moving Average",
    category: "trend",
    inputs: ["close"],
    params: [PERIOD("Period", 14)],
    reference: "TA-Lib 0.6.8 LINEARREG (linear-regression endpoint)",
    compute: (bars, p) => lsma(closes(bars), p.period ?? 14),
  },
  {
    id: "vidya",
    label: "Variable Index Dynamic Average (Chande)",
    category: "trend",
    inputs: ["close"],
    params: [
      PERIOD("Period", 14),
      { key: "cmoPeriod", label: "CMO Period", type: "int", default: 9, min: 1 },
    ],
    reference: "Chande (1994) VIDYA / TradingView VIDYA",
    compute: (bars, p) => vidya(closes(bars), p.period ?? 14, p.cmoPeriod ?? 9),
  },
  {
    id: "mcginley",
    label: "McGinley Dynamic",
    category: "trend",
    inputs: ["close"],
    params: [PERIOD("Period", 14)],
    reference: "John R. McGinley published McGinley Dynamic formula",
    compute: (bars, p) => mcginley(closes(bars), p.period ?? 14),
  },
  {
    id: "frama",
    label: "Fractal Adaptive Moving Average",
    category: "trend",
    inputs: ["close"],
    params: [{ key: "period", label: "Period", type: "int", default: 16, min: 2 }],
    reference: "John Ehlers (2005) Fractal Adaptive Moving Average",
    compute: (bars, p) => frama(closes(bars), p.period ?? 16),
  },
];
