/**
 * Volume extensions — additional volume studies that complement the foundation
 * volume module (./volume.ts: OBV, ADL, CMF, PVT, EOM, Force Index, VWAP).
 *
 * Build agents append `IndicatorDef` objects to `volumeExtIndicators` below and
 * add a co-located `volume_ext.test.ts` golden test. They REUSE the shared
 * smoothing primitives from ./smoothing.ts (sma/ema/wilder) and NEVER edit
 * registry.ts or index.ts — `index.ts` already aggregates this array.
 *
 * Implemented here:
 *  - NVI / PVI : Norman Fosback cumulative volume indices (seed 1000).
 *  - Volume Oscillator : percent spread of fast vs slow SMA of volume.
 *  - Twiggs Money Flow : Colin Twiggs, Wilder-smoothed money flow ratio.
 *  - VWAP std-dev bands : cumulative session VWAP +/- mult * volume-weighted std.
 *
 * EXCLUDED (no single authoritative published numeric reference vector):
 *  - Klinger Volume Oscillator (KVO). The volume-force "cumulative measurement"
 *    (cm) accumulation rule differs materially between Klinger's original text,
 *    StockCharts and the common TradingView Pine ports, so there is no canonical
 *    golden vector to assert against. Additionally, with the shared 60-bar
 *    fixture the KVO signal line (EMA13 over EMA34-EMA55) never warms up. Per the
 *    oracle policy we EXCLUDE it rather than pin a contested variant. See the
 *    `excluded` note in volume_ext.test.ts.
 *
 * Conventions (pinned, see types.ts): output aligned to input length; NaN during
 * warmup; no look-ahead; explicit warmup-prefix test; determinism test; one
 * div-by-zero / flat-range gotcha per indicator. EMA/Wilder seed = SMA of first
 * `period` values (first non-NaN at index period-1), per ./smoothing.ts.
 */

import { assertPeriod, type IndicatorStream, type MultiIndicatorStream, type OHLCV } from "./types";
import { sma, wilderSmooth } from "./smoothing";
import type { IndicatorDef } from "./registry";

/**
 * Negative Volume Index (Fosback).
 *   NVI[0] = 1000 (seed). On a volume-DOWN bar (V[i] < V[i-1]) the index grows
 *   by the period close return: NVI[i] = NVI[i-1] * (1 + (C[i]-C[i-1])/C[i-1]).
 *   On a volume-up / unchanged bar the index carries forward unchanged.
 * No warmup NaN (cumulative from the seed). C[i-1]==0 -> no change that bar.
 * Reference: Norman Fosback "Stock Market Logic" (1976) / StockCharts NVI.
 */
export function nvi(close: readonly number[], volume: readonly number[]): number[] {
  const n = close.length;
  const out = new Array<number>(n).fill(NaN);
  if (n === 0) return out;
  let acc = 1000;
  out[0] = acc;
  for (let i = 1; i < n; i++) {
    const prevC = close[i - 1]!;
    if (volume[i]! < volume[i - 1]! && prevC !== 0) {
      acc = acc * (1 + (close[i]! - prevC) / prevC);
    }
    out[i] = acc;
  }
  return out;
}

/** Streaming NVI. Reproduces nvi() exactly. */
export function createNVI(): IndicatorStream<{ close: number; volume: number }> {
  let acc = 1000;
  let prevC = NaN;
  let prevV = NaN;
  let started = false;
  return {
    push(bar: { close: number; volume: number }): number {
      if (!started) {
        prevC = bar.close;
        prevV = bar.volume;
        started = true;
        return acc;
      }
      if (bar.volume < prevV && prevC !== 0) {
        acc = acc * (1 + (bar.close - prevC) / prevC);
      }
      prevC = bar.close;
      prevV = bar.volume;
      return acc;
    },
  };
}

/**
 * Positive Volume Index (Fosback).
 *   PVI[0] = 1000. On a volume-UP bar (V[i] > V[i-1]) the index grows by the
 *   period close return; otherwise it carries forward unchanged.
 * No warmup NaN. C[i-1]==0 -> no change that bar.
 * Reference: Norman Fosback "Stock Market Logic" (1976) / StockCharts PVI.
 */
export function pvi(close: readonly number[], volume: readonly number[]): number[] {
  const n = close.length;
  const out = new Array<number>(n).fill(NaN);
  if (n === 0) return out;
  let acc = 1000;
  out[0] = acc;
  for (let i = 1; i < n; i++) {
    const prevC = close[i - 1]!;
    if (volume[i]! > volume[i - 1]! && prevC !== 0) {
      acc = acc * (1 + (close[i]! - prevC) / prevC);
    }
    out[i] = acc;
  }
  return out;
}

/** Streaming PVI. Reproduces pvi() exactly. */
export function createPVI(): IndicatorStream<{ close: number; volume: number }> {
  let acc = 1000;
  let prevC = NaN;
  let prevV = NaN;
  let started = false;
  return {
    push(bar: { close: number; volume: number }): number {
      if (!started) {
        prevC = bar.close;
        prevV = bar.volume;
        started = true;
        return acc;
      }
      if (bar.volume > prevV && prevC !== 0) {
        acc = acc * (1 + (bar.close - prevC) / prevC);
      }
      prevC = bar.close;
      prevV = bar.volume;
      return acc;
    },
  };
}

/**
 * Volume Oscillator — percent spread of a fast vs slow SMA of volume.
 *   VO = 100 * (SMA(V, fast) - SMA(V, slow)) / SMA(V, slow)
 * First value at index slow-1 (the slow SMA warms last). SMA(V,slow)==0 -> NaN
 * (an all-zero-volume slow window has no meaningful percent spread).
 * Reference: StockCharts Percentage Volume Oscillator applied to volume; the
 * SMA oracle is TA-Lib 0.6.8 SMA.
 */
export function volumeOscillator(volume: readonly number[], fast: number, slow: number): number[] {
  assertPeriod(fast, "fast");
  assertPeriod(slow, "slow");
  const n = volume.length;
  const out = new Array<number>(n).fill(NaN);
  const v = volume as number[];
  const fastMa = sma(v, fast);
  const slowMa = sma(v, slow);
  for (let i = 0; i < n; i++) {
    const f = fastMa[i]!;
    const s = slowMa[i]!;
    if (Number.isNaN(f) || Number.isNaN(s)) continue;
    out[i] = s === 0 ? NaN : (100 * (f - s)) / s;
  }
  return out;
}

/** Per-bar money-flow numerator for Twiggs (true-range bounded). H!=L assumed by caller. */
function twiggsAdValue(
  high: number,
  low: number,
  close: number,
  prevClose: number,
  volume: number
): number {
  const hh = Math.max(high, prevClose);
  const ll = Math.min(low, prevClose);
  const range = hh - ll;
  if (range === 0) return 0;
  return (volume * (2 * close - hh - ll)) / range;
}

/**
 * Twiggs Money Flow (Colin Twiggs).
 *   ad[i] = V[i] * (2*C[i] - HH - LL) / (HH - LL)   with true-range bounds
 *           HH = max(H[i], C[i-1]), LL = min(L[i], C[i-1])   (valid from i>=1)
 *   TMF   = WilderMA(ad, period) / WilderMA(V, period)
 * Both Wilder averages run over the bars from index 1 onward (ad needs C[i-1]),
 * so the first TMF value lands at index `period`. Flat range (HH==LL) -> ad 0;
 * WilderMA(V)==0 -> NaN that bar.
 * Reference: Colin Twiggs / IncredibleCharts Twiggs Money Flow.
 */
export function twiggsMoneyFlow(bars: readonly OHLCV[], period: number): number[] {
  assertPeriod(period);
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < 2) return out;
  // Build ad and volume series from index 1 (each length n-1, all finite).
  const ad: number[] = [];
  const vol: number[] = [];
  for (let i = 1; i < n; i++) {
    const b = bars[i]!;
    ad.push(twiggsAdValue(b.high, b.low, b.close, bars[i - 1]!.close, b.volume));
    vol.push(b.volume);
  }
  const adSmooth = wilderSmooth(ad, period);
  const volSmooth = wilderSmooth(vol, period);
  for (let j = 0; j < adSmooth.length; j++) {
    const a = adSmooth[j]!;
    const v = volSmooth[j]!;
    if (Number.isNaN(a) || Number.isNaN(v) || v === 0) continue;
    out[j + 1] = a / v; // map back to full index j+1
  }
  return out;
}

/** One streaming VWAP-band sample. */
export interface VwapBandPoint {
  middle: number;
  upper: number;
  lower: number;
}

/** VWAP std-dev band channel result — three aligned series. */
export interface VwapBands {
  middle: number[];
  upper: number[];
  lower: number[];
}

/**
 * VWAP standard-deviation bands (session-anchored, cumulative).
 *   tp     = (H+L+C)/3
 *   vwap   = cumsum(tp*V) / cumsum(V)                       within a session
 *   var    = cumsum(tp^2*V)/cumsum(V) - vwap^2              (volume-weighted)
 *   upper  = vwap + mult*sqrt(var);  lower = vwap - mult*sqrt(var)
 * Cumulative sums reset whenever `sessionKey(bar)` changes (each session starts
 * fresh). No warmup NaN within a session; cumsum(V)==0 -> NaN (no traded volume
 * yet). Variance is clamped at 0 against tiny negative float drift.
 * Reference: TradingView "VWAP Bands" (volume-weighted std about session VWAP);
 * the VWAP core matches the foundation ./volume.ts vwap().
 */
export function vwapBands(
  bars: readonly OHLCV[],
  mult = 2,
  sessionKey: (bar: OHLCV) => number | string = (b) => Math.floor(b.time / 86_400_000)
): VwapBands {
  const n = bars.length;
  const middle = new Array<number>(n).fill(NaN);
  const upper = new Array<number>(n).fill(NaN);
  const lower = new Array<number>(n).fill(NaN);
  let cumPV = 0;
  let cumV = 0;
  let cumPV2 = 0;
  let curKey: number | string | undefined;
  for (let i = 0; i < n; i++) {
    const b = bars[i]!;
    const key = sessionKey(b);
    if (curKey === undefined || key !== curKey) {
      curKey = key;
      cumPV = 0;
      cumV = 0;
      cumPV2 = 0;
    }
    const tp = (b.high + b.low + b.close) / 3;
    cumPV += tp * b.volume;
    cumPV2 += tp * tp * b.volume;
    cumV += b.volume;
    if (cumV === 0) continue;
    const w = cumPV / cumV;
    const variance = Math.max(0, cumPV2 / cumV - w * w);
    const sd = Math.sqrt(variance);
    middle[i] = w;
    upper[i] = w + mult * sd;
    lower[i] = w - mult * sd;
  }
  return { middle, upper, lower };
}

/** Streaming VWAP std-dev bands. Reproduces vwapBands() exactly. */
export function createVwapBands(
  mult = 2,
  sessionKey: (bar: OHLCV) => number | string = (b) => Math.floor(b.time / 86_400_000)
): MultiIndicatorStream<OHLCV, VwapBandPoint> {
  let cumPV = 0;
  let cumV = 0;
  let cumPV2 = 0;
  let curKey: number | string | undefined;
  return {
    push(b: OHLCV): VwapBandPoint {
      const key = sessionKey(b);
      if (curKey === undefined || key !== curKey) {
        curKey = key;
        cumPV = 0;
        cumV = 0;
        cumPV2 = 0;
      }
      const tp = (b.high + b.low + b.close) / 3;
      cumPV += tp * b.volume;
      cumPV2 += tp * tp * b.volume;
      cumV += b.volume;
      if (cumV === 0) return { middle: NaN, upper: NaN, lower: NaN };
      const w = cumPV / cumV;
      const variance = Math.max(0, cumPV2 / cumV - w * w);
      const sd = Math.sqrt(variance);
      return { middle: w, upper: w + mult * sd, lower: w - mult * sd };
    },
  };
}

/** Indicator definitions contributed by this category. */
export const volumeExtIndicators: IndicatorDef[] = [
  {
    id: "nvi",
    label: "Negative Volume Index",
    category: "volume",
    inputs: ["close", "volume"],
    params: [],
    reference: "Fosback (1976) / StockCharts NVI — cumulative, seed 1000",
    compute: (bars) =>
      nvi(
        bars.map((b) => b.close),
        bars.map((b) => b.volume)
      ),
  },
  {
    id: "pvi",
    label: "Positive Volume Index",
    category: "volume",
    inputs: ["close", "volume"],
    params: [],
    reference: "Fosback (1976) / StockCharts PVI — cumulative, seed 1000",
    compute: (bars) =>
      pvi(
        bars.map((b) => b.close),
        bars.map((b) => b.volume)
      ),
  },
  {
    id: "volosc",
    label: "Volume Oscillator",
    category: "volume",
    inputs: ["volume"],
    params: [
      { key: "fast", label: "Fast Period", type: "int", default: 5, min: 1 },
      { key: "slow", label: "Slow Period", type: "int", default: 10, min: 1 },
    ],
    reference: "StockCharts Volume Oscillator (percent of SMA spread; TA-Lib SMA oracle)",
    compute: (bars, p) =>
      volumeOscillator(
        bars.map((b) => b.volume),
        p.fast ?? 5,
        p.slow ?? 10
      ),
  },
  {
    id: "tmf",
    label: "Twiggs Money Flow",
    category: "volume",
    inputs: ["ohlcv"],
    params: [{ key: "period", label: "Period", type: "int", default: 21, min: 1 }],
    reference: "Colin Twiggs / IncredibleCharts Twiggs Money Flow (Wilder-smoothed)",
    compute: (bars, p) => twiggsMoneyFlow(bars, p.period ?? 21),
  },
  {
    id: "vwap_bands",
    label: "VWAP Std-Dev Bands",
    category: "volume",
    inputs: ["ohlcv"],
    params: [{ key: "mult", label: "Std-Dev Multiplier", type: "float", default: 2, min: 0 }],
    reference: "TradingView VWAP Bands — session VWAP +/- mult * volume-weighted std",
    compute: (bars, p) => {
      const b = vwapBands(bars, p.mult ?? 2);
      return { middle: b.middle, upper: b.upper, lower: b.lower };
    },
  },
];
