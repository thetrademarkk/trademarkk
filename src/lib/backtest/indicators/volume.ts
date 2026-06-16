/**
 * Volume indicators — OBV, AD/ADL, CMF, VWAP (session-anchored), PVT, EOM,
 * Force Index. Pure, deterministic, dependency-free; aligned to input length;
 * NaN during warmup; never looks ahead.
 *
 * Seeding / convention notes (pinned per indicator):
 *  - OBV: cumulative; out[0] = volume[0] (TA-Lib parity). No warmup NaN.
 *  - AD/ADL: cumulative Chaikin A/D line; out[0] is the first bar's MFV
 *    (TA-Lib parity). No warmup NaN. H==L -> money-flow multiplier 0.
 *  - CMF: rolling sum(MFV, n) / sum(V, n); first value at index n-1. flat-bar
 *    multiplier 0; sum(V)==0 -> 0.
 *  - VWAP: session-anchored cumulative sum(TP*V)/sum(V) reset at each new
 *    session key; resets to NaN-free from the first bar of each session.
 *  - PVT: cumulative; seed PVT[0] = 0 (StockCharts); first non-trivial at i=1.
 *  - EOM: 1-period EMV (StockCharts scale 1e8) then SMA(period); first value at
 *    index `period`. H==L -> EMV 0.
 *  - Force Index: FI(period) = EMA(period) of raw force (C-Cprev)*V (Elder);
 *    raw force valid from index 1, EMA seeded SMA-of-first-period.
 *
 * References (declared, golden-tested):
 *  - OBV / AD: TA-Lib 0.6.8 (offline pandas oracle).
 *  - CMF: StockCharts / TradingView Pine ta.cmf (period 20).
 *  - PVT: StockCharts Price Volume Trend.
 *  - EOM: StockCharts Ease of Movement (scale 1e8, 14-period SMA).
 *  - Force Index: Alexander Elder / StockCharts Force Index (13-period EMA).
 *  - VWAP: TradingView Pine ta.vwap (session-anchored cumulative).
 */

import { assertPeriod, type IndicatorStream, type OHLCV } from "./types";
import { ema } from "./smoothing";
import type { IndicatorDef } from "./registry";

/**
 * On-Balance Volume (Granville).
 *   OBV[0] = V[0];  OBV[i] = OBV[i-1] + sign(C[i]-C[i-1]) * V[i]
 * No warmup NaN (cumulative from the first bar). Reference: TA-Lib OBV.
 */
export function obv(close: readonly number[], volume: readonly number[]): number[] {
  const n = close.length;
  const out = new Array<number>(n).fill(NaN);
  if (n === 0) return out;
  let acc = volume[0]!;
  out[0] = acc;
  for (let i = 1; i < n; i++) {
    const d = close[i]! - close[i - 1]!;
    if (d > 0) acc += volume[i]!;
    else if (d < 0) acc -= volume[i]!;
    out[i] = acc;
  }
  return out;
}

/** Streaming OBV. Reproduces obv() exactly. */
export function createOBV(): IndicatorStream<{ close: number; volume: number }> {
  let acc = 0;
  let prevClose = NaN;
  let started = false;
  return {
    push(bar: { close: number; volume: number }): number {
      if (!started) {
        acc = bar.volume;
        prevClose = bar.close;
        started = true;
        return acc;
      }
      const d = bar.close - prevClose;
      if (d > 0) acc += bar.volume;
      else if (d < 0) acc -= bar.volume;
      prevClose = bar.close;
      return acc;
    },
  };
}

/** Money-flow multiplier ((C-L)-(H-C))/(H-L). H==L -> 0 (avoids div-by-zero). */
function moneyFlowMultiplier(h: number, l: number, c: number): number {
  const range = h - l;
  if (range === 0) return 0;
  return (c - l - (h - c)) / range;
}

/**
 * Accumulation/Distribution Line (Chaikin).
 *   MFV = ((C-L)-(H-C))/(H-L) * V;  ADL[i] = ADL[i-1] + MFV[i]
 * Cumulative from the first bar (no warmup NaN). H==L -> MFV 0.
 * Reference: TA-Lib AD.
 */
export function adl(bars: readonly OHLCV[]): number[] {
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const b = bars[i]!;
    acc += moneyFlowMultiplier(b.high, b.low, b.close) * b.volume;
    out[i] = acc;
  }
  return out;
}

/** Streaming AD/ADL. Reproduces adl() exactly. */
export function createADL(): IndicatorStream<OHLCV> {
  let acc = 0;
  return {
    push(b: OHLCV): number {
      acc += moneyFlowMultiplier(b.high, b.low, b.close) * b.volume;
      return acc;
    },
  };
}

/**
 * Chaikin Money Flow.
 *   CMF = sum(MFV, period) / sum(V, period)
 * First value at index period-1. sum(V)==0 -> 0. H==L bars contribute MFV 0.
 * Reference: StockCharts / TradingView Pine ta.cmf.
 */
export function cmf(bars: readonly OHLCV[], period: number): number[] {
  assertPeriod(period);
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  let mfvSum = 0;
  let volSum = 0;
  for (let i = 0; i < n; i++) {
    const b = bars[i]!;
    mfvSum += moneyFlowMultiplier(b.high, b.low, b.close) * b.volume;
    volSum += b.volume;
    if (i >= period) {
      const o = bars[i - period]!;
      mfvSum -= moneyFlowMultiplier(o.high, o.low, o.close) * o.volume;
      volSum -= o.volume;
    }
    if (i >= period - 1) out[i] = volSum === 0 ? 0 : mfvSum / volSum;
  }
  return out;
}

/**
 * Price Volume Trend (cumulative).
 *   PVT[0] = 0;  PVT[i] = PVT[i-1] + V[i] * (C[i]-C[i-1]) / C[i-1]
 * No warmup NaN (seed 0). C[i-1]==0 contributes 0. Reference: StockCharts PVT.
 */
export function pvt(close: readonly number[], volume: readonly number[]): number[] {
  const n = close.length;
  const out = new Array<number>(n).fill(NaN);
  if (n === 0) return out;
  let acc = 0;
  out[0] = 0;
  for (let i = 1; i < n; i++) {
    const prev = close[i - 1]!;
    if (prev !== 0) acc += (volume[i]! * (close[i]! - prev)) / prev;
    out[i] = acc;
  }
  return out;
}

/** Streaming PVT. Reproduces pvt() exactly. */
export function createPVT(): IndicatorStream<{ close: number; volume: number }> {
  let acc = 0;
  let prevClose = NaN;
  let started = false;
  return {
    push(bar: { close: number; volume: number }): number {
      if (!started) {
        prevClose = bar.close;
        started = true;
        return 0;
      }
      if (prevClose !== 0) acc += (bar.volume * (bar.close - prevClose)) / prevClose;
      prevClose = bar.close;
      return acc;
    },
  };
}

/**
 * Ease of Movement (Arms / StockCharts).
 *   distance  = (H+L)/2 - (Hprev+Lprev)/2
 *   boxRatio  = (V / SCALE) / (H-L)            (SCALE = 1e8)
 *   EMV1      = distance / boxRatio            (H==L -> EMV1 = 0)
 *   EOM       = SMA(EMV1, period)
 * Single-period EMV valid from index 1; first SMA value at index `period`.
 * Reference: StockCharts Ease of Movement (scale 1e8, 14-period SMA).
 */
export function eom(bars: readonly OHLCV[], period: number): number[] {
  assertPeriod(period);
  const SCALE = 1e8;
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  const emv1 = new Array<number>(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    const b = bars[i]!;
    const p = bars[i - 1]!;
    const range = b.high - b.low;
    if (range === 0) {
      emv1[i] = 0;
      continue;
    }
    const distance = (b.high + b.low) / 2 - (p.high + p.low) / 2;
    const boxRatio = b.volume / SCALE / range;
    emv1[i] = boxRatio === 0 ? 0 : distance / boxRatio;
  }
  // SMA(period) over emv1; emv1[0] is NaN so first full window ends at index period.
  let sum = 0;
  for (let i = 1; i < n; i++) {
    sum += emv1[i]!;
    if (i >= period + 1) sum -= emv1[i - period]!;
    if (i >= period) out[i] = sum / period;
  }
  return out;
}

/**
 * Force Index (Elder).
 *   raw[i] = (C[i] - C[i-1]) * V[i]          (valid from index 1)
 *   FI     = EMA(raw, period)                (SMA-seeded EMA, TA-Lib parity)
 * First EMA value at index `period` (raw starts at 1, EMA needs `period` of them).
 * Reference: Alexander Elder / StockCharts Force Index (13-period EMA).
 */
export function forceIndex(
  close: readonly number[],
  volume: readonly number[],
  period: number
): number[] {
  assertPeriod(period);
  const n = close.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < 2) return out;
  // raw force from index 1..n-1 (length n-1, all finite).
  const raw: number[] = [];
  for (let i = 1; i < n; i++) raw.push((close[i]! - close[i - 1]!) * volume[i]!);
  const emaRaw = ema(raw, period);
  // Map emaRaw[j] back to full index j+1.
  for (let j = 0; j < emaRaw.length; j++) {
    out[j + 1] = emaRaw[j]!;
  }
  return out;
}

/**
 * Session-anchored VWAP.
 *   VWAP = cumsum(TP*V) / cumsum(V)   within a session, TP = (H+L+C)/3
 * The cumulative sums reset whenever `sessionKey(bar)` changes, so each trading
 * session starts fresh. No warmup NaN within a session; cumsum(V)==0 -> NaN
 * (no traded volume yet). Reference: TradingView Pine ta.vwap (session anchor).
 *
 * `sessionKey` defaults to the UTC calendar day; pass a custom key (e.g. an IST
 * 09:15 session id) to anchor differently. This is the pure numeric core — the
 * session spine is the caller's concern (see types.ts header).
 */
export function vwap(
  bars: readonly OHLCV[],
  sessionKey: (bar: OHLCV) => number | string = (b) => Math.floor(b.time / 86_400_000)
): number[] {
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  let cumPV = 0;
  let cumV = 0;
  let curKey: number | string | undefined;
  for (let i = 0; i < n; i++) {
    const b = bars[i]!;
    const key = sessionKey(b);
    if (curKey === undefined || key !== curKey) {
      curKey = key;
      cumPV = 0;
      cumV = 0;
    }
    const tp = (b.high + b.low + b.close) / 3;
    cumPV += tp * b.volume;
    cumV += b.volume;
    out[i] = cumV === 0 ? NaN : cumPV / cumV;
  }
  return out;
}

/** Streaming session-anchored VWAP. Reproduces vwap() exactly. */
export function createVWAP(
  sessionKey: (bar: OHLCV) => number | string = (b) => Math.floor(b.time / 86_400_000)
): IndicatorStream<OHLCV> {
  let cumPV = 0;
  let cumV = 0;
  let curKey: number | string | undefined;
  return {
    push(b: OHLCV): number {
      const key = sessionKey(b);
      if (curKey === undefined || key !== curKey) {
        curKey = key;
        cumPV = 0;
        cumV = 0;
      }
      const tp = (b.high + b.low + b.close) / 3;
      cumPV += tp * b.volume;
      cumV += b.volume;
      return cumV === 0 ? NaN : cumPV / cumV;
    },
  };
}

/** Indicator definitions contributed by this category. */
export const volumeIndicators: IndicatorDef[] = [
  {
    id: "obv",
    label: "On-Balance Volume",
    category: "volume",
    inputs: ["close", "volume"],
    params: [],
    reference: "TA-Lib 0.6.8 OBV (offline pandas oracle)",
    compute: (bars) =>
      obv(
        bars.map((b) => b.close),
        bars.map((b) => b.volume)
      ),
  },
  {
    id: "adl",
    label: "Accumulation/Distribution Line",
    category: "volume",
    inputs: ["ohlcv"],
    params: [],
    reference: "TA-Lib 0.6.8 AD (offline pandas oracle)",
    compute: (bars) => adl(bars),
  },
  {
    id: "cmf",
    label: "Chaikin Money Flow",
    category: "volume",
    inputs: ["ohlcv"],
    params: [{ key: "period", label: "Period", type: "int", default: 20, min: 1 }],
    reference: "StockCharts / TradingView Pine ta.cmf",
    compute: (bars, p) => cmf(bars, p.period ?? 20),
  },
  {
    id: "pvt",
    label: "Price Volume Trend",
    category: "volume",
    inputs: ["close", "volume"],
    params: [],
    reference: "StockCharts Price Volume Trend (cumulative, seed 0)",
    compute: (bars) =>
      pvt(
        bars.map((b) => b.close),
        bars.map((b) => b.volume)
      ),
  },
  {
    id: "eom",
    label: "Ease of Movement",
    category: "volume",
    inputs: ["ohlcv"],
    params: [{ key: "period", label: "Period", type: "int", default: 14, min: 1 }],
    reference: "StockCharts Ease of Movement (scale 1e8, SMA smoothing)",
    compute: (bars, p) => eom(bars, p.period ?? 14),
  },
  {
    id: "forceindex",
    label: "Force Index",
    category: "volume",
    inputs: ["close", "volume"],
    params: [{ key: "period", label: "Period", type: "int", default: 13, min: 1 }],
    reference: "Elder / StockCharts Force Index (EMA of (C-Cprev)*V)",
    compute: (bars, p) =>
      forceIndex(
        bars.map((b) => b.close),
        bars.map((b) => b.volume),
        p.period ?? 13
      ),
  },
  {
    id: "vwap",
    label: "VWAP (session-anchored)",
    category: "volume",
    inputs: ["ohlcv"],
    params: [],
    reference: "TradingView Pine ta.vwap (session-anchored cumulative)",
    compute: (bars) => vwap(bars),
  },
];
