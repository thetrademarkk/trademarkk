/**
 * Golden tests — momentum oscillators.
 *
 * Reference policy (per the foundation oracle decision):
 *  - RSI: canonical StockCharts / Wilder (1978) 14-period worked example
 *    (first value 70.53), byte-confirmed against TA-Lib 0.6.8 at 1e-4.
 *  - Stochastic (slow/fast), StochRSI, CCI, Williams %R, ROC, Momentum, MFI,
 *    Ultimate Oscillator, MACD: golden vectors generated OFFLINE from TA-Lib
 *    0.6.8 (Python 3.11.7 scratch venv, since removed) over a deterministic
 *    220-bar LCG fixture (see momentum.vectors.ts). Default TA-Lib params.
 *    Asserted at 1e-4 (TA-Lib emits ~6 sig figs in the captured vectors).
 *  - TSI: NOT in TA-Lib. Declared reference = bukosabino/ta (MIT) TSIIndicator
 *    (window_slow=25, window_fast=13). The double-EMA seeding transient differs
 *    early between independent impls (ta vs pandas ewm) but CONVERGES; the two
 *    agree to 0 in the tail. We therefore assert the CONVERGED TAIL of TSI
 *    against the `ta` reference at 1e-4 (the early warmup transient is excluded,
 *    matching the design doc's "converged tail" rule for recursive indicators).
 *
 * The LCG fixture (reproduced verbatim in Python to generate the vectors):
 *   s = seed; rnd() => s = (s*1103515245 + 12345) mod 2^31; return s / 2^31
 *   close starts 100, drifts by (rnd()-0.5)*2; H/L spread from rnd(); 220 bars.
 */

import { describe, expect, it } from "vitest";
import {
  cci,
  createMACD,
  createMomentum,
  createROC,
  createRSI,
  macd,
  mfi,
  momentum,
  momentumIndicators,
  roc,
  rsi,
  stoch,
  stochFast,
  stochRsi,
  tsi,
  ultimateOscillator,
  williamsR,
} from "./momentum";
import type { OHLCV } from "./types";
import { assertCloseArray, expectDeterministic, nanPrefixLength, runStream } from "./test-helpers";
import {
  BARS,
  CCI_20,
  MACD as MACD_REF,
  MACD_HIST,
  MACD_SIGNAL,
  MFI_14,
  MOM_10,
  ROC_10,
  STOCH_D,
  STOCH_K,
  STOCHF_D,
  STOCHF_K,
  STOCHRSI_D,
  STOCHRSI_K,
  TSI as TSI_REF,
  ULTOSC,
  WILLR_14,
} from "./momentum.vectors";

const EPS = 1e-4;
const CLOSES = BARS.map((b) => b.close);

/** Run a multi-output stream over BARS and collect a named series. */
function runMultiStream(
  stream: { push(x: number): { [k: string]: number } },
  key: string
): number[] {
  return CLOSES.map((c) => stream.push(c)[key]!);
}

// StockCharts RSI worked-example closes (33 bars).
const RSI_CLOSES = [
  44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931,
  46.0328, 45.614, 46.282, 46.282, 46.0028, 46.0328, 46.4116, 46.2222, 45.6439, 46.2122, 46.2521,
  45.7137, 46.4515, 45.7835, 45.3548, 44.0288, 44.1783, 44.2181, 44.5672, 43.4205, 42.6628, 43.1314,
];

// TA-Lib 0.6.8 RSI(14) over RSI_CLOSES. First value (index 14) = 70.5328.
const RSI14_REF: (number | null)[] = [
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  70.5328,
  66.3186,
  66.5498,
  69.4063,
  66.3552,
  57.9749,
  62.9296,
  63.2571,
  56.0593,
  62.3771,
  54.7076,
  50.4228,
  39.9898,
  41.4605,
  41.8689,
  45.4632,
  37.304,
  33.0795,
  37.773,
];

describe("RSI — golden vs Wilder 1978 / StockCharts (TA-Lib 0.6.8 confirmed)", () => {
  it("matches the reference within 1e-4", () => {
    assertCloseArray(rsi(RSI_CLOSES, 14), RSI14_REF, EPS, "RSI14");
  });

  it("first RSI value equals the published StockCharts value 70.53", () => {
    expect(rsi(RSI_CLOSES, 14)[14]).toBeCloseTo(70.53, 2);
  });

  it("NaN warmup prefix is exactly period (first RSI at index period)", () => {
    expect(nanPrefixLength(rsi(RSI_CLOSES, 14))).toBe(14);
  });

  it("gotcha: a strictly rising series -> avgLoss 0 -> RSI 100", () => {
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i);
    const out = rsi(rising, 14);
    expect(out[14]).toBe(100);
    expect(out[19]).toBe(100);
  });

  it("gotcha: a strictly falling series -> avgGain 0 -> RSI 0", () => {
    const falling = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(rsi(falling, 14)[14]).toBe(0);
  });

  it("gotcha: a flat series (no gain, no loss) -> RSI 50 (no div-by-zero)", () => {
    const flat = new Array(20).fill(50);
    const out = rsi(flat, 14);
    expect(out[14]).toBe(50);
    expect(Number.isFinite(out[19]!)).toBe(true);
  });

  it("streaming RSI reproduces the batch series exactly", () => {
    assertCloseArray(runStream(createRSI(14), RSI_CLOSES), RSI14_REF, EPS, "stream RSI14");
  });

  it("deterministic: same input -> identical output", () => {
    expectDeterministic(() => rsi(RSI_CLOSES, 14));
  });

  it("registry def computes RSI over OHLCV closes", () => {
    const bars: OHLCV[] = RSI_CLOSES.map((c, i) => ({
      time: i * 60000,
      open: c,
      high: c,
      low: c,
      close: c,
      volume: 0,
    }));
    const def = momentumIndicators.find((d) => d.id === "rsi")!;
    assertCloseArray(def.compute(bars, { period: 14 }) as number[], RSI14_REF, EPS, "def RSI");
  });
});

describe("Stochastic (slow %K/%D) — golden vs TA-Lib 0.6.8 STOCH(14,3,3)", () => {
  it("matches the reference within 1e-4", () => {
    const r = stoch(BARS, 14, 3, 3);
    assertCloseArray(r.k, STOCH_K, EPS, "stoch %K");
    assertCloseArray(r.d, STOCH_D, EPS, "stoch %D");
  });

  it("NaN warmup prefix is 17 for both %K and %D (kPeriod-1 + slowK-1 + dPeriod-1)", () => {
    const r = stoch(BARS, 14, 3, 3);
    expect(nanPrefixLength(r.k)).toBe(17);
    expect(nanPrefixLength(r.d)).toBe(17);
  });

  it("gotcha: a flat range (HH == LL) -> %K 0 (no div-by-zero)", () => {
    const flat: OHLCV[] = Array.from({ length: 25 }, (_, i) => ({
      time: i,
      open: 50,
      high: 50,
      low: 50,
      close: 50,
      volume: 1,
    }));
    const r = stoch(flat, 14, 3, 3);
    expect(r.k[24]).toBe(0);
    expect(r.d[24]).toBe(0);
  });

  it("deterministic", () => {
    expectDeterministic(() => stoch(BARS, 14, 3, 3).k);
  });

  it("registry def reproduces the bare series", () => {
    const def = momentumIndicators.find((d) => d.id === "stoch")!;
    const out = def.compute(BARS, { kPeriod: 14, slowK: 3, dPeriod: 3 }) as Record<
      string,
      number[]
    >;
    assertCloseArray(out.k!, STOCH_K, EPS, "def stoch %K");
    assertCloseArray(out.d!, STOCH_D, EPS, "def stoch %D");
  });
});

describe("Stochastic Fast (%K/%D) — golden vs TA-Lib 0.6.8 STOCHF(14,3)", () => {
  it("matches the reference within 1e-4", () => {
    const r = stochFast(BARS, 14, 3);
    assertCloseArray(r.k, STOCHF_K, EPS, "stochf %K");
    assertCloseArray(r.d, STOCHF_D, EPS, "stochf %D");
  });

  it("NaN warmup prefix is 15 (kPeriod-1 + dPeriod-1)", () => {
    const r = stochFast(BARS, 14, 3);
    expect(nanPrefixLength(r.k)).toBe(15);
    expect(nanPrefixLength(r.d)).toBe(15);
  });

  it("deterministic", () => {
    expectDeterministic(() => stochFast(BARS, 14, 3).d);
  });
});

describe("Stochastic RSI (%K/%D) — golden vs TA-Lib 0.6.8 STOCHRSI(14,14,3)", () => {
  it("matches the reference within 1e-4", () => {
    const r = stochRsi(CLOSES, 14, 14, 3);
    assertCloseArray(r.k, STOCHRSI_K, EPS, "stochrsi %K");
    assertCloseArray(r.d, STOCHRSI_D, EPS, "stochrsi %D");
  });

  it("NaN warmup prefix is 29 (rsi 14 + stoch 14-1 + d 3-1)", () => {
    const r = stochRsi(CLOSES, 14, 14, 3);
    expect(nanPrefixLength(r.k)).toBe(29);
  });

  it("gotcha: a flat RSI window (max == min) -> %K 0 (no div-by-zero)", () => {
    // Strictly rising prices -> RSI pinned at 100 -> flat RSI window -> %K 0.
    const rising = Array.from({ length: 40 }, (_, i) => 100 + i);
    const r = stochRsi(rising, 14, 14, 3);
    expect(r.k[39]).toBe(0);
  });

  it("deterministic", () => {
    expectDeterministic(() => stochRsi(CLOSES, 14, 14, 3).k);
  });
});

describe("CCI — golden vs TA-Lib 0.6.8 CCI(20)", () => {
  it("matches the reference within 1e-4", () => {
    assertCloseArray(cci(BARS, 20), CCI_20, EPS, "CCI20");
  });

  it("NaN warmup prefix is 19 (period-1)", () => {
    expect(nanPrefixLength(cci(BARS, 20))).toBe(19);
  });

  it("gotcha: a flat typical price (meanDev == 0) -> CCI 0 (no div-by-zero)", () => {
    const flat: OHLCV[] = Array.from({ length: 25 }, (_, i) => ({
      time: i,
      open: 10,
      high: 10,
      low: 10,
      close: 10,
      volume: 1,
    }));
    expect(cci(flat, 20)[24]).toBe(0);
  });

  it("deterministic", () => {
    expectDeterministic(() => cci(BARS, 20));
  });

  it("registry def reproduces the bare series", () => {
    const def = momentumIndicators.find((d) => d.id === "cci")!;
    assertCloseArray(def.compute(BARS, { period: 20 }) as number[], CCI_20, EPS, "def CCI");
  });
});

describe("Williams %R — golden vs TA-Lib 0.6.8 WILLR(14)", () => {
  it("matches the reference within 1e-4", () => {
    assertCloseArray(williamsR(BARS, 14), WILLR_14, EPS, "WILLR14");
  });

  it("NaN warmup prefix is 13 (period-1)", () => {
    expect(nanPrefixLength(williamsR(BARS, 14))).toBe(13);
  });

  it("gotcha: a flat range (HH == LL) -> %R 0 (no div-by-zero)", () => {
    const flat: OHLCV[] = Array.from({ length: 20 }, (_, i) => ({
      time: i,
      open: 5,
      high: 5,
      low: 5,
      close: 5,
      volume: 1,
    }));
    expect(williamsR(flat, 14)[19]).toBe(0);
  });

  it("deterministic", () => {
    expectDeterministic(() => williamsR(BARS, 14));
  });
});

describe("ROC — golden vs TA-Lib 0.6.8 ROC(10)", () => {
  it("matches the reference within 1e-4", () => {
    assertCloseArray(roc(CLOSES, 10), ROC_10, EPS, "ROC10");
  });

  it("NaN warmup prefix is 10 (first value at index period)", () => {
    expect(nanPrefixLength(roc(CLOSES, 10))).toBe(10);
  });

  it("gotcha: a short series (length <= period) -> all NaN", () => {
    expect(roc([1, 2, 3], 10).every((v) => Number.isNaN(v))).toBe(true);
  });

  it("streaming ROC reproduces the batch series exactly", () => {
    assertCloseArray(runStream(createROC(10), CLOSES), ROC_10, EPS, "stream ROC10");
  });

  it("deterministic", () => {
    expectDeterministic(() => roc(CLOSES, 10));
  });

  it("registry def reproduces the bare series", () => {
    const def = momentumIndicators.find((d) => d.id === "roc")!;
    assertCloseArray(def.compute(BARS, { period: 10 }) as number[], ROC_10, EPS, "def ROC");
  });
});

describe("Momentum (MOM) — golden vs TA-Lib 0.6.8 MOM(10)", () => {
  it("matches the reference within 1e-4", () => {
    assertCloseArray(momentum(CLOSES, 10), MOM_10, EPS, "MOM10");
  });

  it("NaN warmup prefix is 10 (first value at index period)", () => {
    expect(nanPrefixLength(momentum(CLOSES, 10))).toBe(10);
  });

  it("gotcha: a flat series -> 0 difference (finite, not NaN past warmup)", () => {
    const flat = new Array(20).fill(7);
    expect(momentum(flat, 10)[19]).toBe(0);
  });

  it("streaming Momentum reproduces the batch series exactly", () => {
    assertCloseArray(runStream(createMomentum(10), CLOSES), MOM_10, EPS, "stream MOM10");
  });

  it("deterministic", () => {
    expectDeterministic(() => momentum(CLOSES, 10));
  });
});

describe("MFI — golden vs TA-Lib 0.6.8 MFI(14)", () => {
  it("matches the reference within 1e-4", () => {
    assertCloseArray(mfi(BARS, 14), MFI_14, EPS, "MFI14");
  });

  it("NaN warmup prefix is 14 (first value at index period)", () => {
    expect(nanPrefixLength(mfi(BARS, 14))).toBe(14);
  });

  it("gotcha: strictly rising typical price (negMF == 0) -> MFI 100", () => {
    const rising: OHLCV[] = Array.from({ length: 20 }, (_, i) => ({
      time: i,
      open: 100 + i,
      high: 100 + i,
      low: 100 + i,
      close: 100 + i,
      volume: 1000,
    }));
    expect(mfi(rising, 14)[19]).toBe(100);
  });

  it("deterministic", () => {
    expectDeterministic(() => mfi(BARS, 14));
  });

  it("registry def reproduces the bare series", () => {
    const def = momentumIndicators.find((d) => d.id === "mfi")!;
    assertCloseArray(def.compute(BARS, { period: 14 }) as number[], MFI_14, EPS, "def MFI");
  });
});

describe("Ultimate Oscillator — golden vs TA-Lib 0.6.8 ULTOSC(7,14,28)", () => {
  it("matches the reference within 1e-4", () => {
    assertCloseArray(ultimateOscillator(BARS, 7, 14, 28), ULTOSC, EPS, "ULTOSC");
  });

  it("NaN warmup prefix is 28 (the long period)", () => {
    expect(nanPrefixLength(ultimateOscillator(BARS, 7, 14, 28))).toBe(28);
  });

  it("deterministic", () => {
    expectDeterministic(() => ultimateOscillator(BARS, 7, 14, 28));
  });
});

describe("MACD — golden vs TA-Lib 0.6.8 MACD(12,26,9), converged tail", () => {
  // This library composes MACD from SMA-seeded EMAs (the pinned EMA seed in
  // smoothing.ts, TA-Lib EMA parity). TA-Lib's internal MACD seeds its EMAs
  // with a slightly different unstable-period offset, so the EARLY values
  // differ by a seeding transient that DAMPS OUT: ema12-ema26 converges to
  // TA-Lib's MACD line to within 1e-4 from index 55 and the signal/hist from
  // index 63 (verified offline). Per the design doc's "converged tail" rule for
  // recursive indicators we assert from index 80 (safe margin). The streaming
  // form is asserted to reproduce the BATCH form byte-for-byte over the full
  // series (that equivalence does not depend on the reference seeding).
  const TAIL_FROM = 80;

  it("converged tail matches the reference within 1e-4 (line / signal / hist)", () => {
    const r = macd(CLOSES, 12, 26, 9);
    assertCloseArray(r.macd.slice(TAIL_FROM), MACD_REF.slice(TAIL_FROM), EPS, "MACD line");
    assertCloseArray(r.signal.slice(TAIL_FROM), MACD_SIGNAL.slice(TAIL_FROM), EPS, "MACD signal");
    assertCloseArray(r.hist.slice(TAIL_FROM), MACD_HIST.slice(TAIL_FROM), EPS, "MACD hist");
  });

  it("NaN warmup prefix is 33 (slow-1 + signal-1) for all three outputs", () => {
    const r = macd(CLOSES, 12, 26, 9);
    expect(nanPrefixLength(r.macd)).toBe(33);
    expect(nanPrefixLength(r.signal)).toBe(33);
    expect(nanPrefixLength(r.hist)).toBe(33);
  });

  it("hist == line - signal exactly everywhere both are defined", () => {
    const r = macd(CLOSES, 12, 26, 9);
    for (let i = 0; i < r.macd.length; i++) {
      if (!Number.isNaN(r.macd[i]!)) {
        expect(r.hist[i]).toBeCloseTo(r.macd[i]! - r.signal[i]!, 10);
      }
    }
  });

  it("gotcha: short series (< slow+signal) -> all NaN", () => {
    const short = Array.from({ length: 20 }, (_, i) => 100 + i);
    const r = macd(short, 12, 26, 9);
    expect(r.macd.every((v) => Number.isNaN(v))).toBe(true);
    expect(r.signal.every((v) => Number.isNaN(v))).toBe(true);
  });

  it("streaming MACD reproduces the BATCH series exactly (byte-for-byte)", () => {
    const batch = macd(CLOSES, 12, 26, 9);
    assertCloseArray(runMultiStream(createMACD(12, 26, 9), "macd"), batch.macd, 0, "stream MACD");
    assertCloseArray(
      runMultiStream(createMACD(12, 26, 9), "signal"),
      batch.signal,
      0,
      "stream signal"
    );
    assertCloseArray(runMultiStream(createMACD(12, 26, 9), "hist"), batch.hist, 0, "stream hist");
  });

  it("deterministic", () => {
    expectDeterministic(() => macd(CLOSES, 12, 26, 9).hist);
  });

  it("registry def reproduces the bare series (converged tail)", () => {
    const def = momentumIndicators.find((d) => d.id === "macd")!;
    const out = def.compute(BARS, { fast: 12, slow: 26, signal: 9 }) as Record<string, number[]>;
    assertCloseArray(out.macd!.slice(TAIL_FROM), MACD_REF.slice(TAIL_FROM), EPS, "def MACD line");
    assertCloseArray(
      out.signal!.slice(TAIL_FROM),
      MACD_SIGNAL.slice(TAIL_FROM),
      EPS,
      "def MACD signal"
    );
    assertCloseArray(out.hist!.slice(TAIL_FROM), MACD_HIST.slice(TAIL_FROM), EPS, "def MACD hist");
  });
});

describe("TSI — golden vs bukosabino/ta TSIIndicator(25,13), converged tail", () => {
  // The double-EMA seeding transient differs early between independent impls;
  // assert the CONVERGED TAIL (index >= 120) against the `ta` reference.
  const TAIL_FROM = 120;

  it("converged tail matches the `ta` reference within 1e-4", () => {
    const out = tsi(CLOSES, 25, 13);
    const a = out.slice(TAIL_FROM);
    const e = TSI_REF.slice(TAIL_FROM);
    assertCloseArray(a, e, EPS, "TSI tail");
  });

  it("the early values are finite (the warmup transient is real, not NaN)", () => {
    const out = tsi(CLOSES, 25, 13);
    // First numeric value lands at index 1 (after the first price-change).
    expect(Number.isNaN(out[0]!)).toBe(true);
    expect(Number.isFinite(out[1]!)).toBe(true);
  });

  it("gotcha: a flat series (no price change) -> 0 (no div-by-zero)", () => {
    const flat = new Array(60).fill(42);
    const out = tsi(flat, 25, 13);
    expect(out[59]).toBe(0);
  });

  it("deterministic", () => {
    expectDeterministic(() => tsi(CLOSES, 25, 13));
  });

  it("registry def reproduces the bare series (converged tail)", () => {
    const def = momentumIndicators.find((d) => d.id === "tsi")!;
    const out = (def.compute(BARS, { slow: 25, fast: 13 }) as number[]).slice(TAIL_FROM);
    assertCloseArray(out, TSI_REF.slice(TAIL_FROM), EPS, "def TSI tail");
  });
});
