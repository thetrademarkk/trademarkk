/**
 * Directional / trend-strength indicators — ADX (+DI/-DI), Aroon, Vortex,
 * Supertrend, Parabolic SAR. Pure, deterministic, dependency-free.
 *
 * These are the recursive "correctness minefield": each is verified against a
 * declared reference in directional.test.ts.
 *
 * Conventions (pinned, see types.ts / smoothing.ts):
 *  - Output aligned to input length; NaN during warmup; never look ahead.
 *  - Wilder smoothing (α = 1/period) is used by ADX/DI, matching TA-Lib's
 *    seeding: the running TR/DM sum is seeded over the FIRST period-1 moves
 *    (indices 1..period-1), then one Wilder step at index `period` emits the
 *    first +DI/-DI. The ADX line then Wilder-smooths DX, seeded as the mean of
 *    the first `period` DX values, so the first ADX value lands at 2*period-1.
 *  - Aroon uses a lookback window of period+1 bars; days-since-extreme is
 *    measured from the most recent extreme.
 *  - Vortex sums true range, +VM and -VM over `period` bars (Botes & Siepman).
 *  - Supertrend bands use a Wilder ATR (same seed as ATR), hl2 mid, multiplier.
 *  - Parabolic SAR ports TA-Lib's SAR exactly (initial direction from the first
 *    +DM/-DM; SAR clamped to the prior two extremes plus the current bar on a
 *    reversal). First SAR at index 1.
 *
 * References (declared per indicator, asserted in the golden test):
 *  - ADX/+DI/-DI: Wilder 1978; cross-checked byte-for-byte vs TA-Lib 0.6.8.
 *  - Aroon: Tushar Chande (1995) / TA-Lib AROON & AROONOSC.
 *  - Vortex: Botes & Siepman, "The Vortex Indicator" (TASC, 2010); TR component
 *    cross-checked vs TA-Lib TRANGE.
 *  - Supertrend: Olivier Seban ATR trailing-stop; ATR seeded to TA-Lib parity.
 *  - PSAR: Wilder 1978; ported byte-for-byte vs TA-Lib SAR (af 0.02, max 0.2).
 */

import { assertPeriod, type OHLCV } from "./types";
import type { IndicatorDef } from "./registry";

/** True range at bar i (i>=1): max(H-L, |H-prevC|, |L-prevC|). */
function trueRange(h: number, l: number, prevC: number): number {
  const hl = h - l;
  const hc = Math.abs(h - prevC);
  const lc = Math.abs(l - prevC);
  return Math.max(hl, hc, lc);
}

// ---------------------------------------------------------------------------
// ADX / +DI / -DI (Wilder)
// ---------------------------------------------------------------------------

/**
 * Average Directional Index with +DI and -DI (Wilder, 1978).
 *
 * +DM = upMove   if upMove > downMove and upMove > 0  else 0
 * -DM = downMove if downMove > upMove and downMove > 0 else 0
 *   where upMove = H[i]-H[i-1], downMove = L[i-1]-L[i].
 * TR, +DM, -DM are Wilder-smoothed (α = 1/period). +DI = 100*sm(+DM)/sm(TR),
 * -DI = 100*sm(-DM)/sm(TR). DX = 100*|+DI - -DI|/(+DI + -DI) (0 when both 0).
 * ADX = Wilder-smoothed DX, seeded as the mean of the first `period` DX values.
 *
 * Seeding (TA-Lib parity): the smoothed TR/DM sum is seeded over indices
 * 1..period-1, then the Wilder step at index `period` emits the first DI; so
 * +DI/-DI first land at index `period`, and ADX first lands at 2*period-1.
 *
 * Reference: Wilder 1978; byte-for-byte vs TA-Lib 0.6.8 ADX/PLUS_DI/MINUS_DI.
 */
export function adx(
  bars: readonly OHLCV[],
  period: number
): { adx: number[]; plusDI: number[]; minusDI: number[] } {
  assertPeriod(period);
  const n = bars.length;
  const plusDI = new Array<number>(n).fill(NaN);
  const minusDI = new Array<number>(n).fill(NaN);
  const adxOut = new Array<number>(n).fill(NaN);
  if (n < period + 1) return { adx: adxOut, plusDI, minusDI };

  // Per-bar TR / +DM / -DM (index 0 has no prior bar -> contributes nothing).
  const tr = new Array<number>(n).fill(0);
  const pdm = new Array<number>(n).fill(0);
  const mdm = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = bars[i]!.high - bars[i - 1]!.high;
    const dn = bars[i - 1]!.low - bars[i]!.low;
    pdm[i] = up > dn && up > 0 ? up : 0;
    mdm[i] = dn > up && dn > 0 ? dn : 0;
    tr[i] = trueRange(bars[i]!.high, bars[i]!.low, bars[i - 1]!.close);
  }

  // Seed the Wilder sums over indices 1..period-1 (period-1 values).
  let sTR = 0;
  let sP = 0;
  let sM = 0;
  for (let i = 1; i < period; i++) {
    sTR += tr[i]!;
    sP += pdm[i]!;
    sM += mdm[i]!;
  }

  const dx = new Array<number>(n).fill(NaN);
  for (let i = period; i < n; i++) {
    // Wilder step consuming bar i; first DI emitted at i === period.
    sTR = sTR - sTR / period + tr[i]!;
    sP = sP - sP / period + pdm[i]!;
    sM = sM - sM / period + mdm[i]!;
    const pdi = sTR === 0 ? 0 : (100 * sP) / sTR;
    const ndi = sTR === 0 ? 0 : (100 * sM) / sTR;
    plusDI[i] = pdi;
    minusDI[i] = ndi;
    const sum = pdi + ndi;
    dx[i] = sum === 0 ? 0 : (100 * Math.abs(pdi - ndi)) / sum;
  }

  // ADX: seed = mean of DX over indices period..2*period-1; first ADX at 2*period-1.
  const adxSeedEnd = 2 * period - 1;
  if (n > adxSeedEnd) {
    let seed = 0;
    for (let i = period; i <= adxSeedEnd; i++) seed += dx[i]!;
    let prev = seed / period;
    adxOut[adxSeedEnd] = prev;
    for (let i = adxSeedEnd + 1; i < n; i++) {
      prev = (prev * (period - 1) + dx[i]!) / period;
      adxOut[i] = prev;
    }
  }
  // (If the series is too short for a full ADX seed, ADX stays all-NaN.)
  return { adx: adxOut, plusDI, minusDI };
}

// ---------------------------------------------------------------------------
// Aroon up / down / oscillator
// ---------------------------------------------------------------------------

/**
 * Aroon Up / Down (Chande, 1995).
 *   AroonUp   = 100 * (period - barsSinceHighestHigh) / period
 *   AroonDown = 100 * (period - barsSinceLowestLow)  / period
 * over a lookback window of period+1 bars (indices i-period..i). Bars-since is
 * measured to the MOST RECENT extreme on ties. First value at index `period`.
 *
 * Reference: TA-Lib AROON / AROONOSC.
 */
export function aroon(
  bars: readonly OHLCV[],
  period: number
): { up: number[]; down: number[]; osc: number[] } {
  assertPeriod(period);
  const n = bars.length;
  const up = new Array<number>(n).fill(NaN);
  const down = new Array<number>(n).fill(NaN);
  const osc = new Array<number>(n).fill(NaN);
  for (let i = period; i < n; i++) {
    let hh = bars[i - period]!.high;
    let ll = bars[i - period]!.low;
    let hhIdx = i - period;
    let llIdx = i - period;
    for (let j = i - period + 1; j <= i; j++) {
      const h = bars[j]!.high;
      const l = bars[j]!.low;
      // >= / <= keeps the MOST RECENT extreme on ties (matches TA-Lib).
      if (h >= hh) {
        hh = h;
        hhIdx = j;
      }
      if (l <= ll) {
        ll = l;
        llIdx = j;
      }
    }
    const sinceHigh = i - hhIdx;
    const sinceLow = i - llIdx;
    const u = (100 * (period - sinceHigh)) / period;
    const d = (100 * (period - sinceLow)) / period;
    up[i] = u;
    down[i] = d;
    osc[i] = u - d;
  }
  return { up, down, osc };
}

// ---------------------------------------------------------------------------
// Vortex (+VI / -VI)
// ---------------------------------------------------------------------------

/**
 * Vortex Indicator (Botes & Siepman, 2010).
 *   +VM = |H[i] - L[i-1]|, -VM = |L[i] - H[i-1]|, TR = true range.
 *   +VI = sum(+VM, period) / sum(TR, period)
 *   -VI = sum(-VM, period) / sum(TR, period)
 * First value at index `period` (the rolling sums need a prior bar at i-period).
 *
 * Reference: Botes & Siepman (TASC 2010); TR cross-checked vs TA-Lib TRANGE.
 */
export function vortex(
  bars: readonly OHLCV[],
  period: number
): { plusVI: number[]; minusVI: number[] } {
  assertPeriod(period);
  const n = bars.length;
  const plusVI = new Array<number>(n).fill(NaN);
  const minusVI = new Array<number>(n).fill(NaN);
  if (n < period + 1) return { plusVI, minusVI };

  const tr = new Array<number>(n).fill(0);
  const vmP = new Array<number>(n).fill(0);
  const vmM = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    tr[i] = trueRange(bars[i]!.high, bars[i]!.low, bars[i - 1]!.close);
    vmP[i] = Math.abs(bars[i]!.high - bars[i - 1]!.low);
    vmM[i] = Math.abs(bars[i]!.low - bars[i - 1]!.high);
  }
  for (let i = period; i < n; i++) {
    let sTR = 0;
    let sP = 0;
    let sM = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sTR += tr[j]!;
      sP += vmP[j]!;
      sM += vmM[j]!;
    }
    plusVI[i] = sTR === 0 ? NaN : sP / sTR;
    minusVI[i] = sTR === 0 ? NaN : sM / sTR;
  }
  return { plusVI, minusVI };
}

// ---------------------------------------------------------------------------
// Supertrend (ATR-based trailing stop)
// ---------------------------------------------------------------------------

/**
 * Supertrend (Olivier Seban). ATR is Wilder-smoothed over `period` (TA-Lib ATR
 * parity: TR seed = mean of first `period` TRs, first ATR at index `period`).
 *   mid = (H+L)/2
 *   basicUpper = mid + mult*ATR; basicLower = mid - mult*ATR
 *   finalUpper carries forward unless the new basic is lower or price broke it;
 *   finalLower symmetric. Trend flips when close crosses the active band.
 *   line = finalLower in an uptrend (dir=+1), finalUpper in a downtrend (dir=-1).
 * First value at index `period` (the first ATR). dir is +1 / -1 (NaN in warmup).
 *
 * Reference: standard ATR trailing-stop Supertrend; ATR seeded to TA-Lib parity.
 */
export function supertrend(
  bars: readonly OHLCV[],
  period: number,
  multiplier: number
): { line: number[]; dir: number[] } {
  assertPeriod(period);
  const n = bars.length;
  const line = new Array<number>(n).fill(NaN);
  const dir = new Array<number>(n).fill(NaN);
  if (n < period + 1) return { line, dir };

  // Wilder ATR (TA-Lib parity): mean of first `period` TRs as seed at index `period`.
  const tr = new Array<number>(n).fill(NaN);
  for (let i = 1; i < n; i++) tr[i] = trueRange(bars[i]!.high, bars[i]!.low, bars[i - 1]!.close);
  const atr = new Array<number>(n).fill(NaN);
  let seed = 0;
  for (let i = 1; i <= period; i++) seed += tr[i]!;
  atr[period] = seed / period;
  for (let i = period + 1; i < n; i++) {
    atr[i] = (atr[i - 1]! * (period - 1) + tr[i]!) / period;
  }

  let prevUpper = NaN;
  let prevLower = NaN;
  let prevDir = 1;
  for (let i = period; i < n; i++) {
    const mid = (bars[i]!.high + bars[i]!.low) / 2;
    const bUpper = mid + multiplier * atr[i]!;
    const bLower = mid - multiplier * atr[i]!;
    if (i === period) {
      prevUpper = bUpper;
      prevLower = bLower;
      prevDir = 1;
      line[i] = bLower;
      dir[i] = 1;
      continue;
    }
    const prevClose = bars[i - 1]!.close;
    const fUpper = bUpper < prevUpper || prevClose > prevUpper ? bUpper : prevUpper;
    const fLower = bLower > prevLower || prevClose < prevLower ? bLower : prevLower;
    let d: number;
    if (prevDir === 1) d = bars[i]!.close < fLower ? -1 : 1;
    else d = bars[i]!.close > fUpper ? 1 : -1;
    line[i] = d === 1 ? fLower : fUpper;
    dir[i] = d;
    prevUpper = fUpper;
    prevLower = fLower;
    prevDir = d;
  }
  return { line, dir };
}

// ---------------------------------------------------------------------------
// Parabolic SAR
// ---------------------------------------------------------------------------

/**
 * Parabolic SAR (Wilder, 1978) — ported byte-for-byte from TA-Lib SAR.
 *
 * Initial direction is chosen from the first bar's +DM vs -DM. The SAR seed is
 * the prior bar's extreme (low if long, high if short). Each step:
 *   sar += af*(EP - sar), clamped to NOT penetrate the prior two bars' lows
 *   (uptrend) / highs (downtrend). On penetration the trend reverses, sar jumps
 *   to the prior EP, and is clamped to the prior two extremes AND the current
 *   bar's extreme. AF starts at `step`, increments by `step` on each new EP,
 *   capped at `max`. First SAR at index 1.
 *
 * Reference: Wilder 1978; byte-for-byte vs TA-Lib SAR (default 0.02 / 0.2).
 */
export function psar(bars: readonly OHLCV[], step: number, max: number): number[] {
  if (!(step > 0) || !(max > 0)) {
    throw new RangeError(`psar: step and max must be positive, got ${step}, ${max}`);
  }
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < 2) return out;

  // Initial trend from the first bar's directional movement.
  const plusDM = Math.max(bars[1]!.high - bars[0]!.high, 0);
  const minusDM = Math.max(bars[0]!.low - bars[1]!.low, 0);
  let isLong = !(minusDM > plusDM);

  let af = step;
  let ep: number;
  let sar: number;
  if (isLong) {
    ep = bars[1]!.high;
    sar = bars[0]!.low;
  } else {
    ep = bars[1]!.low;
    sar = bars[0]!.high;
  }
  out[1] = sar;

  let prevHigh = bars[1]!.high;
  let prevLow = bars[1]!.low;
  let prevPrevHigh = NaN; // not yet established at i===2
  let prevPrevLow = NaN;

  for (let i = 2; i < n; i++) {
    const newHigh = bars[i]!.high;
    const newLow = bars[i]!.low;
    if (isLong) {
      sar = sar + af * (ep - sar);
      // Clamp: SAR must not exceed the prior two lows.
      if (sar > prevLow) sar = prevLow;
      if (!Number.isNaN(prevPrevLow) && sar > prevPrevLow) sar = prevPrevLow;
      if (newLow <= sar) {
        // Reverse to short.
        isLong = false;
        sar = ep;
        ep = newLow;
        af = step;
        if (sar < prevHigh) sar = prevHigh;
        if (!Number.isNaN(prevPrevHigh) && sar < prevPrevHigh) sar = prevPrevHigh;
        if (sar < newHigh) sar = newHigh;
      } else if (newHigh > ep) {
        ep = newHigh;
        af = Math.min(af + step, max);
      }
    } else {
      sar = sar + af * (ep - sar);
      if (sar < prevHigh) sar = prevHigh;
      if (!Number.isNaN(prevPrevHigh) && sar < prevPrevHigh) sar = prevPrevHigh;
      if (newHigh >= sar) {
        isLong = true;
        sar = ep;
        ep = newHigh;
        af = step;
        if (sar > prevLow) sar = prevLow;
        if (!Number.isNaN(prevPrevLow) && sar > prevPrevLow) sar = prevPrevLow;
        if (sar > newLow) sar = newLow;
      } else if (newLow < ep) {
        ep = newLow;
        af = Math.min(af + step, max);
      }
    }
    out[i] = sar;
    prevPrevHigh = prevHigh;
    prevPrevLow = prevLow;
    prevHigh = newHigh;
    prevLow = newLow;
  }
  return out;
}

/** Indicator definitions contributed by this category. */
export const directionalIndicators: IndicatorDef[] = [
  {
    id: "adx",
    label: "Average Directional Index (+DI/-DI)",
    category: "directional",
    inputs: ["ohlcv"],
    params: [{ key: "period", label: "Period", type: "int", default: 14, min: 1 }],
    reference: "Wilder 1978; byte-for-byte vs TA-Lib 0.6.8 ADX/PLUS_DI/MINUS_DI",
    compute: (bars, p) => {
      const r = adx(bars, p.period ?? 14);
      return { adx: r.adx, plusDI: r.plusDI, minusDI: r.minusDI };
    },
  },
  {
    id: "aroon",
    label: "Aroon Up/Down + Oscillator",
    category: "directional",
    inputs: ["ohlcv"],
    params: [{ key: "period", label: "Period", type: "int", default: 14, min: 1 }],
    reference: "Chande 1995; byte-for-byte vs TA-Lib 0.6.8 AROON/AROONOSC",
    compute: (bars, p) => {
      const r = aroon(bars, p.period ?? 14);
      return { up: r.up, down: r.down, osc: r.osc };
    },
  },
  {
    id: "vortex",
    label: "Vortex Indicator (+VI/-VI)",
    category: "directional",
    inputs: ["ohlcv"],
    params: [{ key: "period", label: "Period", type: "int", default: 14, min: 1 }],
    reference: "Botes & Siepman (TASC 2010); TR cross-checked vs TA-Lib TRANGE",
    compute: (bars, p) => {
      const r = vortex(bars, p.period ?? 14);
      return { plusVI: r.plusVI, minusVI: r.minusVI };
    },
  },
  {
    id: "supertrend",
    label: "Supertrend (ATR)",
    category: "directional",
    inputs: ["ohlcv"],
    params: [
      { key: "period", label: "ATR Period", type: "int", default: 10, min: 1 },
      { key: "multiplier", label: "Multiplier", type: "float", default: 3, min: 0 },
    ],
    reference: "ATR trailing-stop Supertrend; ATR seeded to TA-Lib 0.6.8 ATR parity",
    compute: (bars, p) => {
      const r = supertrend(bars, p.period ?? 10, p.multiplier ?? 3);
      return { supertrend: r.line, dir: r.dir };
    },
  },
  {
    id: "psar",
    label: "Parabolic SAR",
    category: "directional",
    inputs: ["ohlcv"],
    params: [
      { key: "step", label: "AF Step", type: "float", default: 0.02, min: 0 },
      { key: "max", label: "AF Max", type: "float", default: 0.2, min: 0 },
    ],
    reference: "Wilder 1978; byte-for-byte vs TA-Lib 0.6.8 SAR (0.02/0.2)",
    compute: (bars, p) => psar(bars, p.step ?? 0.02, p.max ?? 0.2),
  },
];
