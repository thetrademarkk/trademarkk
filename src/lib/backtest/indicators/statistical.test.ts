/**
 * Golden tests — statistical indicators.
 *
 * Reference vectors:
 *  - LINEARREG / LINEARREG_SLOPE / STDDEV / MIN / MAX / TRANGE / TYPPRICE /
 *    CORREL: generated offline from TA-Lib 0.6.8 (the foundation oracle, scratch
 *    venv removed after generation) over the deterministic 30-bar fixture below.
 *    No expected values were invented — they are TA-Lib's own outputs.
 *  - Z-score: composed from SMA + population StdDev; reference computed as
 *    (x - SMA)/STDDEV with TA-Lib SMA/STDDEV, eps 1e-6.
 *  - Percent-rank: standard rolling percentile-rank definition (count of window
 *    values strictly below the current value / period * 100).
 *  - Pivot points (classic + fibonacci): the standard published formulas
 *    (Investopedia / StockCharts), with hand-computed expected levels for the
 *    first non-NaN bar.
 *
 * STDDEV is POPULATION (ddof = 0) to match TA-Lib STDDEV(nbdev = 1).
 */

import { describe, expect, it } from "vitest";
import {
  correl,
  createLinRegSlope,
  createLinRegValue,
  createPercentRank,
  createRollingMax,
  createRollingMin,
  createStdDev,
  createZScore,
  linregSlope,
  linregValue,
  percentRank,
  pivotClassic,
  pivotFibonacci,
  rollingMax,
  rollingMin,
  statisticalIndicators,
  stddev,
  trueRange,
  typicalPrice,
  zscore,
} from "./statistical";
import type { OHLCV } from "./types";
import { assertCloseArray, expectDeterministic, nanPrefixLength, runStream } from "./test-helpers";

// Deterministic 30-bar fixture (the inputs given to the TA-Lib oracle).
const CLOSE = [
  22.27, 22.19, 22.08, 22.17, 22.18, 22.13, 22.23, 22.43, 22.24, 22.29, 22.15, 22.39, 22.38, 22.61,
  23.36, 24.05, 23.75, 23.83, 23.95, 23.63, 23.1, 22.95, 23.4, 23.8, 24.1, 23.9, 24.3, 24.55, 24.2,
  24.0,
];
const HIGH = CLOSE.map((c) => c + 0.3);
const LOW = CLOSE.map((c) => c - 0.25);
const OPEN = CLOSE.map((c) => c - 0.05);

const BARS: OHLCV[] = CLOSE.map((c, i) => ({
  time: i * 60000,
  open: OPEN[i]!,
  high: HIGH[i]!,
  low: LOW[i]!,
  close: c,
  volume: 0,
}));

// Second series for CORREL (a noisy oscillator), 30 bars (the oracle input).
const OTHER = [
  1.0, 1.5, 1.2, 2.0, 1.8, 2.5, 2.1, 1.9, 2.3, 2.6, 2.0, 1.7, 2.4, 2.8, 3.5, 3.1, 2.9, 3.4, 3.0,
  2.6, 2.2, 2.0, 2.5, 2.9, 3.3, 3.0, 3.4, 3.6, 3.2, 3.1,
];

const EPS6 = 1e-6;
const EPS_EXACT = 0; // exact for integer-domain / min-max / count outputs

// ---------------------------------------------------------------------------
// TA-Lib 0.6.8 reference vectors (period 5 unless noted).
// ---------------------------------------------------------------------------

const LINREG_5: (number | null)[] = [
  null,
  null,
  null,
  null,
  22.138,
  22.146,
  22.21,
  22.342,
  22.326,
  22.33,
  22.208,
  22.266,
  22.366,
  22.538,
  23.106,
  23.818,
  24.066,
  24.086,
  23.98,
  23.714,
  23.352,
  22.97,
  23.05,
  23.504,
  24.04,
  24.15,
  24.28,
  24.47,
  24.38,
  24.21,
];

const LINREG_SLOPE_5: (number | null)[] = [
  null,
  null,
  null,
  null,
  -0.02,
  -0.002,
  0.026,
  0.057,
  0.042,
  0.033,
  -0.03,
  -0.017,
  0.038,
  0.087,
  0.264,
  0.43,
  0.418,
  0.283,
  0.096,
  -0.064,
  -0.15,
  -0.261,
  -0.178,
  0.064,
  0.285,
  0.26,
  0.19,
  0.17,
  0.085,
  0.01,
];

const STDDEV_5: (number | null)[] = [
  null,
  null,
  null,
  null,
  0.06046487,
  0.04049691,
  0.05035871,
  0.10590562,
  0.10186265,
  0.09789791,
  0.0926067,
  0.10119289,
  0.08966605,
  0.1501466,
  0.41720019,
  0.65297473,
  0.64289968,
  0.50667544,
  0.23718347,
  0.14729562,
  0.29505254,
  0.39761288,
  0.35992221,
  0.31702366,
  0.42848571,
  0.40938979,
  0.30331502,
  0.2712932,
  0.21540659,
  0.22891046,
];

const ZSCORE_5: (number | null)[] = [
  null,
  null,
  null,
  null,
  0.03307706,
  -0.4938648,
  1.42974265,
  1.90735868,
  -0.01963428,
  0.2655828,
  -1.27420593,
  0.88939059,
  1.00372441,
  1.63839879,
  1.87439991,
  1.67234649,
  0.80883537,
  0.61183151,
  0.68301555,
  -1.43928243,
  -1.87085325,
  -1.36313493,
  -0.01667027,
  1.33743962,
  1.47029409,
  0.65951816,
  1.31876095,
  1.54814054,
  -0.04642383,
  -0.83001885,
];

const MIN_5: (number | null)[] = [
  null,
  null,
  null,
  null,
  22.08,
  22.08,
  22.08,
  22.13,
  22.13,
  22.13,
  22.15,
  22.15,
  22.15,
  22.15,
  22.15,
  22.38,
  22.38,
  22.61,
  23.36,
  23.63,
  23.1,
  22.95,
  22.95,
  22.95,
  22.95,
  22.95,
  23.4,
  23.8,
  23.9,
  23.9,
];

const MAX_5: (number | null)[] = [
  null,
  null,
  null,
  null,
  22.27,
  22.19,
  22.23,
  22.43,
  22.43,
  22.43,
  22.43,
  22.43,
  22.39,
  22.61,
  23.36,
  24.05,
  24.05,
  24.05,
  24.05,
  24.05,
  23.95,
  23.95,
  23.95,
  23.8,
  24.1,
  24.1,
  24.3,
  24.55,
  24.55,
  24.55,
];

const PERCENTRANK_5: (number | null)[] = [
  null,
  null,
  null,
  null,
  40,
  20,
  80,
  80,
  60,
  60,
  0,
  60,
  60,
  80,
  80,
  80,
  60,
  60,
  60,
  0,
  0,
  0,
  40,
  80,
  80,
  60,
  80,
  80,
  40,
  20,
];

// TA-Lib TRANGE over the fixture (first value NaN — no prior close).
const TRANGE_REF: (number | null)[] = [
  null,
  0.55,
  0.55,
  0.55,
  0.55,
  0.55,
  0.55,
  0.55,
  0.55,
  0.55,
  0.55,
  0.55,
  0.55,
  0.55,
  1.05,
  0.99,
  0.55,
  0.55,
  0.55,
  0.57,
  0.78,
  0.55,
  0.75,
  0.7,
  0.6,
  0.55,
  0.7,
  0.55,
  0.6,
  0.55,
];

const TYPPRICE_REF: (number | null)[] = [
  22.28666667, 22.20666667, 22.09666667, 22.18666667, 22.19666667, 22.14666667, 22.24666667,
  22.44666667, 22.25666667, 22.30666667, 22.16666667, 22.40666667, 22.39666667, 22.62666667,
  23.37666667, 24.06666667, 23.76666667, 23.84666667, 23.96666667, 23.64666667, 23.11666667,
  22.96666667, 23.41666667, 23.81666667, 24.11666667, 23.91666667, 24.31666667, 24.56666667,
  24.21666667, 24.01666667,
];

const CORREL_5: (number | null)[] = [
  null,
  null,
  null,
  null,
  -0.17938554,
  0.22310537,
  0.47716371,
  -0.46418491,
  -0.49215072,
  -0.62694179,
  -0.13226375,
  -0.4,
  -0.06348111,
  0.50284191,
  0.89391405,
  0.72791295,
  0.62802295,
  0.37047051,
  -0.60897498,
  0.57276753,
  0.86299891,
  0.91870875,
  0.99187126,
  0.98706403,
  0.99847742,
  0.99793728,
  0.99295705,
  0.98415951,
  0.95168861,
  0.98562483,
];

const P = 5;

describe("Linear regression — golden vs TA-Lib 0.6.8 LINEARREG / LINEARREG_SLOPE", () => {
  it("value matches the reference within 1e-6", () => {
    assertCloseArray(linregValue(CLOSE, P), LINREG_5, EPS6, "LINREG");
  });
  it("slope matches the reference within 1e-6", () => {
    assertCloseArray(linregSlope(CLOSE, P), LINREG_SLOPE_5, EPS6, "LINREG_SLOPE");
  });
  it("NaN warmup prefix is exactly period-1", () => {
    expect(nanPrefixLength(linregValue(CLOSE, P))).toBe(P - 1);
    expect(nanPrefixLength(linregSlope(CLOSE, P))).toBe(P - 1);
  });
  it("gotcha: period 1 -> slope 0, value equals the point itself", () => {
    const v = linregValue(CLOSE, 1);
    const s = linregSlope(CLOSE, 1);
    expect(v[0]).toBeCloseTo(CLOSE[0]!, 12);
    expect(v[10]).toBeCloseTo(CLOSE[10]!, 12);
    expect(s.every((x) => x === 0)).toBe(true);
  });
  it("streaming value/slope reproduce the batch series exactly", () => {
    assertCloseArray(runStream(createLinRegValue(P), CLOSE), LINREG_5, EPS6, "stream LINREG");
    assertCloseArray(runStream(createLinRegSlope(P), CLOSE), LINREG_SLOPE_5, EPS6, "stream slope");
  });
  it("deterministic", () => {
    expectDeterministic(() => linregValue(CLOSE, P));
    expectDeterministic(() => linregSlope(CLOSE, P));
  });
});

describe("Standard deviation — golden vs TA-Lib 0.6.8 STDDEV (population)", () => {
  it("matches the reference within 1e-6", () => {
    assertCloseArray(stddev(CLOSE, P), STDDEV_5, EPS6, "STDDEV");
  });
  it("NaN warmup prefix is exactly period-1", () => {
    expect(nanPrefixLength(stddev(CLOSE, P))).toBe(P - 1);
  });
  it("gotcha: flat window -> stddev 0", () => {
    const flat = new Array(10).fill(7);
    const out = stddev(flat, P);
    expect(out[4]).toBe(0);
    expect(out[9]).toBe(0);
  });
  it("streaming reproduces the batch series exactly", () => {
    assertCloseArray(runStream(createStdDev(P), CLOSE), STDDEV_5, EPS6, "stream STDDEV");
  });
  it("deterministic", () => {
    expectDeterministic(() => stddev(CLOSE, P));
  });
});

describe("Z-score — golden vs composed TA-Lib SMA + STDDEV", () => {
  it("matches the reference within 1e-6", () => {
    assertCloseArray(zscore(CLOSE, P), ZSCORE_5, EPS6, "ZSCORE");
  });
  it("NaN warmup prefix is exactly period-1", () => {
    expect(nanPrefixLength(zscore(CLOSE, P))).toBe(P - 1);
  });
  it("gotcha: flat window -> sd 0 -> z 0 (no div-by-zero)", () => {
    const flat = new Array(10).fill(7);
    const out = zscore(flat, P);
    expect(out[4]).toBe(0);
    expect(Number.isFinite(out[9]!)).toBe(true);
    expect(out[9]).toBe(0);
  });
  it("streaming reproduces the batch series exactly", () => {
    assertCloseArray(runStream(createZScore(P), CLOSE), ZSCORE_5, EPS6, "stream ZSCORE");
  });
  it("deterministic", () => {
    expectDeterministic(() => zscore(CLOSE, P));
  });
});

describe("Rolling correlation — golden vs TA-Lib 0.6.8 CORREL", () => {
  it("matches the reference within 1e-6", () => {
    assertCloseArray(correl(CLOSE, OTHER, P), CORREL_5, EPS6, "CORREL");
  });
  it("NaN warmup prefix is exactly period-1", () => {
    expect(nanPrefixLength(correl(CLOSE, OTHER, P))).toBe(P - 1);
  });
  it("gotcha: a constant series in one window -> correlation 0 (no div-by-zero)", () => {
    const a = [1, 2, 3, 4, 5, 6, 7];
    const b = [9, 9, 9, 9, 9, 9, 9];
    const out = correl(a, b, P);
    expect(out[4]).toBe(0);
    expect(out[6]).toBe(0);
  });
  it("identical series -> correlation 1", () => {
    const a = [1, 3, 2, 5, 4, 7, 6];
    assertCloseArray(correl(a, a, P).slice(4), [1, 1, 1], 1e-9, "self-correl");
  });
  it("deterministic", () => {
    expectDeterministic(() => correl(CLOSE, OTHER, P));
  });
});

describe("Rolling min/max — golden vs TA-Lib 0.6.8 MIN / MAX", () => {
  it("min matches the reference exactly", () => {
    assertCloseArray(rollingMin(CLOSE, P), MIN_5, EPS_EXACT, "MIN");
  });
  it("max matches the reference exactly", () => {
    assertCloseArray(rollingMax(CLOSE, P), MAX_5, EPS_EXACT, "MAX");
  });
  it("NaN warmup prefix is exactly period-1", () => {
    expect(nanPrefixLength(rollingMin(CLOSE, P))).toBe(P - 1);
    expect(nanPrefixLength(rollingMax(CLOSE, P))).toBe(P - 1);
  });
  it("gotcha: flat window -> min == max == value", () => {
    const flat = new Array(8).fill(3);
    expect(rollingMin(flat, P)[7]).toBe(3);
    expect(rollingMax(flat, P)[7]).toBe(3);
  });
  it("streaming reproduces the batch series exactly", () => {
    assertCloseArray(runStream(createRollingMin(P), CLOSE), MIN_5, EPS_EXACT, "stream MIN");
    assertCloseArray(runStream(createRollingMax(P), CLOSE), MAX_5, EPS_EXACT, "stream MAX");
  });
  it("deterministic", () => {
    expectDeterministic(() => rollingMin(CLOSE, P));
    expectDeterministic(() => rollingMax(CLOSE, P));
  });
});

describe("Percent-rank — golden vs the rolling percentile-rank definition", () => {
  it("matches the reference exactly", () => {
    assertCloseArray(percentRank(CLOSE, P), PERCENTRANK_5, EPS_EXACT, "PERCENTRANK");
  });
  it("NaN warmup prefix is exactly period-1", () => {
    expect(nanPrefixLength(percentRank(CLOSE, P))).toBe(P - 1);
  });
  it("gotcha: strictly rising window -> current is the max -> 80 (period-1 below)", () => {
    const rising = [1, 2, 3, 4, 5, 6, 7];
    const out = percentRank(rising, P);
    expect(out[4]).toBe(80);
    expect(out[6]).toBe(80);
  });
  it("gotcha: flat window -> nothing strictly below -> 0", () => {
    const flat = new Array(8).fill(5);
    expect(percentRank(flat, P)[7]).toBe(0);
  });
  it("streaming reproduces the batch series exactly", () => {
    assertCloseArray(
      runStream(createPercentRank(P), CLOSE),
      PERCENTRANK_5,
      EPS_EXACT,
      "stream PERCENTRANK"
    );
  });
  it("deterministic", () => {
    expectDeterministic(() => percentRank(CLOSE, P));
  });
});

describe("True range — golden vs TA-Lib 0.6.8 TRANGE", () => {
  it("matches the reference within 1e-6", () => {
    assertCloseArray(trueRange(BARS), TRANGE_REF, EPS6, "TRANGE");
  });
  it("NaN warmup prefix is exactly 1 (no prior close at index 0)", () => {
    expect(nanPrefixLength(trueRange(BARS))).toBe(1);
  });
  it("gotcha: a gap up makes |high - prevClose| the binding term", () => {
    const gap: OHLCV[] = [
      { time: 0, open: 10, high: 11, low: 9, close: 10, volume: 0 },
      { time: 1, open: 20, high: 21, low: 19, close: 20, volume: 0 },
    ];
    // hl=2, |h-pc|=|21-10|=11, |l-pc|=|19-10|=9 -> 11
    expect(trueRange(gap)[1]).toBeCloseTo(11, 9);
  });
  it("deterministic", () => {
    expectDeterministic(() => trueRange(BARS));
  });
});

describe("Typical price — golden vs TA-Lib 0.6.8 TYPPRICE", () => {
  it("matches the reference within 1e-6", () => {
    assertCloseArray(typicalPrice(BARS), TYPPRICE_REF, EPS6, "TYPPRICE");
  });
  it("no warmup (every bar has a value)", () => {
    expect(nanPrefixLength(typicalPrice(BARS))).toBe(0);
  });
  it("gotcha: H==L==C -> typical equals that price", () => {
    const b: OHLCV[] = [{ time: 0, open: 5, high: 5, low: 5, close: 5, volume: 0 }];
    expect(typicalPrice(b)[0]).toBe(5);
  });
  it("deterministic", () => {
    expectDeterministic(() => typicalPrice(BARS));
  });
});

describe("Pivot points — classic + fibonacci (standard published formulas)", () => {
  // Prior bar (index 0): H=22.57, L=22.02, C=22.27. P = (22.57+22.02+22.27)/3.
  const PH = 22.57;
  const PL = 22.02;
  const PC = 22.27;
  const PIV = (PH + PL + PC) / 3; // 22.286666...
  const RANGE = PH - PL; // 0.55

  it("classic levels at the first non-NaN bar match the formula", () => {
    const c = pivotClassic(BARS);
    expect(c.pivot[1]).toBeCloseTo(PIV, 9);
    expect(c.r1[1]).toBeCloseTo(2 * PIV - PL, 9);
    expect(c.s1[1]).toBeCloseTo(2 * PIV - PH, 9);
    expect(c.r2[1]).toBeCloseTo(PIV + RANGE, 9);
    expect(c.s2[1]).toBeCloseTo(PIV - RANGE, 9);
    expect(c.r3[1]).toBeCloseTo(PH + 2 * (PIV - PL), 9);
    expect(c.s3[1]).toBeCloseTo(PL - 2 * (PH - PIV), 9);
  });

  it("fibonacci levels at the first non-NaN bar match the formula", () => {
    const f = pivotFibonacci(BARS);
    expect(f.pivot[1]).toBeCloseTo(PIV, 9);
    expect(f.r1[1]).toBeCloseTo(PIV + 0.382 * RANGE, 9);
    expect(f.r2[1]).toBeCloseTo(PIV + 0.618 * RANGE, 9);
    expect(f.r3[1]).toBeCloseTo(PIV + 1.0 * RANGE, 9);
    expect(f.s1[1]).toBeCloseTo(PIV - 0.382 * RANGE, 9);
    expect(f.s2[1]).toBeCloseTo(PIV - 0.618 * RANGE, 9);
    expect(f.s3[1]).toBeCloseTo(PIV - 1.0 * RANGE, 9);
  });

  it("index 0 is NaN (no prior bar) for both variants", () => {
    const c = pivotClassic(BARS);
    const f = pivotFibonacci(BARS);
    expect(Number.isNaN(c.pivot[0]!)).toBe(true);
    expect(Number.isNaN(f.pivot[0]!)).toBe(true);
    expect(Number.isFinite(c.pivot[1]!)).toBe(true);
    expect(Number.isFinite(f.pivot[1]!)).toBe(true);
  });

  it("pivot uses the PRIOR bar (not the current one)", () => {
    const c = pivotClassic(BARS);
    // bar[2]'s pivot is built from bar[1] H/L/C.
    const exp = (BARS[1]!.high + BARS[1]!.low + BARS[1]!.close) / 3;
    expect(c.pivot[2]).toBeCloseTo(exp, 9);
  });

  it("R levels are above the pivot, S levels below (ordering sanity)", () => {
    const c = pivotClassic(BARS);
    for (let i = 1; i < BARS.length; i++) {
      expect(c.r1[i]!).toBeGreaterThanOrEqual(c.pivot[i]!);
      expect(c.s1[i]!).toBeLessThanOrEqual(c.pivot[i]!);
      expect(c.r2[i]!).toBeGreaterThanOrEqual(c.r1[i]! - 1e-9);
      expect(c.s2[i]!).toBeLessThanOrEqual(c.s1[i]! + 1e-9);
    }
  });

  it("deterministic", () => {
    const a = pivotClassic(BARS).pivot;
    const b = pivotClassic(BARS).pivot;
    expect(a).toEqual(b);
  });
});

describe("statistical registry defs compute via OHLCV", () => {
  const find = (id: string) => statisticalIndicators.find((d) => d.id === id)!;

  it("scalar defs reproduce the bare-function series", () => {
    assertCloseArray(
      find("linregvalue").compute(BARS, { period: P }) as number[],
      LINREG_5,
      EPS6,
      "def linreg"
    );
    assertCloseArray(
      find("linregslope").compute(BARS, { period: P }) as number[],
      LINREG_SLOPE_5,
      EPS6,
      "def slope"
    );
    assertCloseArray(
      find("zscore").compute(BARS, { period: P }) as number[],
      ZSCORE_5,
      EPS6,
      "def zscore"
    );
    assertCloseArray(
      find("min").compute(BARS, { period: P }) as number[],
      MIN_5,
      EPS_EXACT,
      "def min"
    );
    assertCloseArray(
      find("max").compute(BARS, { period: P }) as number[],
      MAX_5,
      EPS_EXACT,
      "def max"
    );
    assertCloseArray(
      find("percentrank").compute(BARS, { period: P }) as number[],
      PERCENTRANK_5,
      EPS_EXACT,
      "def prank"
    );
    assertCloseArray(find("trange").compute(BARS, {}) as number[], TRANGE_REF, EPS6, "def trange");
    assertCloseArray(
      find("typprice").compute(BARS, {}) as number[],
      TYPPRICE_REF,
      EPS6,
      "def typprice"
    );
  });

  it("correl def computes high-vs-low over OHLCV", () => {
    const out = find("correl").compute(BARS, { period: P }) as number[];
    // high/low are linear shifts of close -> perfectly correlated -> 1.
    expect(nanPrefixLength(out)).toBe(P - 1);
    for (let i = P - 1; i < out.length; i++) expect(out[i]).toBeCloseTo(1, 6);
  });

  it("pivot defs return a record of named aligned series", () => {
    const c = find("pivot_classic").compute(BARS, {}) as Record<string, number[]>;
    const f = find("pivot_fibonacci").compute(BARS, {}) as Record<string, number[]>;
    for (const key of ["pivot", "r1", "r2", "r3", "s1", "s2", "s3"]) {
      expect(c[key]!.length).toBe(BARS.length);
      expect(f[key]!.length).toBe(BARS.length);
    }
    expect(c.pivot![1]).toBeCloseTo(22.28666667, 6);
  });
});
