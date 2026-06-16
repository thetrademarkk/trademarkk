/**
 * Oscillator extensions — additional momentum/oscillator studies that complement
 * the foundation momentum module (./momentum.ts: RSI, Stoch, StochF, StochRSI,
 * CCI, Williams %R, ROC, MOM, MFI, ULTOSC, MACD, TSI).
 *
 * Indicators in this module (all category "momentum"):
 *   - CMO  (Chande Momentum Oscillator)      — TA-Lib 0.6.8 CMO
 *   - TRIX (1-period ROC of triple EMA)      — TA-Lib 0.6.8 TRIX
 *   - PPO  (Percentage Price Oscillator)     — TA-Lib 0.6.8 PPO
 *   - PVO  (Percentage Volume Oscillator)    — TA-Lib 0.6.8 PPO applied to volume
 *   - BOP  (Balance of Power)                — TA-Lib 0.6.8 BOP
 *   - AO   (Awesome Oscillator, Bill Williams)
 *   - AC   (Accelerator Oscillator, Bill Williams)
 *   - DPO  (Detrended Price Oscillator)      — StockCharts published formula
 *   - KST  (Know Sure Thing, Pring)          — StockCharts / Pring published formula
 *   - COPP (Coppock Curve)                   — Coppock (1962) published formula
 *   - FISHER (Fisher Transform, Ehlers)      — Ehlers published formula
 *   - CRSI (Connors RSI)                     — Connors published formula
 *   - CFO  (Chande Forecast Oscillator)      — published; uses TA-Lib LINEARREG endpoint
 *
 * Conventions (pinned, see types.ts): output aligned to input length; NaN during
 * warmup; no look-ahead; explicit warmup-prefix test; determinism test; one
 * div-by-zero / flat-range gotcha per indicator. Reuses the shared smoothing
 * primitives (sma/ema) and the foundation rsi() / linregValue() rather than
 * reinventing them.
 */

import { assertPeriod, closes, type IndicatorStream, type OHLCV } from "./types";
import { ema, sma } from "./smoothing";
import { rsi } from "./momentum";
import { linregValue } from "./statistical";
import type { IndicatorDef } from "./registry";

// ----------------------------------------------------------------------------
// Internal helpers (NaN-aware composition over inner warmup prefixes).
// ----------------------------------------------------------------------------

/** SMA-seeded EMA that skips a leading NaN prefix (an inner stage's warmup). */
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

/** SMA over a series with a leading NaN prefix; seeds at the first full window. */
function smaOfValid(xs: readonly number[], period: number): number[] {
  const n = xs.length;
  const out = new Array<number>(n).fill(NaN);
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

/** WMA over a series with a leading NaN prefix (linearly-weighted). */
function wmaOfValid(xs: readonly number[], period: number): number[] {
  const n = xs.length;
  const out = new Array<number>(n).fill(NaN);
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < n; i++) {
    let acc = 0;
    let ok = true;
    for (let j = 0; j < period; j++) {
      const v = xs[i - j]!;
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

// ----------------------------------------------------------------------------
// CMO — Chande Momentum Oscillator.
// ----------------------------------------------------------------------------

/**
 * Chande Momentum Oscillator (Tushar Chande).
 *   CMO = 100 * (avgGain - avgLoss) / (avgGain + avgLoss)
 * where avgGain / avgLoss are Wilder-smoothed (α = 1/period) over the up/down
 * moves with the SMA-of-first-`period`-changes seed — the same recursion RSI
 * uses. First value at index `period`. Flat (avgGain + avgLoss == 0) -> 0.
 * Reference: TA-Lib 0.6.8 CMO.
 */
export function cmo(x: readonly number[], period: number): number[] {
  assertPeriod(period);
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < period + 1) return out;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const ch = x[i]! - x[i - 1]!;
    if (ch > 0) gainSum += ch;
    else lossSum -= ch;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = cmoFrom(avgGain, avgLoss);
  for (let i = period + 1; i < n; i++) {
    const ch = x[i]! - x[i - 1]!;
    const gain = ch > 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = cmoFrom(avgGain, avgLoss);
  }
  return out;
}

function cmoFrom(avgGain: number, avgLoss: number): number {
  const denom = avgGain + avgLoss;
  return denom === 0 ? 0 : (100 * (avgGain - avgLoss)) / denom;
}

/** Streaming CMO — Wilder-smoothed, reproduces cmo() exactly. */
export function createCMO(period: number): IndicatorStream {
  assertPeriod(period);
  let prev = NaN;
  let count = 0;
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
        seedGain += gain;
        seedLoss += loss;
        return NaN;
      }
      if (changesSeen === period) {
        seedGain += gain;
        seedLoss += loss;
        avgGain = seedGain / period;
        avgLoss = seedLoss / period;
        return cmoFrom(avgGain, avgLoss);
      }
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      return cmoFrom(avgGain, avgLoss);
    },
  };
}

// ----------------------------------------------------------------------------
// TRIX — 1-period % rate-of-change of a triple-smoothed EMA.
// ----------------------------------------------------------------------------

/**
 * TRIX (Jack Hutson). Triple-EMA of the log-less price, then a 1-period
 * percentage rate-of-change:
 *   e1 = EMA(close, n); e2 = EMA(e1, n); e3 = EMA(e2, n)
 *   TRIX = 100 * (e3[i] - e3[i-1]) / e3[i-1]
 * EMA = SMA-seeded 2/(n+1) (TA-Lib parity). First value at index 3*(n-1)+1.
 * Flat e3[i-1] == 0 -> 0. Reference: TA-Lib 0.6.8 TRIX.
 */
export function trix(x: readonly number[], period: number): number[] {
  assertPeriod(period);
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  const e1 = emaCompose(x, period);
  const e2 = emaCompose(e1, period);
  const e3 = emaCompose(e2, period);
  for (let i = 1; i < n; i++) {
    const prev = e3[i - 1]!;
    if (Number.isNaN(prev) || Number.isNaN(e3[i]!)) continue;
    out[i] = prev === 0 ? 0 : (100 * (e3[i]! - prev)) / prev;
  }
  return out;
}

// ----------------------------------------------------------------------------
// PPO / PVO — percentage oscillators.
// ----------------------------------------------------------------------------

/**
 * Percentage Price Oscillator.
 *   PPO = 100 * (EMA(x, fast) - EMA(x, slow)) / EMA(x, slow)
 * EMA = SMA-seeded 2/(n+1) (TA-Lib EMA parity). First value at index slow-1.
 * EMA(slow) == 0 -> 0.
 *
 * Reference: the published StockCharts/TradingView PPO definition computed from
 * the TA-Lib EMA primitive (this is exactly how the committed macd() composes
 * its line). NOTE: TA-Lib's OWN `PPO`/`APO` functions use a non-standard
 * lookback alignment whose result does NOT equal EMA_fast - EMA_slow (a known
 * TA-Lib quirk); we deliberately follow the published definition instead so PPO
 * stays consistent with this library's EMA convention and the MACD line. PVO is
 * the same percentage oscillator applied to the volume series.
 */
export function ppo(x: readonly number[], fast = 12, slow = 26): number[] {
  assertPeriod(fast);
  assertPeriod(slow);
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  const emaFast = ema(x, fast);
  const emaSlow = ema(x, slow);
  for (let i = 0; i < n; i++) {
    const s = emaSlow[i]!;
    if (Number.isNaN(s)) continue;
    out[i] = s === 0 ? 0 : (100 * (emaFast[i]! - s)) / s;
  }
  return out;
}

// ----------------------------------------------------------------------------
// BOP — Balance of Power.
// ----------------------------------------------------------------------------

/**
 * Balance of Power. bop[i] = (close - open) / (high - low). Per-bar, no warmup.
 * Flat bar (high == low) -> 0. Reference: TA-Lib 0.6.8 BOP.
 */
export function bop(bars: readonly OHLCV[]): number[] {
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const b = bars[i]!;
    const range = b.high - b.low;
    out[i] = range === 0 ? 0 : (b.close - b.open) / range;
  }
  return out;
}

// ----------------------------------------------------------------------------
// AO / AC — Bill Williams Awesome & Accelerator oscillators.
// ----------------------------------------------------------------------------

/**
 * Awesome Oscillator (Bill Williams). Median price = (high + low) / 2.
 *   AO = SMA(median, fast) - SMA(median, slow),  fast=5, slow=34
 * First value at index slow-1. Reference: Bill Williams published formula
 * (TradingView Pine ta.* parity).
 */
export function awesomeOscillator(bars: readonly OHLCV[], fast = 5, slow = 34): number[] {
  assertPeriod(fast);
  assertPeriod(slow);
  const n = bars.length;
  const median = bars.map((b) => (b.high + b.low) / 2);
  const smaFast = sma(median, fast);
  const smaSlow = sma(median, slow);
  const out = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(smaSlow[i]!)) out[i] = smaFast[i]! - smaSlow[i]!;
  }
  return out;
}

/**
 * Accelerator Oscillator (Bill Williams).
 *   AC = AO - SMA(AO, smaPeriod),  smaPeriod=5
 * First value at index (slow-1) + (smaPeriod-1). Reference: Bill Williams
 * published formula.
 */
export function acceleratorOscillator(
  bars: readonly OHLCV[],
  fast = 5,
  slow = 34,
  smaPeriod = 5
): number[] {
  assertPeriod(smaPeriod);
  const ao = awesomeOscillator(bars, fast, slow);
  const aoSma = smaOfValid(ao, smaPeriod);
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(aoSma[i]!)) out[i] = ao[i]! - aoSma[i]!;
  }
  return out;
}

// ----------------------------------------------------------------------------
// DPO — Detrended Price Oscillator.
// ----------------------------------------------------------------------------

/**
 * Detrended Price Oscillator (StockCharts).
 *   shift = floor(period/2) + 1
 *   DPO[i] = price[i - shift] - SMA(price, period)[i]
 * Lagging (non-look-ahead): uses a PAST price and the current SMA. First value
 * at index period-1. Reference: StockCharts published DPO formula.
 */
export function dpo(x: readonly number[], period = 20): number[] {
  assertPeriod(period);
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  const s = sma(x, period);
  const shift = Math.floor(period / 2) + 1;
  for (let i = period - 1; i < n; i++) {
    const j = i - shift;
    if (j >= 0) out[i] = x[j]! - s[i]!;
  }
  return out;
}

// ----------------------------------------------------------------------------
// KST — Know Sure Thing (Pring).
// ----------------------------------------------------------------------------

/** Percentage rate-of-change. roc[i] = 100*(x[i]-x[i-p])/x[i-p]; first at p. */
function rocPct(x: readonly number[], period: number): number[] {
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = period; i < n; i++) {
    const base = x[i - period]!;
    out[i] = base === 0 ? 0 : (100 * (x[i]! - base)) / base;
  }
  return out;
}

/**
 * Know Sure Thing (Martin Pring) — a weighted sum of four smoothed ROCs, plus a
 * signal line.
 *   RCMA1 = SMA(ROC(10), 10)   weight 1
 *   RCMA2 = SMA(ROC(15), 10)   weight 2
 *   RCMA3 = SMA(ROC(20), 10)   weight 3
 *   RCMA4 = SMA(ROC(30), 15)   weight 4
 *   KST = 1*RCMA1 + 2*RCMA2 + 3*RCMA3 + 4*RCMA4
 *   signal = SMA(KST, 9)
 * First KST at index roc30 warmup (30) + sma15 warmup (14) = 44; signal +8 = 52.
 * Reference: StockCharts / Pring published KST formula (defaults).
 */
export function kst(x: readonly number[]): { kst: number[]; signal: number[] } {
  const n = x.length;
  const r1 = smaOfValid(rocPct(x, 10), 10);
  const r2 = smaOfValid(rocPct(x, 15), 10);
  const r3 = smaOfValid(rocPct(x, 20), 10);
  const r4 = smaOfValid(rocPct(x, 30), 15);
  const line = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (
      Number.isNaN(r1[i]!) ||
      Number.isNaN(r2[i]!) ||
      Number.isNaN(r3[i]!) ||
      Number.isNaN(r4[i]!)
    ) {
      continue;
    }
    line[i] = r1[i]! * 1 + r2[i]! * 2 + r3[i]! * 3 + r4[i]! * 4;
  }
  const signal = smaOfValid(line, 9);
  return { kst: line, signal };
}

// ----------------------------------------------------------------------------
// Coppock Curve.
// ----------------------------------------------------------------------------

/**
 * Coppock Curve (E.S.C. Coppock, 1962).
 *   COPP = WMA( ROC(close, long) + ROC(close, short), wma )
 * Defaults long=14, short=11, wma=10. First value at index long + (wma-1) = 23.
 * Reference: Coppock published formula (StockCharts parity).
 */
export function coppock(
  x: readonly number[],
  longRoc = 14,
  shortRoc = 11,
  wmaPeriod = 10
): number[] {
  assertPeriod(wmaPeriod);
  const n = x.length;
  const rl = rocPct(x, longRoc);
  const rs = rocPct(x, shortRoc);
  const sum = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(rl[i]!) && !Number.isNaN(rs[i]!)) sum[i] = rl[i]! + rs[i]!;
  }
  return wmaOfValid(sum, wmaPeriod);
}

// ----------------------------------------------------------------------------
// Fisher Transform (Ehlers).
// ----------------------------------------------------------------------------

/**
 * Fisher Transform (John Ehlers). Normalises the median price into a [-1,1]
 * channel over `period`, then applies the Fisher transform (a recursive,
 * half-weighted log-ratio):
 *   raw = (median - minMed) / (maxMed - minMed) - 0.5     (flat range -> 0)
 *   value = 0.66*(2*raw) + 0.67*value_prev   (clamped to +/-0.999)
 *   fish  = 0.5*ln((1+value)/(1-value)) + 0.5*fish_prev
 * Outputs the Fisher line and its 1-bar-lagged trigger. First value at index
 * period-1. Reference: Ehlers published Fisher Transform formula.
 */
export function fisherTransform(
  bars: readonly OHLCV[],
  period = 9
): { fisher: number[]; trigger: number[] } {
  assertPeriod(period);
  const n = bars.length;
  const median = bars.map((b) => (b.high + b.low) / 2);
  const fisher = new Array<number>(n).fill(NaN);
  const trigger = new Array<number>(n).fill(NaN);
  let value = 0;
  let fish = 0;
  for (let i = period - 1; i < n; i++) {
    let mx = -Infinity;
    let mn = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (median[j]! > mx) mx = median[j]!;
      if (median[j]! < mn) mn = median[j]!;
    }
    const range = mx - mn;
    const raw = range === 0 ? 0 : (median[i]! - mn) / range - 0.5;
    value = 0.66 * (raw * 2) + 0.67 * value;
    if (value > 0.999) value = 0.999;
    else if (value < -0.999) value = -0.999;
    const prevFish = fish;
    fish = 0.5 * Math.log((1 + value) / (1 - value)) + 0.5 * fish;
    fisher[i] = fish;
    trigger[i] = prevFish;
  }
  return { fisher, trigger };
}

// ----------------------------------------------------------------------------
// Connors RSI.
// ----------------------------------------------------------------------------

/** Consecutive up/down streak length (signed); 0 on no change. streak[0] = 0. */
function priceStreak(x: readonly number[]): number[] {
  const n = x.length;
  const s = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    if (x[i]! > x[i - 1]!) s[i] = s[i - 1]! > 0 ? s[i - 1]! + 1 : 1;
    else if (x[i]! < x[i - 1]!) s[i] = s[i - 1]! < 0 ? s[i - 1]! - 1 : -1;
    else s[i] = 0;
  }
  return s;
}

/**
 * Connors RSI (Larry Connors).
 *   CRSI = ( RSI(close, rsiPeriod)
 *          + RSI(streak, streakPeriod)
 *          + PercentRank(1-bar ROC, rankPeriod) ) / 3
 * Defaults rsiPeriod=3, streakPeriod=2, rankPeriod=100. PercentRank here is the
 * Connors convention: % of the `rankPeriod` PRIOR 1-bar ROC values strictly
 * below the current ROC. First value at index rankPeriod (100 with defaults).
 * Reference: Connors published Connors RSI formula. The two RSI components reuse
 * the foundation Wilder RSI (TA-Lib parity).
 */
export function connorsRsi(
  x: readonly number[],
  rsiPeriod = 3,
  streakPeriod = 2,
  rankPeriod = 100
): number[] {
  assertPeriod(rsiPeriod);
  assertPeriod(streakPeriod);
  assertPeriod(rankPeriod);
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  const rClose = rsi(x, rsiPeriod);
  const rStreak = rsi(priceStreak(x), streakPeriod);
  // 1-bar percentage ROC (first at index 1).
  const roc1 = new Array<number>(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    const base = x[i - 1]!;
    roc1[i] = base === 0 ? 0 : (100 * (x[i]! - base)) / base;
  }
  // PercentRank: count of the `rankPeriod` prior ROC values strictly below cur.
  for (let i = rankPeriod; i < n; i++) {
    if (Number.isNaN(rClose[i]!) || Number.isNaN(rStreak[i]!)) continue;
    const cur = roc1[i]!;
    if (Number.isNaN(cur)) continue;
    let cnt = 0;
    for (let j = i - rankPeriod; j < i; j++) {
      const v = roc1[j]!;
      if (!Number.isNaN(v) && v < cur) cnt++;
    }
    const pr = (100 * cnt) / rankPeriod;
    out[i] = (rClose[i]! + rStreak[i]! + pr) / 3;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Chande Forecast Oscillator.
// ----------------------------------------------------------------------------

/**
 * Chande Forecast Oscillator.
 *   CFO = 100 * (close - LinReg(close, period)) / close
 * LinReg is the linear-regression endpoint value (TA-Lib LINEARREG parity, reused
 * from statistical.ts). First value at index period-1. close == 0 -> 0.
 * Reference: published Chande Forecast Oscillator; LinReg endpoint via TA-Lib
 * LINEARREG (0.6.8).
 */
export function chandeForecastOscillator(x: readonly number[], period = 14): number[] {
  assertPeriod(period);
  const n = x.length;
  const out = new Array<number>(n).fill(NaN);
  const lr = linregValue(x, period);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(lr[i]!)) continue;
    const c = x[i]!;
    out[i] = c === 0 ? 0 : (100 * (c - lr[i]!)) / c;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Registry definitions.
// ----------------------------------------------------------------------------

const volumeOf = (bars: readonly OHLCV[]): number[] => bars.map((b) => b.volume);

/** Indicator definitions contributed by this category. */
export const oscillatorsExtIndicators: IndicatorDef[] = [
  {
    id: "cmo",
    label: "Chande Momentum Oscillator",
    category: "momentum",
    inputs: ["close"],
    params: [{ key: "period", label: "Period", type: "int", default: 14, min: 1 }],
    reference: "TA-Lib 0.6.8 CMO",
    compute: (bars, p) => cmo(closes(bars), p.period ?? 14),
  },
  {
    id: "trix",
    label: "TRIX",
    category: "momentum",
    inputs: ["close"],
    params: [{ key: "period", label: "Period", type: "int", default: 14, min: 1 }],
    reference: "TA-Lib 0.6.8 TRIX",
    compute: (bars, p) => trix(closes(bars), p.period ?? 14),
  },
  {
    id: "ppo",
    label: "Percentage Price Oscillator",
    category: "momentum",
    inputs: ["close"],
    params: [
      { key: "fast", label: "Fast Period", type: "int", default: 12, min: 1 },
      { key: "slow", label: "Slow Period", type: "int", default: 26, min: 1 },
    ],
    reference: "Standard PPO (StockCharts/TradingView): 100*(EMA_f-EMA_s)/EMA_s via TA-Lib EMA",
    compute: (bars, p) => ppo(closes(bars), p.fast ?? 12, p.slow ?? 26),
  },
  {
    id: "pvo",
    label: "Percentage Volume Oscillator",
    category: "momentum",
    inputs: ["volume"],
    params: [
      { key: "fast", label: "Fast Period", type: "int", default: 12, min: 1 },
      { key: "slow", label: "Slow Period", type: "int", default: 26, min: 1 },
    ],
    reference: "Standard percentage oscillator (PPO formula) applied to volume; TA-Lib EMA",
    compute: (bars, p) => ppo(volumeOf(bars), p.fast ?? 12, p.slow ?? 26),
  },
  {
    id: "bop",
    label: "Balance of Power",
    category: "momentum",
    inputs: ["ohlcv"],
    params: [],
    reference: "TA-Lib 0.6.8 BOP",
    compute: (bars) => bop(bars),
  },
  {
    id: "ao",
    label: "Awesome Oscillator",
    category: "momentum",
    inputs: ["high", "low"],
    params: [
      { key: "fast", label: "Fast Period", type: "int", default: 5, min: 1 },
      { key: "slow", label: "Slow Period", type: "int", default: 34, min: 1 },
    ],
    reference: "Bill Williams Awesome Oscillator (TradingView Pine ta.* parity)",
    compute: (bars, p) => awesomeOscillator(bars, p.fast ?? 5, p.slow ?? 34),
  },
  {
    id: "ac",
    label: "Accelerator Oscillator",
    category: "momentum",
    inputs: ["high", "low"],
    params: [
      { key: "fast", label: "Fast Period", type: "int", default: 5, min: 1 },
      { key: "slow", label: "Slow Period", type: "int", default: 34, min: 1 },
      { key: "smaPeriod", label: "AO Smoothing", type: "int", default: 5, min: 1 },
    ],
    reference: "Bill Williams Accelerator Oscillator (AO - SMA(AO,5))",
    compute: (bars, p) => acceleratorOscillator(bars, p.fast ?? 5, p.slow ?? 34, p.smaPeriod ?? 5),
  },
  {
    id: "dpo",
    label: "Detrended Price Oscillator",
    category: "momentum",
    inputs: ["close"],
    params: [{ key: "period", label: "Period", type: "int", default: 20, min: 1 }],
    reference: "StockCharts published DPO formula",
    compute: (bars, p) => dpo(closes(bars), p.period ?? 20),
  },
  {
    id: "kst",
    label: "Know Sure Thing",
    category: "momentum",
    inputs: ["close"],
    params: [],
    reference: "StockCharts / Pring published KST formula (10/15/20/30, SMA 10/10/10/15, signal 9)",
    compute: (bars) => {
      const r = kst(closes(bars));
      return { kst: r.kst, signal: r.signal };
    },
  },
  {
    id: "coppock",
    label: "Coppock Curve",
    category: "momentum",
    inputs: ["close"],
    params: [
      { key: "longRoc", label: "Long ROC", type: "int", default: 14, min: 1 },
      { key: "shortRoc", label: "Short ROC", type: "int", default: 11, min: 1 },
      { key: "wmaPeriod", label: "WMA Period", type: "int", default: 10, min: 1 },
    ],
    reference: "Coppock (1962) published formula (StockCharts parity)",
    compute: (bars, p) =>
      coppock(closes(bars), p.longRoc ?? 14, p.shortRoc ?? 11, p.wmaPeriod ?? 10),
  },
  {
    id: "fisher",
    label: "Fisher Transform",
    category: "momentum",
    inputs: ["high", "low"],
    params: [{ key: "period", label: "Period", type: "int", default: 9, min: 1 }],
    reference: "Ehlers published Fisher Transform formula",
    compute: (bars, p) => {
      const r = fisherTransform(bars, p.period ?? 9);
      return { fisher: r.fisher, trigger: r.trigger };
    },
  },
  {
    id: "crsi",
    label: "Connors RSI",
    category: "momentum",
    inputs: ["close"],
    params: [
      { key: "rsiPeriod", label: "RSI Period", type: "int", default: 3, min: 1 },
      { key: "streakPeriod", label: "Streak RSI Period", type: "int", default: 2, min: 1 },
      { key: "rankPeriod", label: "Percent-Rank Period", type: "int", default: 100, min: 1 },
    ],
    reference: "Connors published Connors RSI formula (RSI components = Wilder/TA-Lib RSI)",
    compute: (bars, p) =>
      connorsRsi(closes(bars), p.rsiPeriod ?? 3, p.streakPeriod ?? 2, p.rankPeriod ?? 100),
  },
  {
    id: "cfo",
    label: "Chande Forecast Oscillator",
    category: "momentum",
    inputs: ["close"],
    params: [{ key: "period", label: "Period", type: "int", default: 14, min: 1 }],
    reference: "Published Chande Forecast Oscillator; LinReg endpoint via TA-Lib LINEARREG (0.6.8)",
    compute: (bars, p) => chandeForecastOscillator(closes(bars), p.period ?? 14),
  },
];
