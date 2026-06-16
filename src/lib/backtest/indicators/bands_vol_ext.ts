/**
 * Band & volatility extensions — additional volatility/band studies that
 * complement the foundation volatility module (./volatility.ts: ATR, NATR,
 * BBands, StdDev, Keltner, Donchian, Chaikin Volatility).
 *
 * Pure, deterministic, dependency-free. Output aligned to input length; NaN
 * during warmup; no look-ahead (out[i] depends only on bars[0..i]). Composes
 * from ./smoothing primitives (sma/ema) and reuses ./volatility (atr) rather
 * than reinventing them.
 *
 * Indicators (category "volatility", per the Wire-phase mapping):
 *  - Ulcer Index            (StockCharts / Peter Martin)
 *  - Mass Index             (Donald Dorsey / StockCharts)
 *  - Historical Volatility  (close-to-close annualized; standard published)
 *  - Relative Vigor Index   (RVI + signal; John Ehlers / TradingView)
 *  - STARC Bands            (Manning Stoller; SMA basis +/- mult*ATR)
 *  - Acceleration Bands     (Price Headley)
 *  - Chaikin Oscillator     (ADOSC; TA-Lib 0.6.8 direct oracle)
 *
 * Conventions (pinned, see types.ts): warmup prefix is NaN; div-by-zero /
 * flat-range handled deterministically (each documented per indicator and
 * covered by a test). EMA composition over a NaN-prefixed inner series follows
 * the trend.ts emaCompose pattern (skip leading NaN, SMA seed of first n finite
 * values, first output at start+period-1).
 *
 * References are declared per IndicatorDef and asserted in bands_vol_ext.test.ts.
 */

import { sma } from "./smoothing";
import { atr } from "./volatility";
import type { IndicatorDef } from "./registry";
import { assertPeriod, type IndicatorStream, type OHLCV } from "./types";

// ----------------------------------------------------------------------------
// Small shared adapters / EMA-over-NaN-prefix helper (mirrors trend.ts).
// ----------------------------------------------------------------------------

const closesOf = (bars: readonly OHLCV[]): number[] => bars.map((b) => b.close);

/**
 * EMA over a series that may carry a leading NaN prefix (composed inputs).
 * Skips the NaN prefix, seeds with the SMA of the first `period` finite values,
 * first output at start+period-1. Matches smoothing.ts EMA on a clean series.
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

// ----------------------------------------------------------------------------
// Ulcer Index (Peter Martin & Byron McCann, 1989).
// ----------------------------------------------------------------------------

/**
 * Ulcer Index over a rolling window of `period` closes (INCLUDING the current
 * bar). For each window, the percentage drawdown of each close from the window
 * maximum is squared, averaged, and square-rooted:
 *   pctDD[k] = 100 * (close[k] - maxClose) / maxClose
 *   UI[i]    = sqrt( mean( pctDD^2 ) ) over the window
 * First value at index period-1. A flat (or monotonically rising) window has
 * zero drawdown, so UI is 0 (no div-by-zero unless maxClose == 0, which cannot
 * happen for positive prices; guarded to NaN if maxClose <= 0).
 * Reference: StockCharts Ulcer Index (Martin/McCann).
 */
export function ulcerIndex(close: readonly number[], period: number): number[] {
  assertPeriod(period);
  const n = close.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = period - 1; i < n; i++) {
    let mx = -Infinity;
    for (let j = i - period + 1; j <= i; j++) if (close[j]! > mx) mx = close[j]!;
    if (mx <= 0) continue;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const dd = (100 * (close[j]! - mx)) / mx;
      sumSq += dd * dd;
    }
    out[i] = Math.sqrt(sumSq / period);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Mass Index (Donald Dorsey, 1992).
// ----------------------------------------------------------------------------

/**
 * Mass Index. Smooth the high-low range with a 9-period EMA, divide by a
 * 9-period EMA of that EMA, then sum the ratio over `sumPeriod` (default 25):
 *   ema1  = EMA(high - low, emaPeriod)
 *   ema2  = EMA(ema1, emaPeriod)
 *   ratio = ema1 / ema2
 *   MI[i] = sum(ratio[i-sumPeriod+1 .. i])
 * ema1 first lands at index emaPeriod-1; ema2 at 2*(emaPeriod-1); so the first
 * Mass Index lands at index 2*(emaPeriod-1) + sumPeriod-1. Div-by-zero
 * (ema2 == 0, i.e. a flat range) -> that bar's ratio is undefined, so the
 * window-sum is left NaN (a flat range has no mass to speak of).
 * Reference: Donald Dorsey / StockCharts Mass Index (EMA9, sum 25).
 */
export function massIndex(bars: readonly OHLCV[], emaPeriod = 9, sumPeriod = 25): number[] {
  assertPeriod(emaPeriod);
  assertPeriod(sumPeriod);
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  const range = bars.map((b) => b.high - b.low);
  const ema1 = emaCompose(range, emaPeriod);
  const ema2 = emaCompose(ema1, emaPeriod);
  const ratio = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const a = ema1[i]!;
    const b = ema2[i]!;
    if (!Number.isNaN(a) && !Number.isNaN(b) && b !== 0) ratio[i] = a / b;
  }
  for (let i = sumPeriod - 1; i < n; i++) {
    let sum = 0;
    let ok = true;
    for (let j = i - sumPeriod + 1; j <= i; j++) {
      if (Number.isNaN(ratio[j]!)) {
        ok = false;
        break;
      }
      sum += ratio[j]!;
    }
    if (ok) out[i] = sum;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Historical Volatility (close-to-close, annualized).
// ----------------------------------------------------------------------------

/**
 * Historical (statistical) Volatility from close-to-close log returns.
 *   r[i]  = ln(close[i] / close[i-1])           (first return at index 1)
 *   HV[i] = stddev_sample(r over `period`) * sqrt(annual) * 100
 * Uses the SAMPLE standard deviation (ddof = 1) over the trailing `period`
 * returns (window INCLUDING the current bar), annualized by sqrt(`annual`)
 * (252 trading days by default) and expressed in percent. Because the first
 * return is at index 1, the first HV lands at index `period`. A flat price
 * series gives zero returns -> HV 0 (no div-by-zero for positive prices).
 * Reference: standard close-to-close historical volatility (e.g. Hull;
 * StockCharts "Historical Volatility").
 */
export function historicalVolatility(
  close: readonly number[],
  period: number,
  annual = 252
): number[] {
  assertPeriod(period);
  const n = close.length;
  const out = new Array<number>(n).fill(NaN);
  const r = new Array<number>(n).fill(NaN);
  for (let i = 1; i < n; i++) r[i] = Math.log(close[i]! / close[i - 1]!);
  const ann = Math.sqrt(annual);
  // Need `period` returns; the earliest return is at index 1, so the first
  // full window ends at index `period`.
  for (let i = period; i < n; i++) {
    let mean = 0;
    for (let j = i - period + 1; j <= i; j++) mean += r[j]!;
    mean /= period;
    let varSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = r[j]! - mean;
      varSum += d * d;
    }
    const variance = varSum / (period - 1); // sample stddev (ddof = 1)
    out[i] = Math.sqrt(Math.max(0, variance)) * ann * 100;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Relative Vigor Index (John Ehlers, 2002).
// ----------------------------------------------------------------------------

/** RVI output: the index line and its 4-bar symmetric-weighted signal line. */
export interface RVIResult {
  rvi: number[];
  signal: number[];
}

/**
 * Relative Vigor Index (Ehlers). Each bar's "value" (close-open) and "range"
 * (high-low) are first symmetric-weighted across the bar and its three
 * predecessors with weights (1, 2, 2, 1)/6, then summed over `period` bars:
 *   v[i] = ((c-o)[i] + 2*(c-o)[i-1] + 2*(c-o)[i-2] + (c-o)[i-3]) / 6
 *   d[i] = ((h-l)[i] + 2*(h-l)[i-1] + 2*(h-l)[i-2] + (h-l)[i-3]) / 6
 *   RVI[i] = sum(v[i-period+1 .. i]) / sum(d[i-period+1 .. i])
 * The signal line is the same (1,2,2,1)/6 symmetric weighting of RVI:
 *   signal[i] = (RVI[i] + 2*RVI[i-1] + 2*RVI[i-2] + RVI[i-3]) / 6
 * v/d first land at index 3, so RVI first lands at index `period`+2 and the
 * signal three bars later. Flat range (denominator sum == 0) -> RVI 0.
 * Reference: John Ehlers RVI; TradingView Pine ta RVI definition.
 */
export function relativeVigorIndex(bars: readonly OHLCV[], period: number): RVIResult {
  assertPeriod(period);
  const n = bars.length;
  const rvi = new Array<number>(n).fill(NaN);
  const signal = new Array<number>(n).fill(NaN);
  const co = bars.map((b) => b.close - b.open);
  const hl = bars.map((b) => b.high - b.low);
  const vNum = new Array<number>(n).fill(NaN);
  const dNum = new Array<number>(n).fill(NaN);
  for (let i = 3; i < n; i++) {
    vNum[i] = (co[i]! + 2 * co[i - 1]! + 2 * co[i - 2]! + co[i - 3]!) / 6;
    dNum[i] = (hl[i]! + 2 * hl[i - 1]! + 2 * hl[i - 2]! + hl[i - 3]!) / 6;
  }
  // RVI first full window of `period` triangle values ends at index period+2.
  for (let i = period + 2; i < n; i++) {
    let ns = 0;
    let ds = 0;
    for (let j = i - period + 1; j <= i; j++) {
      ns += vNum[j]!;
      ds += dNum[j]!;
    }
    rvi[i] = ds === 0 ? 0 : ns / ds;
  }
  for (let i = period + 5; i < n; i++) {
    signal[i] = (rvi[i]! + 2 * rvi[i - 1]! + 2 * rvi[i - 2]! + rvi[i - 3]!) / 6;
  }
  return { rvi, signal };
}

// ----------------------------------------------------------------------------
// STARC Bands (Manning "Stoller Average Range Channel").
// ----------------------------------------------------------------------------

/** STARC Bands output. */
export interface StarcBands {
  middle: number[];
  upper: number[];
  lower: number[];
}

/**
 * STARC Bands. Basis = SMA(close, maPeriod); band = mult * ATR(atrPeriod):
 *   upper = SMA(close, maPeriod) + mult * ATR(atrPeriod)
 *   lower = SMA(close, maPeriod) - mult * ATR(atrPeriod)
 * The SMA warms at index maPeriod-1, the ATR at index atrPeriod (TA-Lib/Wilder
 * parity), so each band's first non-NaN is at max(maPeriod-1, atrPeriod). With
 * the defaults (5, 15) that is index 15. A flat series -> ATR 0 -> bands
 * collapse onto the SMA basis.
 * Reference: Manning Stoller STARC bands (SMA basis +/- ATR), composed from
 * the TA-Lib ATR primitive.
 */
export function starcBands(
  bars: readonly OHLCV[],
  maPeriod = 5,
  atrPeriod = 15,
  mult = 2
): StarcBands {
  assertPeriod(maPeriod);
  assertPeriod(atrPeriod);
  const n = bars.length;
  const middle = sma(closesOf(bars), maPeriod);
  const a = atr(bars, atrPeriod);
  const upper = new Array<number>(n).fill(NaN);
  const lower = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(middle[i]!) || Number.isNaN(a[i]!)) continue;
    upper[i] = middle[i]! + mult * a[i]!;
    lower[i] = middle[i]! - mult * a[i]!;
  }
  return { middle, upper, lower };
}

// ----------------------------------------------------------------------------
// Acceleration Bands (Price Headley).
// ----------------------------------------------------------------------------

/** Acceleration Bands output. */
export interface AccelerationBands {
  middle: number[];
  upper: number[];
  lower: number[];
}

/**
 * Acceleration Bands (Headley). The basis is an SMA of close; the bands are
 * SMAs of high/low scaled by the per-bar range factor:
 *   upperRaw[i] = high[i] * (1 + factor*(high[i]-low[i])/(high[i]+low[i]))
 *   lowerRaw[i] = low[i]  * (1 - factor*(high[i]-low[i])/(high[i]+low[i]))
 *   middle = SMA(close, period); upper = SMA(upperRaw, period); lower = SMA(lowerRaw, period)
 * `factor` defaults to 4 (Headley's published constant). All three SMAs warm at
 * index period-1. Div-by-zero (high+low == 0) cannot occur for positive prices;
 * guarded so the range factor is 0 when high+low == 0.
 * Reference: Price Headley Acceleration Bands.
 */
export function accelerationBands(
  bars: readonly OHLCV[],
  period: number,
  factor = 4
): AccelerationBands {
  assertPeriod(period);
  const n = bars.length;
  const upperRaw = new Array<number>(n);
  const lowerRaw = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const h = bars[i]!.high;
    const l = bars[i]!.low;
    const denom = h + l;
    const rf = denom === 0 ? 0 : (factor * (h - l)) / denom;
    upperRaw[i] = h * (1 + rf);
    lowerRaw[i] = l * (1 - rf);
  }
  return {
    middle: sma(closesOf(bars), period),
    upper: sma(upperRaw, period),
    lower: sma(lowerRaw, period),
  };
}

// ----------------------------------------------------------------------------
// Chaikin Oscillator / ADOSC (Marc Chaikin).
// ----------------------------------------------------------------------------

/**
 * Accumulation/Distribution Line (Chaikin). Per bar the money-flow multiplier
 * scales volume; ADL is the running cumulative total.
 *   mfm = ((close-low) - (high-close)) / (high-low)   (0 when high==low)
 *   adl[i] = adl[i-1] + mfm * volume
 * No warmup: adl[0] is defined. Reference: TA-Lib AD.
 */
export function adLine(bars: readonly OHLCV[]): number[] {
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const h = bars[i]!.high;
    const l = bars[i]!.low;
    const c = bars[i]!.close;
    const range = h - l;
    const mfm = range === 0 ? 0 : (c - l - (h - c)) / range;
    acc += mfm * bars[i]!.volume;
    out[i] = acc;
  }
  return out;
}

/**
 * TA-Lib ADOSC EMA: seeded with the FIRST value of the series (not an SMA seed)
 * and iterated from index 1 with the 2/(n+1) multiplier. This differs from the
 * shared smoothing.ts EMA (SMA-seeded) on purpose — TA-Lib's ADOSC uses the
 * first-value seed, and matching it bit-for-bit requires this exact recurrence.
 * Output is finite from index 0 (the seed); the oscillator below trims it to
 * the slow EMA's documented warmup (index slow-1).
 */
function emaFirstSeeded(x: readonly number[], period: number): number[] {
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  if (n === 0) return out;
  const k = 2 / (period + 1);
  let prev = x[0]!;
  out[0] = prev;
  for (let i = 1; i < n; i++) {
    prev = (x[i]! - prev) * k + prev;
    out[i] = prev;
  }
  return out;
}

/**
 * Chaikin Oscillator (ADOSC). EMA(fast) of the A/D line minus EMA(slow) of it:
 *   ADOSC[i] = EMA(ADL, fast)[i] - EMA(ADL, slow)[i]
 * Matches TA-Lib ADOSC, which first-value-seeds both EMAs (see emaFirstSeeded)
 * and reports the oscillator from the slower EMA's warmup (index slow-1) using
 * the standard 2/(n+1) multipliers. fast/slow default 3/10.
 * Reference: TA-Lib 0.6.8 ADOSC.
 */
export function chaikinOscillator(bars: readonly OHLCV[], fast = 3, slow = 10): number[] {
  assertPeriod(fast);
  assertPeriod(slow);
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  const adl = adLine(bars);
  const ef = emaFirstSeeded(adl, fast);
  const es = emaFirstSeeded(adl, slow);
  // TA-Lib aligns the oscillator to the SLOWER EMA's warmup (index slow-1).
  for (let i = slow - 1; i < n; i++) {
    if (Number.isNaN(ef[i]!) || Number.isNaN(es[i]!)) continue;
    out[i] = ef[i]! - es[i]!;
  }
  return out;
}

/**
 * Streaming Ulcer Index — rolling window of closes; reproduces ulcerIndex().
 */
export function createUlcerIndex(period: number): IndicatorStream {
  assertPeriod(period);
  const buf: number[] = [];
  return {
    push(v: number): number {
      buf.push(v);
      if (buf.length > period) buf.shift();
      if (buf.length < period) return NaN;
      let mx = -Infinity;
      for (const x of buf) if (x > mx) mx = x;
      if (mx <= 0) return NaN;
      let sumSq = 0;
      for (const x of buf) {
        const dd = (100 * (x - mx)) / mx;
        sumSq += dd * dd;
      }
      return Math.sqrt(sumSq / period);
    },
  };
}

const PERIOD = (label: string, def: number) =>
  ({ key: "period", label, type: "int", default: def, min: 1 }) as const;

/** Indicator definitions contributed by this category. */
export const bandsVolExtIndicators: IndicatorDef[] = [
  {
    id: "ulcerindex",
    label: "Ulcer Index",
    category: "volatility",
    inputs: ["close"],
    params: [PERIOD("Period", 14)],
    reference: "StockCharts Ulcer Index (Martin/McCann) — RMS of % drawdown",
    compute: (bars, p) => ulcerIndex(closesOf(bars), p.period ?? 14),
  },
  {
    id: "massindex",
    label: "Mass Index",
    category: "volatility",
    inputs: ["high", "low"],
    params: [
      { key: "emaPeriod", label: "EMA Period", type: "int", default: 9, min: 1 },
      { key: "sumPeriod", label: "Sum Period", type: "int", default: 25, min: 1 },
    ],
    reference: "Donald Dorsey / StockCharts Mass Index — sum of EMA9 ratio over 25",
    compute: (bars, p) => massIndex(bars, p.emaPeriod ?? 9, p.sumPeriod ?? 25),
  },
  {
    id: "histvol",
    label: "Historical Volatility",
    category: "volatility",
    inputs: ["close"],
    params: [
      { key: "period", label: "Period", type: "int", default: 10, min: 2 },
      { key: "annual", label: "Annualization", type: "int", default: 252, min: 1 },
    ],
    reference:
      "Standard close-to-close historical volatility (log-return sample stddev, annualized)",
    compute: (bars, p) => historicalVolatility(closesOf(bars), p.period ?? 10, p.annual ?? 252),
  },
  {
    id: "rvi",
    label: "Relative Vigor Index",
    category: "volatility",
    inputs: ["ohlcv"],
    params: [PERIOD("Period", 10)],
    reference: "John Ehlers RVI / TradingView Pine ta RVI (triangular-weighted)",
    compute: (bars, p) => {
      const r = relativeVigorIndex(bars, p.period ?? 10);
      return { rvi: r.rvi, signal: r.signal };
    },
  },
  {
    id: "starc",
    label: "STARC Bands",
    category: "volatility",
    inputs: ["ohlcv"],
    params: [
      { key: "maPeriod", label: "SMA Period", type: "int", default: 5, min: 1 },
      { key: "atrPeriod", label: "ATR Period", type: "int", default: 15, min: 1 },
      { key: "mult", label: "ATR Mult", type: "float", default: 2, min: 0 },
    ],
    reference: "Manning Stoller STARC bands (SMA basis +/- ATR), TA-Lib ATR primitive",
    compute: (bars, p) => {
      const s = starcBands(bars, p.maPeriod ?? 5, p.atrPeriod ?? 15, p.mult ?? 2);
      return { middle: s.middle, upper: s.upper, lower: s.lower };
    },
  },
  {
    id: "accelbands",
    label: "Acceleration Bands",
    category: "volatility",
    inputs: ["ohlcv"],
    params: [
      PERIOD("Period", 20),
      { key: "factor", label: "Range Factor", type: "float", default: 4, min: 0 },
    ],
    reference: "Price Headley Acceleration Bands (SMA of high/low scaled by range factor)",
    compute: (bars, p) => {
      const a = accelerationBands(bars, p.period ?? 20, p.factor ?? 4);
      return { middle: a.middle, upper: a.upper, lower: a.lower };
    },
  },
  {
    id: "adosc",
    label: "Chaikin Oscillator",
    category: "volatility",
    inputs: ["ohlcv"],
    params: [
      { key: "fast", label: "Fast EMA", type: "int", default: 3, min: 1 },
      { key: "slow", label: "Slow EMA", type: "int", default: 10, min: 1 },
    ],
    reference: "TA-Lib 0.6.8 ADOSC — EMA(fast) - EMA(slow) of the A/D line",
    compute: (bars, p) => chaikinOscillator(bars, p.fast ?? 3, p.slow ?? 10),
  },
];
