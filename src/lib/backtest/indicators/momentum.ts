/**
 * Momentum oscillators.
 *
 * FOUNDATION (reference pattern): RSI (Wilder smoothing). Category agents
 * append their IndicatorDef objects to `momentumIndicators` and add a
 * co-located golden test; they do NOT edit registry.ts or index.ts.
 *
 * References: RSI = Wilder 1978 worked example, cross-checked vs TA-Lib RSI.
 */

import {
  assertPeriod,
  closes,
  type IndicatorStream,
  type MultiIndicatorStream,
  type OHLCV,
} from "./types";
import { sma, ema, createEMA } from "./smoothing";
import type { IndicatorDef } from "./registry";

/**
 * Relative Strength Index (Wilder, 1978).
 *
 * avgGain / avgLoss are Wilder-smoothed (α = 1/period) over the up/down moves.
 * The first period of price-changes (period gains/losses, i.e. period+1 prices)
 * is averaged as the seed, so the first RSI value lands at index `period`.
 *   RS = avgGain / avgLoss;  RSI = 100 - 100/(1+RS)
 * Div-by-zero: avgLoss == 0 -> RSI = 100; avgGain == 0 -> RSI = 0.
 *
 * Warmup: indices 0..period-1 are NaN; first RSI at index `period`.
 * Reference: Wilder 1978 / StockCharts canonical RSI worked example.
 */
export function rsi(x: readonly number[], period: number): number[] {
  assertPeriod(period);
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < period + 1) return out;

  let gainSum = 0;
  let lossSum = 0;
  // Seed: average of the first `period` changes (over x[0..period]).
  for (let i = 1; i <= period; i++) {
    const ch = x[i]! - x[i - 1]!;
    if (ch > 0) gainSum += ch;
    else lossSum -= ch; // -ch is the positive loss magnitude
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = rsiFrom(avgGain, avgLoss);

  for (let i = period + 1; i < n; i++) {
    const ch = x[i]! - x[i - 1]!;
    const gain = ch > 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiFrom(avgGain, avgLoss);
  }
  return out;
}

function rsiFrom(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Streaming RSI — Wilder-smoothed, reproduces rsi() exactly. */
export function createRSI(period: number): IndicatorStream {
  assertPeriod(period);
  let prev = NaN;
  let count = 0; // number of prices seen
  let seedGain = 0;
  let seedLoss = 0;
  let avgGain = NaN;
  let avgLoss = NaN;
  return {
    push(v: number): number {
      count++;
      if (count === 1) {
        prev = v;
        return NaN;
      }
      const ch = v - prev;
      prev = v;
      const gain = ch > 0 ? ch : 0;
      const loss = ch < 0 ? -ch : 0;
      const changesSeen = count - 1;
      if (changesSeen < period) {
        // Accumulate the seed over the first `period` changes (1..period).
        seedGain += gain;
        seedLoss += loss;
        return NaN;
      }
      if (changesSeen === period) {
        // The period-th change completes the seed; first RSI is emitted here.
        seedGain += gain;
        seedLoss += loss;
        avgGain = seedGain / period;
        avgLoss = seedLoss / period;
        return rsiFrom(avgGain, avgLoss);
      }
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      return rsiFrom(avgGain, avgLoss);
    },
  };
}

// ----------------------------------------------------------------------------
// Helpers — rolling highest-high / lowest-low over OHLCV (shared by Stoch/WilliamsR).
// ----------------------------------------------------------------------------

/** Rolling max of `xs` over the last `period` samples; NaN for i < period-1. */
function rollMax(xs: readonly number[], period: number): number[] {
  const n = xs.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = period - 1; i < n; i++) {
    let m = xs[i]!;
    for (let j = i - period + 1; j < i; j++) if (xs[j]! > m) m = xs[j]!;
    out[i] = m;
  }
  return out;
}

/** Rolling min of `xs` over the last `period` samples; NaN for i < period-1. */
function rollMin(xs: readonly number[], period: number): number[] {
  const n = xs.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = period - 1; i < n; i++) {
    let m = xs[i]!;
    for (let j = i - period + 1; j < i; j++) if (xs[j]! < m) m = xs[j]!;
    out[i] = m;
  }
  return out;
}

const highsOf = (bars: readonly OHLCV[]): number[] => bars.map((b) => b.high);
const lowsOf = (bars: readonly OHLCV[]): number[] => bars.map((b) => b.low);
const typPrice = (b: OHLCV): number => (b.high + b.low + b.close) / 3;

// ----------------------------------------------------------------------------
// Stochastic Oscillator (%K / %D).
// ----------------------------------------------------------------------------

/**
 * Raw fast %K = 100 * (close - LL_k) / (HH_k - LL_k) over the last `kPeriod`
 * bars (HH/LL of high/low). Flat range HH==LL -> 0 (no div-by-zero).
 * Internal — first value at index kPeriod-1.
 */
function rawStochK(bars: readonly OHLCV[], kPeriod: number): number[] {
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  const hh = rollMax(highsOf(bars), kPeriod);
  const ll = rollMin(lowsOf(bars), kPeriod);
  for (let i = kPeriod - 1; i < n; i++) {
    const range = hh[i]! - ll[i]!;
    out[i] = range === 0 ? 0 : (100 * (bars[i]!.close - ll[i]!)) / range;
  }
  return out;
}

/** SMA that propagates NaN warmup of its input (skips leading NaN, seeds at first window). */
function smaOfValid(xs: readonly number[], period: number): number[] {
  const n = xs.length;
  const out = new Array<number>(n).fill(NaN);
  // First non-NaN index in xs.
  let start = 0;
  while (start < n && Number.isNaN(xs[start]!)) start++;
  let sum = 0;
  let count = 0;
  for (let i = start; i < n; i++) {
    sum += xs[i]!;
    count++;
    if (count > period) sum -= xs[i - period]!;
    if (count >= period) out[i] = sum / period;
  }
  return out;
}

/**
 * Slow Stochastic Oscillator (TA-Lib STOCH parity).
 *   rawK = 100*(C - LLn)/(HHn - LLn)   (fastk_period = kPeriod)
 *   %K (slowk) = SMA(rawK, slowK)
 *   %D (slowd) = SMA(%K, dPeriod)
 * TA-Lib aligns BOTH outputs to where %D is valid (first value at index
 * kPeriod-1 + (slowK-1) + (dPeriod-1)). Default 14/3/3 -> first at index 17.
 * Flat range -> rawK 0. Reference: TA-Lib 0.6.8 STOCH (slowk_matype/slowd_matype = SMA).
 */
export function stoch(
  bars: readonly OHLCV[],
  kPeriod = 14,
  slowK = 3,
  dPeriod = 3
): { k: number[]; d: number[] } {
  assertPeriod(kPeriod);
  assertPeriod(slowK);
  assertPeriod(dPeriod);
  const n = bars.length;
  const rawK = rawStochK(bars, kPeriod);
  const slowKArr = smaOfValid(rawK, slowK);
  const slowDArr = smaOfValid(slowKArr, dPeriod);
  // TA-Lib aligns %K to %D's first-valid index.
  const k = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) if (!Number.isNaN(slowDArr[i]!)) k[i] = slowKArr[i]!;
  return { k, d: slowDArr };
}

/**
 * Fast Stochastic Oscillator (TA-Lib STOCHF parity).
 *   %K = rawK = 100*(C - LLn)/(HHn - LLn)
 *   %D = SMA(%K, dPeriod)
 * Both outputs aligned to %D's first-valid index. Default 14/3 -> first at 15.
 * Reference: TA-Lib 0.6.8 STOCHF.
 */
export function stochFast(
  bars: readonly OHLCV[],
  kPeriod = 14,
  dPeriod = 3
): { k: number[]; d: number[] } {
  assertPeriod(kPeriod);
  assertPeriod(dPeriod);
  const n = bars.length;
  const rawK = rawStochK(bars, kPeriod);
  const fastD = smaOfValid(rawK, dPeriod);
  const k = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) if (!Number.isNaN(fastD[i]!)) k[i] = rawK[i]!;
  return { k, d: fastD };
}

// ----------------------------------------------------------------------------
// Stochastic RSI.
// ----------------------------------------------------------------------------

/**
 * Stochastic RSI (TA-Lib STOCHRSI parity).
 *   r = RSI(close, rsiPeriod)
 *   fast %K = 100 * (r - min(r, kPeriod)) / (max(r, kPeriod) - min(r, kPeriod))
 *   fast %D = SMA(%K, dPeriod)
 * Both aligned to %D's first-valid index. Default 14/14/3 -> first at index 29.
 * Flat RSI window (max==min) -> %K 0 (no div-by-zero).
 * Reference: TA-Lib 0.6.8 STOCHRSI.
 */
export function stochRsi(
  x: readonly number[],
  rsiPeriod = 14,
  kPeriod = 14,
  dPeriod = 3
): { k: number[]; d: number[] } {
  assertPeriod(rsiPeriod);
  assertPeriod(kPeriod);
  assertPeriod(dPeriod);
  const n = x.length;
  const r = rsi(x, rsiPeriod);
  const fastK = new Array<number>(n).fill(NaN);
  // Stoch of RSI: only over the valid RSI region.
  for (let i = 0; i < n; i++) {
    if (i - kPeriod + 1 < 0) continue;
    // Require the full kPeriod window of RSI values to be non-NaN.
    let ok = true;
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      const rv = r[j]!;
      if (Number.isNaN(rv)) {
        ok = false;
        break;
      }
      if (rv > hh) hh = rv;
      if (rv < ll) ll = rv;
    }
    if (!ok) continue;
    const range = hh - ll;
    fastK[i] = range === 0 ? 0 : (100 * (r[i]! - ll)) / range;
  }
  const fastD = smaOfValid(fastK, dPeriod);
  const k = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) if (!Number.isNaN(fastD[i]!)) k[i] = fastK[i]!;
  return { k, d: fastD };
}

// ----------------------------------------------------------------------------
// CCI (Commodity Channel Index).
// ----------------------------------------------------------------------------

/**
 * Commodity Channel Index (Lambert).
 *   TP = (H+L+C)/3;  CCI = (TP - SMA(TP, n)) / (0.015 * meanDev)
 *   meanDev = mean(|TP - SMA(TP,n)|) over the window.
 * meanDev == 0 (flat) -> 0 (no div-by-zero). First value at index n-1.
 * Reference: TA-Lib 0.6.8 CCI.
 */
export function cci(bars: readonly OHLCV[], period = 20): number[] {
  assertPeriod(period);
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  const tp = bars.map(typPrice);
  const tpSma = sma(tp, period);
  for (let i = period - 1; i < n; i++) {
    const mean = tpSma[i]!;
    let dev = 0;
    for (let j = i - period + 1; j <= i; j++) dev += Math.abs(tp[j]! - mean);
    const meanDev = dev / period;
    out[i] = meanDev === 0 ? 0 : (tp[i]! - mean) / (0.015 * meanDev);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Williams %R.
// ----------------------------------------------------------------------------

/**
 * Williams %R.
 *   %R = -100 * (HHn - close) / (HHn - LLn)
 * Range [-100, 0]. Flat range HHn==LLn -> 0 (no div-by-zero). First at n-1.
 * Reference: TA-Lib 0.6.8 WILLR.
 */
export function williamsR(bars: readonly OHLCV[], period = 14): number[] {
  assertPeriod(period);
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  const hh = rollMax(highsOf(bars), period);
  const ll = rollMin(lowsOf(bars), period);
  for (let i = period - 1; i < n; i++) {
    const range = hh[i]! - ll[i]!;
    out[i] = range === 0 ? 0 : (-100 * (hh[i]! - bars[i]!.close)) / range;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Rate of Change & Momentum.
// ----------------------------------------------------------------------------

/**
 * Rate of Change (percentage). roc[i] = 100 * (x[i] - x[i-n]) / x[i-n].
 * First value at index n. Reference: TA-Lib 0.6.8 ROC.
 */
export function roc(x: readonly number[], period = 10): number[] {
  assertPeriod(period);
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = period; i < n; i++) {
    const base = x[i - period]!;
    out[i] = base === 0 ? 0 : (100 * (x[i]! - base)) / base;
  }
  return out;
}

/**
 * Momentum. mom[i] = x[i] - x[i-n]. First value at index n.
 * Reference: TA-Lib 0.6.8 MOM.
 */
export function momentum(x: readonly number[], period = 10): number[] {
  assertPeriod(period);
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = period; i < n; i++) out[i] = x[i]! - x[i - period]!;
  return out;
}

// ----------------------------------------------------------------------------
// MFI (Money Flow Index).
// ----------------------------------------------------------------------------

/**
 * Money Flow Index (volume-weighted RSI).
 *   TP = (H+L+C)/3;  rawMF = TP * volume
 *   posMF/negMF summed over the window by sign of TP change vs prior bar.
 *   MFI = 100 - 100/(1 + posMF/negMF);  negMF == 0 -> 100; posMF == 0 -> 0.
 * First value at index `period` (needs `period` TP changes). Reference:
 * TA-Lib 0.6.8 MFI.
 */
export function mfi(bars: readonly OHLCV[], period = 14): number[] {
  assertPeriod(period);
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < period + 1) return out;
  const tp = bars.map(typPrice);
  const rawMF = bars.map((b, i) => tp[i]! * b.volume);
  for (let i = period; i < n; i++) {
    let pos = 0;
    let neg = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = tp[j]! - tp[j - 1]!;
      if (d > 0) pos += rawMF[j]!;
      else if (d < 0) neg += rawMF[j]!;
      // d == 0 contributes to neither (TA-Lib convention).
    }
    if (neg === 0) out[i] = pos === 0 ? 50 : 100;
    else out[i] = 100 - 100 / (1 + pos / neg);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Ultimate Oscillator.
// ----------------------------------------------------------------------------

/**
 * Ultimate Oscillator (Williams).
 *   BP = close - min(low, prevClose);  TR = max(high, prevClose) - min(low, prevClose)
 *   avg_p = sum(BP, p) / sum(TR, p)
 *   UO = 100 * (4*avg7 + 2*avg14 + avg28) / 7
 * First value at index `long` (default 28). Reference: TA-Lib 0.6.8 ULTOSC.
 */
export function ultimateOscillator(
  bars: readonly OHLCV[],
  short = 7,
  medium = 14,
  long = 28
): number[] {
  assertPeriod(short);
  assertPeriod(medium);
  assertPeriod(long);
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  const bp = new Array<number>(n).fill(NaN);
  const tr = new Array<number>(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    const pc = bars[i - 1]!.close;
    const low = Math.min(bars[i]!.low, pc);
    bp[i] = bars[i]!.close - low;
    tr[i] = Math.max(bars[i]!.high, pc) - low;
  }
  const sumWin = (arr: number[], i: number, p: number): number => {
    let s = 0;
    for (let j = i - p + 1; j <= i; j++) s += arr[j]!;
    return s;
  };
  for (let i = long; i < n; i++) {
    const trS = sumWin(tr, i, short);
    const trM = sumWin(tr, i, medium);
    const trL = sumWin(tr, i, long);
    const a1 = trS === 0 ? 0 : sumWin(bp, i, short) / trS;
    const a2 = trM === 0 ? 0 : sumWin(bp, i, medium) / trM;
    const a3 = trL === 0 ? 0 : sumWin(bp, i, long) / trL;
    out[i] = (100 * (4 * a1 + 2 * a2 + a3)) / 7;
  }
  return out;
}

// ----------------------------------------------------------------------------
// MACD.
// ----------------------------------------------------------------------------

/**
 * MACD (Appel).
 *   macd = EMA(close, fast) - EMA(close, slow)
 *   signal = EMA(macd, signalPeriod);  hist = macd - signal
 * EMA = 2/(n+1) multiplier with SMA seed (the pinned EMA seed in smoothing.ts,
 * TA-Lib EMA parity). All three outputs are aligned to where the signal EMA is
 * first valid: index (slow-1) + (signalPeriod-1). Default 12/26/9 -> first at
 * index 33.
 *
 * Reference: TA-Lib 0.6.8 MACD. NOTE: TA-Lib's internal MACD seeds its EMAs with
 * a slightly different unstable-period offset, so the EARLY values differ by a
 * seeding transient that DAMPS OUT — this SMA-seeded composition converges to
 * TA-Lib's MACD within 1e-4 from index ~55 (line) / ~63 (signal). The golden
 * test asserts the CONVERGED TAIL (design-doc rule for recursive indicators);
 * the streaming form reproduces THIS batch form byte-for-byte.
 */
export function macd(
  x: readonly number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): { macd: number[]; signal: number[]; hist: number[] } {
  assertPeriod(fast);
  assertPeriod(slow);
  assertPeriod(signalPeriod);
  const n = x.length;
  const emaFast = ema(x, fast);
  const emaSlow = ema(x, slow);
  // Raw MACD line — valid from index slow-1 (where the slow EMA seeds).
  const rawMacd = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(emaSlow[i]!)) rawMacd[i] = emaFast[i]! - emaSlow[i]!;
  }
  // Signal = EMA of the macd line, seeded over its first `signalPeriod` valid
  // values (the contiguous tail starting at slow-1). Compute on the compacted
  // tail then scatter back to aligned indices.
  const sigAligned = new Array<number>(n).fill(NaN);
  let start = 0;
  while (start < n && Number.isNaN(rawMacd[start]!)) start++;
  if (start < n) {
    const tail = rawMacd.slice(start);
    const sigTail = ema(tail, signalPeriod);
    for (let i = 0; i < sigTail.length; i++) sigAligned[start + i] = sigTail[i]!;
  }
  // TA-Lib aligns the macd line + hist to where the signal is first valid.
  const macdOut = new Array<number>(n).fill(NaN);
  const hist = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(sigAligned[i]!)) {
      macdOut[i] = rawMacd[i]!;
      hist[i] = rawMacd[i]! - sigAligned[i]!;
    }
  }
  return { macd: macdOut, signal: sigAligned, hist };
}

// ----------------------------------------------------------------------------
// TSI (True Strength Index).
// ----------------------------------------------------------------------------

/**
 * True Strength Index (Blau) — double-smoothed momentum.
 *   pc = close - prevClose
 *   TSI = 100 * EMA(EMA(pc, slow), fast) / EMA(EMA(|pc|, slow), fast)
 * Here EMA is the recursive 2/(n+1) form seeded at the FIRST sample (the
 * `bukosabino/ta` / pandas ewm(adjust=False) convention this is verified
 * against). The double-EMA carries a long warmup transient; the series
 * CONVERGES (tested on the tail). First numeric value at index 1 (after the
 * first price-change); the early values differ from a tail-converged reference
 * by the EMA seeding transient, so the golden test asserts the CONVERGED TAIL.
 * Reference: bukosabino/ta 0.11 TSIIndicator (MIT), cross-converged vs pandas
 * ewm(adjust=False) at 1e-6 in the tail.
 */
export function tsi(x: readonly number[], slow = 25, fast = 13): number[] {
  assertPeriod(slow);
  assertPeriod(fast);
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < 2) return out;
  // Price changes (first change at index 1).
  const pc = new Array<number>(n - 1);
  const apc = new Array<number>(n - 1);
  for (let i = 1; i < n; i++) {
    const d = x[i]! - x[i - 1]!;
    pc[i - 1] = d;
    apc[i - 1] = Math.abs(d);
  }
  const num = emaRecursive(emaRecursive(pc, slow), fast);
  const den = emaRecursive(emaRecursive(apc, slow), fast);
  for (let i = 0; i < pc.length; i++) {
    const d = den[i]!;
    // Aligned: pc[k] corresponds to bar k+1.
    out[i + 1] = d === 0 ? 0 : (100 * num[i]!) / d;
  }
  return out;
}

/** Recursive EMA seeded at the first sample (ewm adjust=false). No NaN warmup. */
function emaRecursive(x: readonly number[], period: number): number[] {
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

// ----------------------------------------------------------------------------
// Streaming forms (reproduce the batch series exactly).
// ----------------------------------------------------------------------------

/** Streaming MACD — line/signal/hist. Matches macd() exactly (aligned outputs). */
export function createMACD(
  fast = 12,
  slow = 26,
  signalPeriod = 9
): MultiIndicatorStream<number, { macd: number; signal: number; hist: number }> {
  assertPeriod(fast);
  assertPeriod(slow);
  assertPeriod(signalPeriod);
  const fastStream = createEMA(fast);
  const slowStream = createEMA(slow);
  const signalStream = createEMA(signalPeriod);
  return {
    push(v: number) {
      const f = fastStream.push(v);
      const s = slowStream.push(v);
      const rawMacd = Number.isNaN(s) ? NaN : f - s;
      // Feed the signal EMA only once the macd line is valid (matches the
      // compacted-tail seeding in the batch form).
      const sig = Number.isNaN(rawMacd) ? NaN : signalStream.push(rawMacd);
      if (Number.isNaN(sig)) return { macd: NaN, signal: NaN, hist: NaN };
      return { macd: rawMacd, signal: sig, hist: rawMacd - sig };
    },
  };
}

/** Streaming ROC. Matches roc() exactly. */
export function createROC(period = 10): IndicatorStream {
  assertPeriod(period);
  const buf: number[] = [];
  return {
    push(v: number): number {
      buf.push(v);
      if (buf.length <= period) return NaN;
      const base = buf.shift()!; // value `period` bars ago
      return base === 0 ? 0 : (100 * (v - base)) / base;
    },
  };
}

/** Streaming Momentum. Matches momentum() exactly. */
export function createMomentum(period = 10): IndicatorStream {
  assertPeriod(period);
  const buf: number[] = [];
  return {
    push(v: number): number {
      buf.push(v);
      if (buf.length <= period) return NaN;
      const base = buf.shift()!;
      return v - base;
    },
  };
}

/** Indicator definitions contributed by this category. */
export const momentumIndicators: IndicatorDef[] = [
  {
    id: "rsi",
    label: "Relative Strength Index",
    category: "momentum",
    inputs: ["close"],
    params: [{ key: "period", label: "Period", type: "int", default: 14, min: 1 }],
    reference: "Wilder 1978 / StockCharts canonical RSI vector; cross-checked vs TA-Lib RSI",
    compute: (bars, p) => rsi(closes(bars), p.period ?? 14),
  },
  {
    id: "stoch",
    label: "Stochastic Oscillator (Slow)",
    category: "momentum",
    inputs: ["ohlcv"],
    params: [
      { key: "kPeriod", label: "%K Period", type: "int", default: 14, min: 1 },
      { key: "slowK", label: "Slow %K (smoothing)", type: "int", default: 3, min: 1 },
      { key: "dPeriod", label: "%D Period", type: "int", default: 3, min: 1 },
    ],
    reference: "TA-Lib 0.6.8 STOCH (SMA smoothing)",
    compute: (bars, p) => {
      const r = stoch(bars, p.kPeriod ?? 14, p.slowK ?? 3, p.dPeriod ?? 3);
      return { k: r.k, d: r.d };
    },
  },
  {
    id: "stochf",
    label: "Stochastic Oscillator (Fast)",
    category: "momentum",
    inputs: ["ohlcv"],
    params: [
      { key: "kPeriod", label: "%K Period", type: "int", default: 14, min: 1 },
      { key: "dPeriod", label: "%D Period", type: "int", default: 3, min: 1 },
    ],
    reference: "TA-Lib 0.6.8 STOCHF",
    compute: (bars, p) => {
      const r = stochFast(bars, p.kPeriod ?? 14, p.dPeriod ?? 3);
      return { k: r.k, d: r.d };
    },
  },
  {
    id: "stochrsi",
    label: "Stochastic RSI",
    category: "momentum",
    inputs: ["close"],
    params: [
      { key: "rsiPeriod", label: "RSI Period", type: "int", default: 14, min: 1 },
      { key: "kPeriod", label: "%K Period", type: "int", default: 14, min: 1 },
      { key: "dPeriod", label: "%D Period", type: "int", default: 3, min: 1 },
    ],
    reference: "TA-Lib 0.6.8 STOCHRSI",
    compute: (bars, p) => {
      const r = stochRsi(closes(bars), p.rsiPeriod ?? 14, p.kPeriod ?? 14, p.dPeriod ?? 3);
      return { k: r.k, d: r.d };
    },
  },
  {
    id: "cci",
    label: "Commodity Channel Index",
    category: "momentum",
    inputs: ["ohlcv"],
    params: [{ key: "period", label: "Period", type: "int", default: 20, min: 1 }],
    reference: "TA-Lib 0.6.8 CCI",
    compute: (bars, p) => cci(bars, p.period ?? 20),
  },
  {
    id: "willr",
    label: "Williams %R",
    category: "momentum",
    inputs: ["ohlcv"],
    params: [{ key: "period", label: "Period", type: "int", default: 14, min: 1 }],
    reference: "TA-Lib 0.6.8 WILLR",
    compute: (bars, p) => williamsR(bars, p.period ?? 14),
  },
  {
    id: "roc",
    label: "Rate of Change",
    category: "momentum",
    inputs: ["close"],
    params: [{ key: "period", label: "Period", type: "int", default: 10, min: 1 }],
    reference: "TA-Lib 0.6.8 ROC",
    compute: (bars, p) => roc(closes(bars), p.period ?? 10),
  },
  {
    id: "mom",
    label: "Momentum",
    category: "momentum",
    inputs: ["close"],
    params: [{ key: "period", label: "Period", type: "int", default: 10, min: 1 }],
    reference: "TA-Lib 0.6.8 MOM",
    compute: (bars, p) => momentum(closes(bars), p.period ?? 10),
  },
  {
    id: "mfi",
    label: "Money Flow Index",
    category: "momentum",
    inputs: ["ohlcv"],
    params: [{ key: "period", label: "Period", type: "int", default: 14, min: 1 }],
    reference: "TA-Lib 0.6.8 MFI",
    compute: (bars, p) => mfi(bars, p.period ?? 14),
  },
  {
    id: "ultosc",
    label: "Ultimate Oscillator",
    category: "momentum",
    inputs: ["ohlcv"],
    params: [
      { key: "short", label: "Short Period", type: "int", default: 7, min: 1 },
      { key: "medium", label: "Medium Period", type: "int", default: 14, min: 1 },
      { key: "long", label: "Long Period", type: "int", default: 28, min: 1 },
    ],
    reference: "TA-Lib 0.6.8 ULTOSC",
    compute: (bars, p) => ultimateOscillator(bars, p.short ?? 7, p.medium ?? 14, p.long ?? 28),
  },
  {
    id: "macd",
    label: "MACD",
    category: "momentum",
    inputs: ["close"],
    params: [
      { key: "fast", label: "Fast Period", type: "int", default: 12, min: 1 },
      { key: "slow", label: "Slow Period", type: "int", default: 26, min: 1 },
      { key: "signal", label: "Signal Period", type: "int", default: 9, min: 1 },
    ],
    reference: "TA-Lib 0.6.8 MACD",
    compute: (bars, p) => {
      const r = macd(closes(bars), p.fast ?? 12, p.slow ?? 26, p.signal ?? 9);
      return { macd: r.macd, signal: r.signal, hist: r.hist };
    },
  },
  {
    id: "tsi",
    label: "True Strength Index",
    category: "momentum",
    inputs: ["close"],
    params: [
      { key: "slow", label: "Slow (long) Period", type: "int", default: 25, min: 1 },
      { key: "fast", label: "Fast (short) Period", type: "int", default: 13, min: 1 },
    ],
    reference: "bukosabino/ta TSIIndicator (MIT); tail-converged vs pandas ewm(adjust=False)",
    compute: (bars, p) => tsi(closes(bars), p.slow ?? 25, p.fast ?? 13),
  },
];
