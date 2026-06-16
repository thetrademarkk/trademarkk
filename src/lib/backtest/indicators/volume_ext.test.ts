/**
 * Golden tests — extended volume indicators (NVI, PVI, Volume Oscillator,
 * Twiggs Money Flow, VWAP std-dev bands).
 *
 * Fixture: the SAME deterministic 60-bar OHLCV series used by volume.test.ts
 * (LCG-generated; H>=max(O,C), L<=min(O,C)). That series + the parameters below
 * were fed to an offline oracle (scratch TA-Lib 0.6.8 venv, removed afterwards;
 * oracle script: oracle_volume_ext.py) to produce each expected vector — no
 * expected value is invented.
 *
 * Declared references (golden, per indicator):
 *  - NVI    : Norman Fosback "Stock Market Logic" (1976) / StockCharts NVI.
 *             Cumulative index, seed 1000; grows by close return on volume-down
 *             bars, carries forward otherwise.
 *  - PVI    : Fosback / StockCharts PVI (same, on volume-up bars).
 *  - VolOsc : StockCharts Volume Oscillator = 100*(SMA(V,fast)-SMA(V,slow))
 *             /SMA(V,slow); the SMA oracle is TA-Lib 0.6.8 SMA (eps 1e-6).
 *  - TMF    : Colin Twiggs / IncredibleCharts Twiggs Money Flow — Wilder MA of
 *             true-range money flow over Wilder MA of volume, period 21.
 *  - VWAP±  : TradingView VWAP Bands — single-session cumulative VWAP plus/minus
 *             mult * volume-weighted std of typical price.
 *
 * EXCLUDED: Klinger Volume Oscillator (KVO). The cumulative-measurement (cm)
 * accumulation rule diverges across Klinger's original text, StockCharts and the
 * common TradingView Pine ports, so no single authoritative numeric reference
 * vector exists; and over this 60-bar fixture the KVO signal line (EMA13 of
 * EMA34-EMA55) never warms up. Per the oracle policy we exclude it rather than
 * assert a contested variant.
 *
 * Cumulative NVI/PVI/VWAP are asserted at eps 1e-4; recursive Wilder-smoothed
 * TMF at 1e-5; the SMA-based Volume Oscillator at 1e-6 (TA-Lib direct).
 */

import { describe, expect, it } from "vitest";
import {
  createNVI,
  createPVI,
  createVwapBands,
  nvi,
  pvi,
  twiggsMoneyFlow,
  volumeExtIndicators,
  volumeOscillator,
  vwapBands,
} from "./volume_ext";
import type { OHLCV } from "./types";
import { assertCloseArray, expectDeterministic, nanPrefixLength } from "./test-helpers";

// ---- Deterministic 60-bar fixture (mirrors volume.test.ts / the oracle) ----
const HIGHS = [
  101.3723, 100.3962, 101.9056, 101.2191, 102.0221, 103.3249, 103.1213, 104.5358, 103.7695,
  103.3736, 102.8884, 101.7356, 101.294, 100.887, 99.4272, 99.7517, 98.9568, 99.843, 99.4802,
  98.7694, 99.1521, 97.0184, 95.127, 96.0328, 94.5829, 97.2504, 96.6195, 98.2569, 97.5025, 100.4999,
  102.0965, 101.3953, 101.6568, 100.1885, 103.123, 101.9765, 101.6776, 101.4345, 100.1307, 98.9726,
  99.7585, 99.1575, 98.4068, 98.9374, 100.1602, 102.5303, 103.9628, 104.2321, 105.9115, 105.0452,
  105.0877, 105.6121, 105.881, 106.5994, 105.4652, 105.9077, 105.2425, 106.2602, 105.0896, 105.4654,
];
const LOWS = [
  99.068, 99.1847, 99.655, 98.6213, 100.3449, 100.5238, 101.5187, 100.2644, 99.6587, 99.0774,
  98.6985, 97.6401, 99.7707, 97.9884, 97.9527, 97.375, 95.7106, 97.1934, 96.3364, 95.6323, 95.0363,
  94.582, 92.1154, 93.2771, 92.27, 93.072, 93.9941, 95.0635, 94.961, 96.1098, 97.4244, 97.7847,
  98.2446, 98.4331, 98.6638, 100.2716, 98.5253, 99.1837, 96.7709, 97.925, 96.7109, 96.7498, 95.6874,
  96.4688, 97.4497, 98.6164, 101.3869, 101.9168, 99.9437, 100.0779, 102.2183, 102.5884, 101.9664,
  104.4078, 100.7381, 101.6625, 103.0777, 101.7624, 102.568, 102.4763,
];
const CLOSES = [
  100.3292, 100.0197, 100.4691, 100.7182, 101.3562, 103.0539, 102.6814, 101.2363, 102.0648,
  100.9397, 99.2828, 101.0181, 100.0185, 99.0652, 98.3976, 98.8189, 97.2295, 98.921, 97.0044,
  98.0016, 96.7254, 94.8129, 93.2901, 94.3363, 94.072, 95.8338, 95.7868, 96.7085, 97.4856, 99.1386,
  100.7935, 99.7692, 100.1176, 99.9446, 101.2325, 100.5234, 99.8313, 99.8642, 98.7199, 97.9322,
  98.618, 97.6399, 97.85, 98.4997, 99.5633, 101.4329, 101.9662, 103.8399, 101.8349, 103.5622,
  103.2981, 103.8711, 105.7844, 104.6711, 102.7204, 104.597, 103.1606, 104.2399, 103.9981, 105.3974,
];
const VOLS = [
  4885, 5043, 3580, 1554, 4355, 5245, 5020, 3255, 4123, 2233, 1472, 2310, 5540, 2932, 2742, 5581,
  3583, 3359, 5693, 2459, 3724, 5499, 1126, 1741, 3807, 4178, 5652, 3501, 5929, 3938, 3566, 5968,
  3305, 5913, 3725, 2401, 2150, 4706, 1422, 2963, 3553, 5258, 5258, 1595, 5351, 4731, 4023, 2894,
  4001, 4375, 3565, 3987, 1461, 1409, 3669, 1402, 2062, 5894, 4929, 2949,
];

const BARS: OHLCV[] = HIGHS.map((_, i) => ({
  time: i * 60_000,
  open: CLOSES[i]!, // open is unused by these indicators; fixture value is irrelevant
  high: HIGHS[i]!,
  low: LOWS[i]!,
  close: CLOSES[i]!,
  volume: VOLS[i]!,
}));

const CL = CLOSES;
const VL = VOLS;

// ---- Declared reference vectors (offline oracle over BARS) ----

// Fosback / StockCharts NVI, seed 1000.
const NVI_REF = [
  1000.0, 1000.0, 1004.493115, 1006.983624, 1006.983624, 1006.983624, 1003.343768, 989.223079,
  989.223079, 978.318488, 962.259634, 962.259634, 962.259634, 953.08811, 946.665253, 946.665253,
  931.439119, 947.64335, 947.64335, 957.385073, 957.385073, 957.385073, 942.00841, 942.00841,
  942.00841, 942.00841, 942.00841, 951.072803, 951.072803, 967.199526, 983.344787, 983.344787,
  986.778685, 986.778685, 999.494453, 992.493326, 985.660045, 985.660045, 974.3658, 974.3658,
  974.3658, 974.3658, 974.3658, 980.83535, 980.83535, 999.253479, 1004.507217, 1022.965738,
  1022.965738, 1022.965738, 1020.357013, 1020.357013, 1039.151934, 1028.215654, 1028.215654,
  1047.000135, 1047.000135, 1047.000135, 1044.571462, 1058.626227,
];

// Fosback / StockCharts PVI, seed 1000.
const PVI_REF = [
  1000.0, 996.915155, 996.915155, 996.915155, 1003.23012, 1020.034063, 1020.034063, 1020.034063,
  1028.381841, 1028.381841, 1028.381841, 1046.356264, 1036.0023, 1036.0023, 1036.0023, 1040.438057,
  1040.438057, 1040.438057, 1020.27951, 1020.27951, 1006.993189, 987.082447, 987.082447, 998.152064,
  995.355563, 1013.996789, 1013.499492, 1013.499492, 1021.643455, 1021.643455, 1021.643455,
  1011.261145, 1011.261145, 1009.513718, 1009.513718, 1009.513718, 1009.513718, 1009.846409,
  1009.846409, 1001.788702, 1008.804032, 998.798646, 998.798646, 998.798646, 1009.583676,
  1009.583676, 1009.583676, 1009.583676, 990.090059, 1006.883737, 1006.883737, 1012.468974,
  1012.468974, 1012.468974, 993.600125, 993.600125, 979.955305, 990.207918, 990.207918, 990.207918,
];

// Volume Oscillator(5,10) = 100*(SMA(V,5)-SMA(V,10))/SMA(V,10). TA-Lib SMA oracle.
const VO_5_10_REF: (number | null)[] = [
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  1.168147,
  -10.239688,
  -19.190274,
  -10.684479,
  -20.586542,
  -13.994035,
  8.526471,
  20.683427,
  7.436162,
  18.256454,
  15.920496,
  -0.756797,
  0.865927,
  0.828383,
  -18.049962,
  -13.06464,
  -7.0147,
  -11.359364,
  1.011236,
  22.644619,
  18.675022,
  16.013047,
  16.236106,
  9.202838,
  -0.823918,
  -1.578544,
  -2.902182,
  -13.387464,
  -9.160837,
  -22.337844,
  -24.46081,
  -18.052401,
  1.152673,
  -1.180755,
  12.78496,
  21.274201,
  20.004326,
  7.864128,
  0.377888,
  5.988341,
  -2.414776,
  -8.124041,
  -5.369532,
  -3.348804,
  -17.328268,
  -17.391177,
  -22.510232,
  -30.59497,
  -9.278869,
  9.644918,
  10.039263,
];

// Twiggs Money Flow, period 21. First value at index 21.
const TMF21_REF: (number | null)[] = [
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
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  -0.03018,
  -0.032967,
  -0.037586,
  -0.007339,
  0.010859,
  0.036684,
  0.036393,
  0.107094,
  0.120547,
  0.134957,
  0.132352,
  0.130947,
  0.172943,
  0.172007,
  0.146164,
  0.1376,
  0.106494,
  0.107471,
  0.065628,
  0.074171,
  0.051858,
  0.087087,
  0.098481,
  0.129403,
  0.147562,
  0.112863,
  0.132714,
  0.107804,
  0.123803,
  0.107348,
  0.094536,
  0.110531,
  0.094373,
  0.082019,
  0.087734,
  0.058886,
  0.062259,
  0.066924,
  0.101627,
];

// VWAP std-dev bands, single session, mult=2. middle == foundation VWAP.
const VWAP_MID_REF = [
  100.2565, 100.058583, 100.222366, 100.218635, 100.447954, 100.842023, 101.112361, 101.201285,
  101.271342, 101.263323, 101.228173, 101.169349, 101.07724, 100.97692, 100.856489, 100.650666,
  100.461406, 100.370461, 100.153477, 100.065379, 99.918947, 99.628419, 99.547676, 99.447702,
  99.204432, 99.036544, 98.836167, 98.763592, 98.649779, 98.647465, 98.691647, 98.73791, 98.770946,
  98.804387, 98.864464, 98.900052, 98.916988, 98.957136, 98.953112, 98.939764, 98.926422, 98.890792,
  98.840338, 98.831955, 98.839012, 98.893357, 98.972617, 99.04158, 99.116994, 99.203437, 99.28271,
  99.37781, 99.415505, 99.456108, 99.518985, 99.549756, 99.592, 99.715432, 99.809026, 99.870477,
];
const VWAP_UP_REF = [
  100.2565, 100.448167, 100.861985, 100.824759, 101.45418, 102.601767, 103.11464, 103.176466,
  103.17506, 103.11331, 103.080412, 103.037788, 102.909478, 102.934885, 103.031487, 103.087462,
  103.289262, 103.237463, 103.281492, 103.287009, 103.326915, 103.589087, 103.72255, 103.811196,
  104.068109, 104.043278, 103.970451, 103.870553, 103.708174, 103.617831, 103.611537, 103.555092,
  103.542121, 103.478423, 103.529796, 103.555939, 103.54528, 103.531297, 103.505857, 103.451298,
  103.38889, 103.295734, 103.209577, 103.183459, 103.12269, 103.169326, 103.328534, 103.497647,
  103.641479, 103.816359, 103.998414, 104.231589, 104.330842, 104.448986, 104.554106, 104.622732,
  104.710255, 104.972413, 105.15146, 105.28233,
];
const VWAP_LO_REF = [
  100.2565, 99.668999, 99.582747, 99.61251, 99.441728, 99.082279, 99.110083, 99.226103, 99.367624,
  99.413335, 99.375933, 99.30091, 99.245001, 99.018954, 98.68149, 98.21387, 97.633549, 97.503458,
  97.025462, 96.84375, 96.510979, 95.66775, 95.372802, 95.084207, 94.340755, 94.029811, 93.701883,
  93.656632, 93.591383, 93.677099, 93.771756, 93.920728, 93.99977, 94.130351, 94.199132, 94.244165,
  94.288696, 94.382976, 94.400367, 94.42823, 94.463954, 94.48585, 94.4711, 94.48045, 94.555334,
  94.617388, 94.6167, 94.585512, 94.59251, 94.590514, 94.567005, 94.52403, 94.500168, 94.46323,
  94.483864, 94.476779, 94.473746, 94.45845, 94.466593, 94.458625,
];

const SESS = () => "session"; // single shared session for the band/oracle parity

describe("NVI (Negative Volume Index) — golden vs Fosback / StockCharts", () => {
  it("matches the reference within 1e-4 (seed 1000)", () => {
    assertCloseArray(nvi(CL, VL), NVI_REF, 1e-4, "NVI");
  });
  it("no warmup NaN; out[0] = 1000 (seed)", () => {
    expect(nanPrefixLength(nvi(CL, VL))).toBe(0);
    expect(nvi(CL, VL)[0]).toBe(1000);
  });
  it("gotcha: every volume-up bar leaves NVI unchanged", () => {
    // strictly increasing volume -> NVI never updates after the seed
    const c = [10, 11, 12, 13];
    const v = [100, 200, 300, 400];
    const out = nvi(c, v);
    expect(out.every((x) => x === 1000)).toBe(true);
  });
  it("streaming NVI reproduces the batch series exactly", () => {
    const s = createNVI();
    const got = CL.map((c, i) => s.push({ close: c, volume: VL[i]! }));
    assertCloseArray(got, NVI_REF, 1e-4, "stream NVI");
  });
  it("deterministic", () => {
    expectDeterministic(() => nvi(CL, VL));
  });
  it("registry def reproduces nvi()", () => {
    const def = volumeExtIndicators.find((d) => d.id === "nvi")!;
    assertCloseArray(def.compute(BARS, {}) as number[], NVI_REF, 1e-4, "def NVI");
  });
});

describe("PVI (Positive Volume Index) — golden vs Fosback / StockCharts", () => {
  it("matches the reference within 1e-4 (seed 1000)", () => {
    assertCloseArray(pvi(CL, VL), PVI_REF, 1e-4, "PVI");
  });
  it("no warmup NaN; out[0] = 1000 (seed)", () => {
    expect(nanPrefixLength(pvi(CL, VL))).toBe(0);
    expect(pvi(CL, VL)[0]).toBe(1000);
  });
  it("gotcha: every volume-down bar leaves PVI unchanged", () => {
    const c = [10, 11, 12, 13];
    const v = [400, 300, 200, 100];
    const out = pvi(c, v);
    expect(out.every((x) => x === 1000)).toBe(true);
  });
  it("streaming PVI reproduces the batch series exactly", () => {
    const s = createPVI();
    const got = CL.map((c, i) => s.push({ close: c, volume: VL[i]! }));
    assertCloseArray(got, PVI_REF, 1e-4, "stream PVI");
  });
  it("deterministic", () => {
    expectDeterministic(() => pvi(CL, VL));
  });
  it("registry def reproduces pvi()", () => {
    const def = volumeExtIndicators.find((d) => d.id === "pvi")!;
    assertCloseArray(def.compute(BARS, {}) as number[], PVI_REF, 1e-4, "def PVI");
  });
});

describe("Volume Oscillator — golden vs StockCharts (TA-Lib SMA oracle)", () => {
  it("matches the reference within 1e-6 (fast 5, slow 10)", () => {
    assertCloseArray(volumeOscillator(VL, 5, 10), VO_5_10_REF, 1e-6, "VO");
  });
  it("NaN warmup prefix is slow-1 (slow SMA warms last)", () => {
    expect(nanPrefixLength(volumeOscillator(VL, 5, 10))).toBe(9);
  });
  it("gotcha: all-zero volume -> slow SMA 0 -> NaN (no div-by-zero)", () => {
    const zero = new Array(12).fill(0);
    const out = volumeOscillator(zero, 5, 10);
    expect(Number.isNaN(out[9]!)).toBe(true);
    expect(Number.isNaN(out[11]!)).toBe(true);
  });
  it("deterministic", () => {
    expectDeterministic(() => volumeOscillator(VL, 5, 10));
  });
  it("registry def reproduces volumeOscillator()", () => {
    const def = volumeExtIndicators.find((d) => d.id === "volosc")!;
    assertCloseArray(
      def.compute(BARS, { fast: 5, slow: 10 }) as number[],
      VO_5_10_REF,
      1e-6,
      "def VO"
    );
  });
});

describe("Twiggs Money Flow — golden vs Colin Twiggs / IncredibleCharts", () => {
  it("matches the reference within 1e-5 (period 21)", () => {
    assertCloseArray(twiggsMoneyFlow(BARS, 21), TMF21_REF, 1e-5, "TMF21");
  });
  it("NaN warmup prefix is exactly period (ad needs C[i-1], Wilder seed)", () => {
    expect(nanPrefixLength(twiggsMoneyFlow(BARS, 21))).toBe(21);
  });
  it("gotcha: H==L==prevClose bars -> ad 0 -> TMF 0 (no div-by-zero)", () => {
    const flat: OHLCV[] = Array.from({ length: 30 }, (_, i) => ({
      time: i,
      open: 10,
      high: 10,
      low: 10,
      close: 10,
      volume: 1000,
    }));
    const out = twiggsMoneyFlow(flat, 21);
    expect(out[21]).toBe(0);
    expect(out[29]).toBe(0);
  });
  it("deterministic", () => {
    expectDeterministic(() => twiggsMoneyFlow(BARS, 21));
  });
  it("registry def reproduces twiggsMoneyFlow()", () => {
    const def = volumeExtIndicators.find((d) => d.id === "tmf")!;
    assertCloseArray(def.compute(BARS, { period: 21 }) as number[], TMF21_REF, 1e-5, "def TMF");
  });
});

describe("VWAP std-dev bands — golden vs TradingView VWAP Bands", () => {
  it("middle/upper/lower match the single-session reference within 1e-4", () => {
    const r = vwapBands(BARS, 2, SESS);
    assertCloseArray(r.middle, VWAP_MID_REF, 1e-4, "VWAP middle");
    assertCloseArray(r.upper, VWAP_UP_REF, 1e-4, "VWAP upper");
    assertCloseArray(r.lower, VWAP_LO_REF, 1e-4, "VWAP lower");
  });
  it("no warmup NaN within a session (defined from the first traded bar)", () => {
    const r = vwapBands(BARS, 2, SESS);
    expect(nanPrefixLength(r.middle)).toBe(0);
    expect(nanPrefixLength(r.upper)).toBe(0);
    expect(nanPrefixLength(r.lower)).toBe(0);
  });
  it("gotcha: first bar of a session has zero variance -> bands collapse to VWAP", () => {
    // one bar -> volume-weighted variance 0 -> upper==lower==middle==its TP
    const one: OHLCV[] = [{ time: 0, open: 10, high: 12, low: 8, close: 10, volume: 100 }];
    const r = vwapBands(one, 2, SESS);
    expect(r.middle[0]).toBeCloseTo(10, 8); // TP = (12+8+10)/3
    expect(r.upper[0]).toBeCloseTo(10, 8);
    expect(r.lower[0]).toBeCloseTo(10, 8);
  });
  it("gotcha: zero-volume bars -> NaN until volume trades", () => {
    const zv: OHLCV[] = [
      { time: 0, open: 10, high: 12, low: 8, close: 10, volume: 0 },
      { time: 1, open: 10, high: 14, low: 10, close: 12, volume: 100 },
    ];
    const r = vwapBands(zv, 2, SESS);
    expect(Number.isNaN(r.middle[0]!)).toBe(true);
    expect(Number.isNaN(r.middle[1]!)).toBe(false);
  });
  it("streaming bands reproduce the batch series exactly", () => {
    const s = createVwapBands(2, SESS);
    const pts = BARS.map((b) => s.push(b));
    assertCloseArray(
      pts.map((p) => p.middle),
      VWAP_MID_REF,
      1e-4,
      "stream VWAP middle"
    );
    assertCloseArray(
      pts.map((p) => p.upper),
      VWAP_UP_REF,
      1e-4,
      "stream VWAP upper"
    );
    assertCloseArray(
      pts.map((p) => p.lower),
      VWAP_LO_REF,
      1e-4,
      "stream VWAP lower"
    );
  });
  it("deterministic", () => {
    expectDeterministic(() => vwapBands(BARS, 2, SESS).upper);
  });
  it("registry def reproduces vwapBands() (default UTC-day anchor = single session)", () => {
    const def = volumeExtIndicators.find((d) => d.id === "vwap_bands")!;
    // BARS are 60s apart from t=0 -> all within UTC day 0 -> one session.
    const r = def.compute(BARS, { mult: 2 }) as Record<string, number[]>;
    assertCloseArray(r.middle!, VWAP_MID_REF, 1e-4, "def VWAP middle");
    assertCloseArray(r.upper!, VWAP_UP_REF, 1e-4, "def VWAP upper");
    assertCloseArray(r.lower!, VWAP_LO_REF, 1e-4, "def VWAP lower");
  });
});
