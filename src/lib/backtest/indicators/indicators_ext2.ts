/**
 * Indicator batch 2 — genuinely-missing, widely-used studies that the first 84
 * did not cover: Ichimoku lines, Choppiness Index, Elder Ray, Disparity Index,
 * Qstick. Pure, deterministic, dependency-free; output aligned to input length;
 * NaN during warmup; no look-ahead (out[i] depends only on bars[0..i]). Composes
 * from ./smoothing (sma/ema) + ./volatility (trueRange) — never reinvents them.
 *
 * Ichimoku NOTE: the cloud's traditional FORWARD displacement (Senkou plotted
 * +26 bars, Chikou −26) is a CHARTING concern and would either look ahead or
 * lag; we expose each line at the bar it is COMPUTED on (no shift), so a
 * consumer applies displacement explicitly if desired. This keeps the library's
 * no-look-ahead contract intact.
 *
 * References declared per IndicatorDef and asserted in indicators_ext2.test.ts.
 */

import { ema, sma } from "./smoothing";
import { trueRange } from "./volatility";
import type { IndicatorDef } from "./registry";
import { assertPeriod, type OHLCV } from "./types";

const closesOf = (bars: readonly OHLCV[]): number[] => bars.map((b) => b.close);

/** Midpoint of the highest-high and lowest-low over a rolling `period` (Donchian
 *  mid) — the building block of Ichimoku's Tenkan/Kijun/Senkou-B. NaN until the
 *  window is full (first value at index period-1). */
function donchianMid(bars: readonly OHLCV[], period: number): number[] {
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = period - 1; i < n; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j]!.high > hi) hi = bars[j]!.high;
      if (bars[j]!.low < lo) lo = bars[j]!.low;
    }
    out[i] = (hi + lo) / 2;
  }
  return out;
}

/* ─────────────────────────────── Ichimoku ───────────────────────────────── */

/**
 * Ichimoku Kinko Hyo lines (Goichi Hosoda). Multi-output:
 *  - tenkan  = donchianMid(tenkanPeriod)        (Conversion Line, default 9)
 *  - kijun   = donchianMid(kijunPeriod)         (Base Line, default 26)
 *  - senkouA = (tenkan + kijun) / 2             (Leading Span A; NOT shifted)
 *  - senkouB = donchianMid(senkouBPeriod)       (Leading Span B, default 52; NOT shifted)
 * Reference: standard Ichimoku definition (Hosoda / TradingView Pine ta).
 */
export function ichimoku(
  bars: readonly OHLCV[],
  tenkanPeriod: number,
  kijunPeriod: number,
  senkouBPeriod: number
): { tenkan: number[]; kijun: number[]; senkouA: number[]; senkouB: number[] } {
  assertPeriod(tenkanPeriod, "tenkanPeriod");
  assertPeriod(kijunPeriod, "kijunPeriod");
  assertPeriod(senkouBPeriod, "senkouBPeriod");
  const tenkan = donchianMid(bars, tenkanPeriod);
  const kijun = donchianMid(bars, kijunPeriod);
  const senkouB = donchianMid(bars, senkouBPeriod);
  const senkouA = tenkan.map((t, i) =>
    Number.isNaN(t) || Number.isNaN(kijun[i]!) ? NaN : (t + kijun[i]!) / 2
  );
  return { tenkan, kijun, senkouA, senkouB };
}

/* ─────────────────────────── Choppiness Index ───────────────────────────── */

/**
 * Choppiness Index (E.W. Dreiss). High (→100) = choppy/consolidating, low (→0)
 * = trending. CHOP = 100·log10( Σ TR(1)[i-n+1..i] / (maxHigh − minLow) ) / log10(n).
 * First value at index n-1 (TR[0] = high−low). A flat window (maxHigh==minLow)
 * yields NaN (undefined log). Reference: StockCharts / TradingView ta.
 */
export function choppiness(bars: readonly OHLCV[], period: number): number[] {
  assertPeriod(period, "period");
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  const tr = trueRange(bars);
  const denomLog = Math.log10(period);
  for (let i = period - 1; i < n; i++) {
    let sumTr = 0;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      sumTr += tr[j]!;
      if (bars[j]!.high > hi) hi = bars[j]!.high;
      if (bars[j]!.low < lo) lo = bars[j]!.low;
    }
    const range = hi - lo;
    out[i] = range > 0 ? (100 * Math.log10(sumTr / range)) / denomLog : NaN;
  }
  return out;
}

/* ──────────────────────────────── Elder Ray ─────────────────────────────── */

/**
 * Elder Ray (Dr. Alexander Elder). bullPower = high − EMA(close, period);
 * bearPower = low − EMA(close, period) (default period 13). Reference: Elder
 * "Trading for a Living" / StockCharts.
 */
export function elderRay(
  bars: readonly OHLCV[],
  period: number
): { bullPower: number[]; bearPower: number[] } {
  assertPeriod(period, "period");
  const e = ema(closesOf(bars), period);
  const bullPower = bars.map((b, i) => (Number.isNaN(e[i]!) ? NaN : b.high - e[i]!));
  const bearPower = bars.map((b, i) => (Number.isNaN(e[i]!) ? NaN : b.low - e[i]!));
  return { bullPower, bearPower };
}

/* ─────────────────────────────── Disparity ──────────────────────────────── */

/**
 * Disparity Index = 100·(close − SMA(close, period)) / SMA(close, period). The
 * % distance of price from its moving average. Reference: Steve Nison.
 */
export function disparity(bars: readonly OHLCV[], period: number): number[] {
  assertPeriod(period, "period");
  const c = closesOf(bars);
  const m = sma(c, period);
  return c.map((x, i) => (Number.isNaN(m[i]!) || m[i]! === 0 ? NaN : (100 * (x - m[i]!)) / m[i]!));
}

/* ──────────────────────────────── Qstick ────────────────────────────────── */

/**
 * Qstick (Tushar Chande) = SMA(close − open, period). >0 = bullish candle bias,
 * <0 = bearish. Reference: Chande / StockCharts.
 */
export function qstick(bars: readonly OHLCV[], period: number): number[] {
  assertPeriod(period, "period");
  return sma(
    bars.map((b) => b.close - b.open),
    period
  );
}

/* ─────────────────────────────── registry ───────────────────────────────── */

export const ext2Indicators: IndicatorDef[] = [
  {
    id: "ichimoku",
    label: "Ichimoku Cloud",
    category: "trend",
    inputs: ["ohlcv"],
    params: [
      { key: "tenkan", label: "Tenkan", type: "int", default: 9, min: 1, max: 200 },
      { key: "kijun", label: "Kijun", type: "int", default: 26, min: 1, max: 400 },
      { key: "senkouB", label: "Senkou B", type: "int", default: 52, min: 1, max: 800 },
    ],
    reference: "Hosoda Ichimoku Kinko Hyo (TradingView Pine ta) — lines unshifted",
    compute: (bars, p) => ichimoku(bars, p.tenkan ?? 9, p.kijun ?? 26, p.senkouB ?? 52),
  },
  {
    id: "chop",
    label: "Choppiness Index",
    category: "volatility",
    inputs: ["ohlcv"],
    params: [{ key: "period", label: "Period", type: "int", default: 14, min: 2, max: 200 }],
    reference: "Dreiss Choppiness Index (StockCharts)",
    compute: (bars, p) => choppiness(bars, p.period ?? 14),
  },
  {
    id: "elderray",
    label: "Elder Ray (Bull/Bear Power)",
    category: "momentum",
    inputs: ["ohlcv"],
    params: [{ key: "period", label: "EMA period", type: "int", default: 13, min: 1, max: 200 }],
    reference: "Alexander Elder (StockCharts)",
    compute: (bars, p) => elderRay(bars, p.period ?? 13),
  },
  {
    id: "disparity",
    label: "Disparity Index",
    category: "momentum",
    inputs: ["close"],
    params: [{ key: "period", label: "Period", type: "int", default: 14, min: 1, max: 400 }],
    reference: "Steve Nison Disparity Index",
    compute: (bars, p) => disparity(bars, p.period ?? 14),
  },
  {
    id: "qstick",
    label: "Qstick",
    category: "momentum",
    inputs: ["ohlcv"],
    params: [{ key: "period", label: "Period", type: "int", default: 10, min: 1, max: 200 }],
    reference: "Tushar Chande Qstick (StockCharts)",
    compute: (bars, p) => qstick(bars, p.period ?? 10),
  },
];
