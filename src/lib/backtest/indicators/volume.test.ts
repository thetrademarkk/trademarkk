/**
 * Golden tests — volume indicators (OBV, AD/ADL, CMF, VWAP, PVT, EOM, Force
 * Index).
 *
 * Fixture: a single deterministic 60-bar OHLCV series (LCG-generated, realistic
 * H>=max(O,C), L<=min(O,C)). The SAME series and parameters were fed to the
 * declared reference oracle to produce each expected vector below — no expected
 * value is invented.
 *
 * Declared references (golden, per indicator):
 *  - OBV  : TA-Lib 0.6.8 OBV (offline pandas oracle). out[0]=volume[0].
 *  - ADL  : TA-Lib 0.6.8 AD (Chaikin Accumulation/Distribution Line).
 *  - CMF  : StockCharts / TradingView Pine ta.cmf, period 20 (hand oracle).
 *  - VWAP : TradingView Pine ta.vwap, single session = cumsum(TP*V)/cumsum(V).
 *  - PVT  : StockCharts Price Volume Trend, seed 0.
 *  - EOM  : StockCharts Ease of Movement, scale 1e8, 14-period SMA of EMV1.
 *  - FI   : Elder / StockCharts Force Index, FI(13) = EMA(13) of (C-Cprev)*V.
 *
 * OBV/PVT/ADL/VWAP are exact-ish cumulative sums (eps 1e-4..1e-6); the recursive
 * Force Index EMA is asserted at 1e-3 on the floating reference.
 */

import { describe, expect, it } from "vitest";
import {
  adl,
  cmf,
  createADL,
  createOBV,
  createPVT,
  createVWAP,
  eom,
  forceIndex,
  obv,
  pvt,
  volumeIndicators,
  vwap,
} from "./volume";
import type { OHLCV } from "./types";
import { assertCloseArray, expectDeterministic, nanPrefixLength } from "./test-helpers";

// ---- Deterministic 60-bar fixture (mirrors the offline oracle generator) ----
const OPENS = [
  100.0, 100.3292, 100.0197, 100.4691, 100.7182, 101.3562, 103.0539, 102.6814, 101.2363, 102.0648,
  100.9397, 99.2828, 101.0181, 100.0185, 99.0652, 98.3976, 98.8189, 97.2295, 98.921, 97.0044,
  98.0016, 96.7254, 94.8129, 93.2901, 94.3363, 94.072, 95.8338, 95.7868, 96.7085, 97.4856, 99.1386,
  100.7935, 99.7692, 100.1176, 99.9446, 101.2325, 100.5234, 99.8313, 99.8642, 98.7199, 97.9322,
  98.618, 97.6399, 97.85, 98.4997, 99.5633, 101.4329, 101.9662, 103.8399, 101.8349, 103.5622,
  103.2981, 103.8711, 105.7844, 104.6711, 102.7204, 104.597, 103.1606, 104.2399, 103.9981,
];
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

const BARS: OHLCV[] = OPENS.map((_, i) => ({
  time: i * 60_000,
  open: OPENS[i]!,
  high: HIGHS[i]!,
  low: LOWS[i]!,
  close: CLOSES[i]!,
  volume: VOLS[i]!,
}));

// ---- Declared reference vectors (from the offline oracle over BARS) ----

// TA-Lib 0.6.8 OBV(close, volume). obv[0] = volume[0].
const OBV_REF = [
  4885, -158, 3422, 4976, 9331, 14576, 9556, 6301, 10424, 8191, 6719, 9029, 3489, 557, -2185, 3396,
  -187, 3172, -2521, -62, -3786, -9285, -10411, -8670, -12477, -8299, -13951, -10450, -4521, -583,
  2983, -2985, 320, -5593, -1868, -4269, -6419, -1713, -3135, -6098, -2545, -7803, -2545, -950,
  4401, 9132, 13155, 16049, 12048, 16423, 12858, 16845, 18306, 16897, 13228, 14630, 12568, 18462,
  13533, 16482,
];

// TA-Lib 0.6.8 AD (Chaikin A/D Line). Cumulative, no warmup.
const ADL_REF = [
  462.361021, 2370.916943, 1380.873399, 2335.598166, 3232.460198, 7462.57676, 9726.682588,
  7952.946108, 8656.427717, 8359.331958, 7297.885718, 8798.497365, 5060.915799, 4307.33131,
  3220.015338, 4420.187468, 4190.165534, 5211.455691, 1937.772442, 3193.100133, 2525.715323,
  -1930.993509, -2178.581901, -2581.216186, -456.084231, 888.986993, 2955.68921, 3061.594076,
  8911.742925, 10407.520925, 11984.480451, 12576.883708, 12900.19682, 17170.060555, 17736.596032,
  16044.81276, 15676.305638, 13815.900982, 14043.68847, 11121.416992, 12015.146418, 10644.795046,
  13749.633025, 14779.023773, 17773.254247, 19851.2486, 17637.73181, 19551.274159, 18086.113563,
  19848.778895, 18966.909166, 18362.602489, 19751.496731, 18681.052763, 18089.228494, 18625.497127,
  16721.423771, 17320.547076, 17982.41232, 20797.236816,
];

// StockCharts / Pine ta.cmf, period 20. First value at index 19.
const CMF20_REF: (number | null)[] = [
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
  0.042595,
  0.027958,
  -0.057931,
  -0.049571,
  -0.068297,
  -0.051628,
  -0.093405,
  -0.095354,
  -0.068646,
  0.003495,
  0.027395,
  0.060976,
  0.046926,
  0.10014,
  0.158283,
  0.1765,
  0.147022,
  0.147952,
  0.108943,
  0.162039,
  0.10541,
  0.126453,
  0.168121,
  0.201792,
  0.220341,
  0.226925,
  0.234435,
  0.185248,
  0.209662,
  0.119581,
  0.122363,
  0.090496,
  0.076962,
  0.093429,
  0.021953,
  0.005128,
  0.038078,
  0.015441,
  0.050886,
  0.054417,
  0.133707,
];

// Pine ta.vwap, single session = cumsum(TP*V)/cumsum(V), TP=(H+L+C)/3.
const VWAP_REF = [
  100.2565, 100.058583, 100.222366, 100.218635, 100.447954, 100.842023, 101.112361, 101.201285,
  101.271342, 101.263323, 101.228173, 101.169349, 101.07724, 100.97692, 100.856489, 100.650666,
  100.461406, 100.370461, 100.153477, 100.065379, 99.918947, 99.628419, 99.547676, 99.447702,
  99.204432, 99.036544, 98.836167, 98.763592, 98.649779, 98.647465, 98.691647, 98.73791, 98.770946,
  98.804387, 98.864464, 98.900052, 98.916988, 98.957136, 98.953112, 98.939764, 98.926422, 98.890792,
  98.840338, 98.831955, 98.839012, 98.893357, 98.972617, 99.04158, 99.116994, 99.203437, 99.28271,
  99.37781, 99.415505, 99.456108, 99.518985, 99.549756, 99.592, 99.715432, 99.809026, 99.870477,
];

// StockCharts PVT, seed 0.
const PVT_REF = [
  0.0, -15.556872, 0.528479, 4.381419, 31.968191, 119.821095, 101.675736, 55.866071, 89.607975,
  64.992748, 40.830235, 81.205234, 26.385514, -1.560072, -20.0384, 3.857257, -53.771599, 4.664868,
  -105.637331, -80.358943, -128.853751, -237.58256, -255.667365, -236.142955, -246.808945,
  -168.562491, -171.334415, -137.646353, -90.003944, -23.229836, 36.296659, -24.352315, -12.811058,
  -23.028532, 24.972335, 8.154129, -6.648544, -5.097654, -21.391727, -45.033922, -20.152959,
  -72.302159, -60.988077, -50.397669, 7.382442, 96.221177, 117.372755, 170.552022, 93.298433,
  167.50617, 158.414856, 180.530955, 207.442495, 192.613847, 124.236632, 149.849784, 121.532941,
  183.1979, 171.764349, 211.443302,
];

// StockCharts EOM, scale 1e8, 14-period SMA of single-period EMV. First at index 14.
const EOM14_REF: (number | null)[] = [
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
  -41937.249334,
  -41584.997706,
  -53987.439944,
  -37043.45395,
  -42924.332568,
  -52197.119864,
  -53941.256236,
  -58787.217551,
  -95529.960803,
  -77127.870746,
  -73674.831192,
  -47281.383589,
  -48456.916644,
  -31909.275946,
  -30348.974954,
  -13456.014512,
  8123.70568,
  713.262521,
  5778.975182,
  10868.762603,
  25243.06339,
  30508.081,
  61426.883307,
  50448.805704,
  24418.111993,
  12020.803383,
  10225.963964,
  488.924342,
  -1548.24435,
  -10803.975325,
  -20439.441205,
  -9253.031325,
  -2301.768183,
  1338.672911,
  -13758.252947,
  -17896.728997,
  -912.379109,
  801.009101,
  28783.943442,
  46342.014889,
  25549.148306,
  41250.258301,
  47411.377005,
  39348.160394,
  34694.616189,
  25273.225447,
];

// Elder / StockCharts Force Index FI(13) = EMA(13) of (C-Cprev)*V. First at index 13.
const FI13_REF: (number | null)[] = [
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
  -24.2612,
  -282.3038,
  93.9218,
  -733.0413,
  183.3572,
  -1401.5801,
  -851.0522,
  -1408.4117,
  -2709.6154,
  -2567.4808,
  -1940.4929,
  -1807.0211,
  -497.3323,
  -464.234,
  63.0668,
  712.261,
  1540.44,
  2163.4305,
  981.0801,
  1005.4203,
  715.6533,
  1298.7639,
  870.0049,
  533.1449,
  479.0996,
  178.2004,
  -180.679,
  193.2248,
  -569.0716,
  -329.9605,
  -134.7845,
  697.5166,
  1861.4539,
  1902.0271,
  2404.95,
  915.385,
  1864.1782,
  1463.3647,
  1580.677,
  1754.1991,
  1279.5078,
  74.2755,
  439.5209,
  -46.3902,
  869.0076,
  574.6019,
  1082.021,
];

const CL = CLOSES;
const VL = VOLS;

describe("OBV — golden vs TA-Lib 0.6.8", () => {
  it("matches the reference exactly (integer domain)", () => {
    assertCloseArray(obv(CL, VL), OBV_REF, 1e-6, "OBV");
  });
  it("no warmup NaN (cumulative from bar 0); out[0]=volume[0]", () => {
    expect(nanPrefixLength(obv(CL, VL))).toBe(0);
    expect(obv(CL, VL)[0]).toBe(VL[0]);
  });
  it("gotcha: a flat-close series leaves OBV unchanged after the seed", () => {
    const flat = new Array(10).fill(50);
    const v = new Array(10).fill(100);
    const out = obv(flat, v);
    expect(out[0]).toBe(100);
    expect(out[9]).toBe(100);
  });
  it("streaming OBV reproduces the batch series exactly", () => {
    const s = createOBV();
    const got = CL.map((c, i) => s.push({ close: c, volume: VL[i]! }));
    assertCloseArray(got, OBV_REF, 1e-6, "stream OBV");
  });
  it("deterministic", () => {
    expectDeterministic(() => obv(CL, VL));
  });
  it("registry def reproduces obv()", () => {
    const def = volumeIndicators.find((d) => d.id === "obv")!;
    assertCloseArray(def.compute(BARS, {}) as number[], OBV_REF, 1e-6, "def OBV");
  });
});

describe("ADL (Accumulation/Distribution) — golden vs TA-Lib 0.6.8 AD", () => {
  it("matches the reference within 1e-4", () => {
    assertCloseArray(adl(BARS), ADL_REF, 1e-4, "ADL");
  });
  it("no warmup NaN (cumulative from bar 0)", () => {
    expect(nanPrefixLength(adl(BARS))).toBe(0);
  });
  it("gotcha: H==L -> money-flow multiplier 0 -> ADL unchanged that bar", () => {
    const flat: OHLCV[] = [
      { time: 0, open: 10, high: 10, low: 10, close: 10, volume: 1000 },
      { time: 1, open: 10, high: 10, low: 10, close: 10, volume: 2000 },
    ];
    const out = adl(flat);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
  });
  it("streaming ADL reproduces the batch series exactly", () => {
    const s = createADL();
    assertCloseArray(
      BARS.map((b) => s.push(b)),
      ADL_REF,
      1e-4,
      "stream ADL"
    );
  });
  it("deterministic", () => {
    expectDeterministic(() => adl(BARS));
  });
  it("registry def reproduces adl()", () => {
    const def = volumeIndicators.find((d) => d.id === "adl")!;
    assertCloseArray(def.compute(BARS, {}) as number[], ADL_REF, 1e-4, "def ADL");
  });
});

describe("CMF (Chaikin Money Flow) — golden vs StockCharts / Pine ta.cmf", () => {
  it("matches the reference within 1e-5 (period 20)", () => {
    assertCloseArray(cmf(BARS, 20), CMF20_REF, 1e-5, "CMF20");
  });
  it("NaN warmup prefix is period-1 (first value at index period-1)", () => {
    expect(nanPrefixLength(cmf(BARS, 20))).toBe(19);
  });
  it("gotcha: all-zero volume window -> CMF 0 (no div-by-zero)", () => {
    const zeroVol: OHLCV[] = BARS.slice(0, 25).map((b) => ({ ...b, volume: 0 }));
    const out = cmf(zeroVol, 20);
    expect(out[19]).toBe(0);
    expect(out[24]).toBe(0);
  });
  it("deterministic", () => {
    expectDeterministic(() => cmf(BARS, 20));
  });
  it("registry def reproduces cmf()", () => {
    const def = volumeIndicators.find((d) => d.id === "cmf")!;
    assertCloseArray(def.compute(BARS, { period: 20 }) as number[], CMF20_REF, 1e-5, "def CMF");
  });
});

describe("VWAP (session-anchored) — golden vs Pine ta.vwap (single session)", () => {
  it("matches the cumulative single-session reference within 1e-4", () => {
    // All bars share one session here, so VWAP = cumsum(TP*V)/cumsum(V).
    assertCloseArray(
      vwap(BARS, () => "session"),
      VWAP_REF,
      1e-4,
      "VWAP"
    );
  });
  it("no warmup NaN within a session (defined from the first traded bar)", () => {
    expect(nanPrefixLength(vwap(BARS, () => "session"))).toBe(0);
  });
  it("gotcha: resets at a new session key (first bar of a session == its TP)", () => {
    const twoSessions: OHLCV[] = [
      { time: 0, open: 10, high: 12, low: 8, close: 10, volume: 100 },
      { time: 1, open: 10, high: 14, low: 10, close: 12, volume: 100 },
      // new session: VWAP must reset to this bar's typical price
      { time: 2, open: 20, high: 22, low: 18, close: 20, volume: 50 },
    ];
    const out = vwap(twoSessions, (b) => (b.time < 2 ? "a" : "b"));
    expect(out[0]).toBeCloseTo(10, 8); // TP = (12+8+10)/3
    expect(out[2]).toBeCloseTo(20, 8); // reset: TP = (22+18+20)/3
  });
  it("streaming VWAP reproduces the batch series exactly", () => {
    const s = createVWAP(() => "session");
    assertCloseArray(
      BARS.map((b) => s.push(b)),
      VWAP_REF,
      1e-4,
      "stream VWAP"
    );
  });
  it("deterministic", () => {
    expectDeterministic(() => vwap(BARS, () => "session"));
  });
  it("registry def computes VWAP (default UTC-day anchor)", () => {
    const def = volumeIndicators.find((d) => d.id === "vwap")!;
    // BARS are 60s apart starting at 0 -> all within UTC day 0 -> single session.
    assertCloseArray(def.compute(BARS, {}) as number[], VWAP_REF, 1e-4, "def VWAP");
  });
});

describe("PVT (Price Volume Trend) — golden vs StockCharts", () => {
  it("matches the reference within 1e-4 (seed 0)", () => {
    assertCloseArray(pvt(CL, VL), PVT_REF, 1e-4, "PVT");
  });
  it("no warmup NaN; out[0]=0 (seed)", () => {
    expect(nanPrefixLength(pvt(CL, VL))).toBe(0);
    expect(pvt(CL, VL)[0]).toBe(0);
  });
  it("gotcha: a flat-close series leaves PVT at 0", () => {
    const flat = new Array(10).fill(50);
    const v = new Array(10).fill(100);
    const out = pvt(flat, v);
    expect(out[9]).toBe(0);
  });
  it("streaming PVT reproduces the batch series exactly", () => {
    const s = createPVT();
    const got = CL.map((c, i) => s.push({ close: c, volume: VL[i]! }));
    assertCloseArray(got, PVT_REF, 1e-4, "stream PVT");
  });
  it("deterministic", () => {
    expectDeterministic(() => pvt(CL, VL));
  });
  it("registry def reproduces pvt()", () => {
    const def = volumeIndicators.find((d) => d.id === "pvt")!;
    assertCloseArray(def.compute(BARS, {}) as number[], PVT_REF, 1e-4, "def PVT");
  });
});

describe("EOM (Ease of Movement) — golden vs StockCharts (scale 1e8, SMA 14)", () => {
  it("matches the reference within 1e-3", () => {
    assertCloseArray(eom(BARS, 14), EOM14_REF, 1e-3, "EOM14");
  });
  it("NaN warmup prefix is exactly period (first value at index period)", () => {
    expect(nanPrefixLength(eom(BARS, 14))).toBe(14);
  });
  it("gotcha: H==L bars -> EMV 0 (no div-by-zero)", () => {
    const flat: OHLCV[] = Array.from({ length: 20 }, (_, i) => ({
      time: i,
      open: 10,
      high: 10,
      low: 10,
      close: 10,
      volume: 1000,
    }));
    const out = eom(flat, 14);
    expect(out[14]).toBe(0);
    expect(out[19]).toBe(0);
  });
  it("deterministic", () => {
    expectDeterministic(() => eom(BARS, 14));
  });
  it("registry def reproduces eom()", () => {
    const def = volumeIndicators.find((d) => d.id === "eom")!;
    assertCloseArray(def.compute(BARS, { period: 14 }) as number[], EOM14_REF, 1e-3, "def EOM");
  });
});

describe("Force Index — golden vs Elder / StockCharts (EMA 13)", () => {
  it("matches the reference within 1e-3 (converged tail check too)", () => {
    assertCloseArray(forceIndex(CL, VL, 13), FI13_REF, 1e-3, "FI13");
  });
  it("NaN warmup prefix is exactly period (raw force from index 1, EMA seed)", () => {
    expect(nanPrefixLength(forceIndex(CL, VL, 13))).toBe(13);
  });
  it("gotcha: a flat-close series -> raw force 0 -> Force Index 0", () => {
    const flat = new Array(20).fill(50);
    const v = new Array(20).fill(100);
    const out = forceIndex(flat, v, 13);
    expect(out[13]).toBe(0);
    expect(out[19]).toBe(0);
  });
  it("deterministic", () => {
    expectDeterministic(() => forceIndex(CL, VL, 13));
  });
  it("registry def reproduces forceIndex()", () => {
    const def = volumeIndicators.find((d) => d.id === "forceindex")!;
    assertCloseArray(def.compute(BARS, { period: 13 }) as number[], FI13_REF, 1e-3, "def FI");
  });
});
