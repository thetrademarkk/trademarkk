/**
 * Golden tests — band & volatility extensions (bands_vol_ext).
 *
 * Fixture: the SAME deterministic 250-bar synthetic OHLC series used by
 * volatility.test.ts (re-exported from ./bands_vol_ext.vectors.ts), plus a
 * deterministic synthetic VOL series (embedded literal) for ADOSC. >=200 bars.
 *
 * Declared reference per indicator (no expected value was invented — each is a
 * direct TA-Lib output or a numpy composition of the indicator's canonical
 * published formula over the embedded fixture; eps stated):
 *  - Chaikin Oscillator (ADOSC, fast 3 / slow 10): TA-Lib 0.6.8
 *    talib.ADOSC(high, low, close, volume, 3, 10). eps 1e-4. (TA-Lib first-value
 *    seeds both EMAs of the A/D line — matched bit-for-bit, max abs err ~5e-9.)
 *  - Ulcer Index (14): StockCharts / Martin-McCann formula (RMS of percent
 *    drawdown vs the rolling window max, incl. current bar), numpy. eps 1e-4.
 *  - Mass Index (EMA 9, sum 25): Donald Dorsey / StockCharts (sum over 25 of
 *    EMA9(H-L) / EMA9(EMA9(H-L))), EMA per the smoothing.ts SMA-seed convention,
 *    numpy. eps 1e-4.
 *  - Historical Volatility (period 10, annual 252): standard close-to-close
 *    log-return SAMPLE stddev (ddof=1) annualized to percent, numpy. eps 1e-4.
 *  - Relative Vigor Index (10) + signal: John Ehlers / TradingView Pine ta RVI
 *    (triangular (1,2,2,1)/6 weighting, SUM(num)/SUM(den), 4-bar signal), numpy.
 *    eps 1e-4.
 *  - STARC Bands (SMA 5, ATR 15, mult 2): Manning Stoller (SMA basis +/- mult*
 *    ATR), ATR via TA-Lib (Wilder parity with volatility.ts atr). eps 1e-4.
 *  - Acceleration Bands (20, factor 4): Price Headley (SMA of high/low scaled by
 *    the per-bar range factor), numpy. eps 1e-4.
 *
 * Excluded: none. Every indicator in this category has an authoritative
 * reference (TA-Lib direct for ADOSC; a canonical published formula composed
 * from TA-Lib/numpy primitives for the rest).
 */

import { describe, expect, it } from "vitest";
import {
  accelerationBands,
  adLine,
  bandsVolExtIndicators,
  chaikinOscillator,
  createUlcerIndex,
  historicalVolatility,
  massIndex,
  relativeVigorIndex,
  starcBands,
  ulcerIndex,
} from "./bands_vol_ext";
import type { OHLCV } from "./types";
import { assertCloseArray, expectDeterministic, nanPrefixLength, runStream } from "./test-helpers";
import {
  ADOSC_3_10,
  AB_LOWER_20,
  AB_MID_20,
  AB_UPPER_20,
  CLOSE,
  HIGH,
  HV_10_252,
  LOW,
  MASS_9_25,
  OPEN,
  RVI_10,
  RVI_SIGNAL_10,
  STARC_LOWER_5_15,
  STARC_MID_5,
  STARC_UPPER_5_15,
  ULCER_14,
  VOL,
} from "./bands_vol_ext.vectors";

const BARS: OHLCV[] = CLOSE.map((c, i) => ({
  time: i * 60000,
  open: OPEN[i]!,
  high: HIGH[i]!,
  low: LOW[i]!,
  close: c,
  volume: VOL[i]!,
}));

const EPS = 1e-4;

// ---------------------------------------------------------------------------
// Chaikin Oscillator (ADOSC) — TA-Lib direct oracle.
// ---------------------------------------------------------------------------
describe("Chaikin Oscillator (ADOSC) — golden vs TA-Lib 0.6.8 (fast 3, slow 10)", () => {
  it("matches the reference within 1e-4", () => {
    assertCloseArray(chaikinOscillator(BARS, 3, 10), ADOSC_3_10, EPS, "ADOSC");
  });

  it("NaN warmup prefix is exactly slow-1 (first value at index slow-1)", () => {
    expect(nanPrefixLength(chaikinOscillator(BARS, 3, 10))).toBe(9);
  });

  it("A/D line has no warmup (defined from bar 0) and is cumulative", () => {
    const adl = adLine(BARS);
    expect(Number.isNaN(adl[0]!)).toBe(false);
    expect(nanPrefixLength(adl)).toBe(0);
  });

  it("gotcha: a flat bar (high==low) contributes 0 money-flow (no div-by-zero)", () => {
    const bars: OHLCV[] = Array.from({ length: 20 }, (_, i) => ({
      time: i,
      open: 50,
      high: 50,
      low: 50,
      close: 50,
      volume: 1000,
    }));
    // Flat A/D -> both EMAs equal -> oscillator is 0 after warmup.
    const out = chaikinOscillator(bars, 3, 10);
    expect(out[9]!).toBe(0);
    expect(out[19]!).toBe(0);
  });

  it("deterministic: same input -> identical output", () => {
    expectDeterministic(() => chaikinOscillator(BARS, 3, 10));
  });

  it("registry def computes ADOSC over OHLCV bars", () => {
    const def = bandsVolExtIndicators.find((d) => d.id === "adosc")!;
    assertCloseArray(
      def.compute(BARS, { fast: 3, slow: 10 }) as number[],
      ADOSC_3_10,
      EPS,
      "def ADOSC"
    );
  });
});

// ---------------------------------------------------------------------------
// Ulcer Index — StockCharts / Martin-McCann.
// ---------------------------------------------------------------------------
describe("Ulcer Index — golden vs StockCharts (period 14)", () => {
  it("matches the reference within 1e-4", () => {
    assertCloseArray(ulcerIndex(CLOSE, 14), ULCER_14, EPS, "UlcerIndex");
  });

  it("NaN warmup prefix is exactly period-1", () => {
    expect(nanPrefixLength(ulcerIndex(CLOSE, 14))).toBe(13);
  });

  it("gotcha: a flat window has zero drawdown vs its max -> UI is 0 (no div-by-zero)", () => {
    // Every close equals the window max, so the percent drawdown is 0 -> UI 0.
    const flat = new Array(30).fill(100);
    const out = ulcerIndex(flat, 14);
    expect(out[13]!).toBeCloseTo(0, 10);
    expect(out[29]!).toBeCloseTo(0, 10);
  });

  it("streaming Ulcer Index reproduces the batch series exactly", () => {
    assertCloseArray(runStream(createUlcerIndex(14), CLOSE), ULCER_14, EPS, "stream Ulcer");
  });

  it("deterministic", () => {
    expectDeterministic(() => ulcerIndex(CLOSE, 14));
  });

  it("registry def computes Ulcer Index", () => {
    const def = bandsVolExtIndicators.find((d) => d.id === "ulcerindex")!;
    assertCloseArray(def.compute(BARS, { period: 14 }) as number[], ULCER_14, EPS, "def Ulcer");
  });
});

// ---------------------------------------------------------------------------
// Mass Index — Dorsey / StockCharts.
// ---------------------------------------------------------------------------
describe("Mass Index — golden vs Dorsey/StockCharts (EMA 9, sum 25)", () => {
  it("matches the reference within 1e-4", () => {
    assertCloseArray(massIndex(BARS, 9, 25), MASS_9_25, EPS, "MassIndex");
  });

  it("NaN warmup prefix is exactly 2*(emaPeriod-1) + sumPeriod-1", () => {
    // ema1 warms at 8, ema2 at 16, sum-of-25 first lands at 16 + 24 = 40.
    expect(nanPrefixLength(massIndex(BARS, 9, 25))).toBe(40);
  });

  it("gotcha: a constant high-low range -> ratio is 1 each bar -> Mass == sumPeriod", () => {
    const bars: OHLCV[] = Array.from({ length: 60 }, (_, i) => ({
      time: i,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 0,
    }));
    const out = massIndex(bars, 9, 25);
    // EMA(const) == const, so ema1==ema2, ratio==1, sum over 25 == 25.
    expect(out[59]!).toBeCloseTo(25, 6);
  });

  it("deterministic", () => {
    expectDeterministic(() => massIndex(BARS, 9, 25));
  });

  it("registry def computes Mass Index", () => {
    const def = bandsVolExtIndicators.find((d) => d.id === "massindex")!;
    assertCloseArray(
      def.compute(BARS, { emaPeriod: 9, sumPeriod: 25 }) as number[],
      MASS_9_25,
      EPS,
      "def Mass"
    );
  });
});

// ---------------------------------------------------------------------------
// Historical Volatility — close-to-close annualized.
// ---------------------------------------------------------------------------
describe("Historical Volatility — golden vs standard close-to-close (period 10, annual 252)", () => {
  it("matches the reference within 1e-4", () => {
    assertCloseArray(historicalVolatility(CLOSE, 10, 252), HV_10_252, EPS, "HistVol");
  });

  it("NaN warmup prefix is exactly `period` (first return at index 1)", () => {
    expect(nanPrefixLength(historicalVolatility(CLOSE, 10, 252))).toBe(10);
  });

  it("gotcha: a flat price series -> zero log returns -> HV is 0", () => {
    const flat = new Array(30).fill(100);
    const out = historicalVolatility(flat, 10, 252);
    expect(out[10]!).toBeCloseTo(0, 10);
    expect(out[29]!).toBeCloseTo(0, 10);
  });

  it("deterministic", () => {
    expectDeterministic(() => historicalVolatility(CLOSE, 10, 252));
  });

  it("registry def computes Historical Volatility", () => {
    const def = bandsVolExtIndicators.find((d) => d.id === "histvol")!;
    assertCloseArray(
      def.compute(BARS, { period: 10, annual: 252 }) as number[],
      HV_10_252,
      EPS,
      "def HV"
    );
  });
});

// ---------------------------------------------------------------------------
// Relative Vigor Index — Ehlers / TradingView.
// ---------------------------------------------------------------------------
describe("Relative Vigor Index — golden vs Ehlers/TradingView (period 10)", () => {
  it("rvi line matches the reference within 1e-4", () => {
    assertCloseArray(relativeVigorIndex(BARS, 10).rvi, RVI_10, EPS, "RVI");
  });

  it("signal line matches the reference within 1e-4", () => {
    assertCloseArray(relativeVigorIndex(BARS, 10).signal, RVI_SIGNAL_10, EPS, "RVI signal");
  });

  it("warmup: rvi at index period+2, signal three bars later", () => {
    const r = relativeVigorIndex(BARS, 10);
    expect(nanPrefixLength(r.rvi)).toBe(12);
    expect(nanPrefixLength(r.signal)).toBe(15);
  });

  it("gotcha: a flat range (high==low every bar) -> denominator 0 -> RVI is 0", () => {
    const bars: OHLCV[] = Array.from({ length: 30 }, (_, i) => ({
      time: i,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 0,
    }));
    const r = relativeVigorIndex(bars, 10);
    expect(r.rvi[12]!).toBe(0);
    expect(r.rvi[29]!).toBe(0);
  });

  it("deterministic", () => {
    expectDeterministic(() => relativeVigorIndex(BARS, 10).rvi);
  });

  it("registry def returns the named rvi/signal record", () => {
    const def = bandsVolExtIndicators.find((d) => d.id === "rvi")!;
    const out = def.compute(BARS, { period: 10 }) as Record<string, number[]>;
    assertCloseArray(out.rvi!, RVI_10, EPS, "def RVI");
    assertCloseArray(out.signal!, RVI_SIGNAL_10, EPS, "def RVI signal");
  });
});

// ---------------------------------------------------------------------------
// STARC Bands — Manning Stoller.
// ---------------------------------------------------------------------------
describe("STARC Bands — golden vs Stoller (SMA 5, ATR 15, mult 2)", () => {
  it("mid/upper/lower match the reference within 1e-4", () => {
    const s = starcBands(BARS, 5, 15, 2);
    assertCloseArray(s.middle, STARC_MID_5, EPS, "STARC mid");
    assertCloseArray(s.upper, STARC_UPPER_5_15, EPS, "STARC upper");
    assertCloseArray(s.lower, STARC_LOWER_5_15, EPS, "STARC lower");
  });

  it("warmup: mid at maPeriod-1, bands at max(maPeriod-1, atrPeriod)", () => {
    const s = starcBands(BARS, 5, 15, 2);
    expect(nanPrefixLength(s.middle)).toBe(4);
    expect(nanPrefixLength(s.upper)).toBe(15);
    expect(nanPrefixLength(s.lower)).toBe(15);
  });

  it("gotcha: a flat series -> ATR 0 -> bands collapse onto the SMA basis", () => {
    const flat: OHLCV[] = Array.from({ length: 30 }, (_, i) => ({
      time: i,
      open: 60,
      high: 60,
      low: 60,
      close: 60,
      volume: 0,
    }));
    const s = starcBands(flat, 5, 15, 2);
    expect(s.middle[29]!).toBeCloseTo(60, 6);
    expect(s.upper[29]!).toBeCloseTo(60, 6);
    expect(s.lower[29]!).toBeCloseTo(60, 6);
  });

  it("deterministic", () => {
    expectDeterministic(() => starcBands(BARS, 5, 15, 2).upper);
  });

  it("registry def returns the named band record", () => {
    const def = bandsVolExtIndicators.find((d) => d.id === "starc")!;
    const out = def.compute(BARS, { maPeriod: 5, atrPeriod: 15, mult: 2 }) as Record<
      string,
      number[]
    >;
    assertCloseArray(out.middle!, STARC_MID_5, EPS, "def STARC mid");
    assertCloseArray(out.upper!, STARC_UPPER_5_15, EPS, "def STARC upper");
    assertCloseArray(out.lower!, STARC_LOWER_5_15, EPS, "def STARC lower");
  });
});

// ---------------------------------------------------------------------------
// Acceleration Bands — Price Headley.
// ---------------------------------------------------------------------------
describe("Acceleration Bands — golden vs Headley (period 20, factor 4)", () => {
  it("mid/upper/lower match the reference within 1e-4", () => {
    const a = accelerationBands(BARS, 20, 4);
    assertCloseArray(a.middle, AB_MID_20, EPS, "AB mid");
    assertCloseArray(a.upper, AB_UPPER_20, EPS, "AB upper");
    assertCloseArray(a.lower, AB_LOWER_20, EPS, "AB lower");
  });

  it("NaN warmup prefix is exactly period-1 on every band", () => {
    const a = accelerationBands(BARS, 20, 4);
    expect(nanPrefixLength(a.middle)).toBe(19);
    expect(nanPrefixLength(a.upper)).toBe(19);
    expect(nanPrefixLength(a.lower)).toBe(19);
  });

  it("gotcha: a flat bar (high==low) -> range factor 0 -> upper==high, lower==low", () => {
    const bars: OHLCV[] = Array.from({ length: 25 }, (_, i) => ({
      time: i,
      open: 50,
      high: 50,
      low: 50,
      close: 50,
      volume: 0,
    }));
    const a = accelerationBands(bars, 20, 4);
    expect(a.upper[19]!).toBeCloseTo(50, 6);
    expect(a.lower[19]!).toBeCloseTo(50, 6);
    expect(a.middle[19]!).toBeCloseTo(50, 6);
  });

  it("deterministic", () => {
    expectDeterministic(() => accelerationBands(BARS, 20, 4).upper);
  });

  it("registry def returns the named band record", () => {
    const def = bandsVolExtIndicators.find((d) => d.id === "accelbands")!;
    const out = def.compute(BARS, { period: 20, factor: 4 }) as Record<string, number[]>;
    assertCloseArray(out.middle!, AB_MID_20, EPS, "def AB mid");
    assertCloseArray(out.upper!, AB_UPPER_20, EPS, "def AB upper");
    assertCloseArray(out.lower!, AB_LOWER_20, EPS, "def AB lower");
  });
});
