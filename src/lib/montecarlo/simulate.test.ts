import { describe, expect, it } from "vitest";
import {
  mulberry32,
  hashSeed,
  percentile,
  runSimulation,
  extractRSamples,
  estimateTradesPerYear,
  MIN_TRADES,
  type SimInput,
} from "./simulate";

const baseInput = (over: Partial<SimInput> = {}): SimInput => ({
  rSamples: [1, 1, 1, -1, -1], // 60% win @ +1R, 40% loss @ -1R → +0.2R/trade edge
  trades: 50,
  paths: 2000,
  startEquityR: 100,
  ruinFloorFraction: 0.5,
  seed: 12345,
  ...over,
});

describe("mulberry32 (seeded PRNG)", () => {
  it("is deterministic for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces different streams for different seeds", () => {
    const a = Array.from({ length: 20 }, mulberry32(1));
    const b = Array.from({ length: 20 }, mulberry32(2));
    expect(a).not.toEqual(b);
  });

  it("emits floats in [0, 1)", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("hashSeed", () => {
  it("is stable and deterministic", () => {
    expect(hashSeed("trademarkk")).toBe(hashSeed("trademarkk"));
  });
  it("differs for different strings", () => {
    expect(hashSeed("a")).not.toBe(hashSeed("b"));
  });
  it("returns a non-negative 32-bit integer", () => {
    const h = hashSeed("some-user-id-1234");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("percentile (R7 interpolation)", () => {
  it("returns 0 for an empty array", () => {
    expect(percentile([], 0.5)).toBe(0);
  });
  it("returns the lone value for a singleton", () => {
    expect(percentile([42], 0.95)).toBe(42);
  });
  it("matches the numpy R7 default on a known set", () => {
    const xs = [1, 2, 3, 4, 5];
    expect(percentile(xs, 0)).toBe(1);
    expect(percentile(xs, 0.5)).toBe(3);
    expect(percentile(xs, 1)).toBe(5);
    expect(percentile(xs, 0.25)).toBe(2);
    expect(percentile(xs, 0.75)).toBe(4);
  });
  it("interpolates between ranks", () => {
    expect(percentile([0, 10], 0.5)).toBe(5);
    expect(percentile([0, 10], 0.1)).toBeCloseTo(1, 10);
  });
});

describe("runSimulation — determinism", () => {
  it("is fully reproducible for the same seed", () => {
    const a = runSimulation(baseInput());
    const b = runSimulation(baseInput());
    expect(a).toEqual(b);
  });

  it("differs for different seeds", () => {
    // Continuous samples so coarse percentiles don't coincide by chance.
    const inp = { rSamples: [0.7, -1.1, 1.3, -0.9, 2.1], paths: 2000, trades: 50 };
    const a = runSimulation(baseInput({ ...inp, seed: 1 }));
    const b = runSimulation(baseInput({ ...inp, seed: 2 }));
    // Different RNG streams ⇒ the full cone must differ somewhere.
    expect(a.cone).not.toEqual(b.cone);
  });
});

describe("runSimulation — shape & bounds", () => {
  it("returns a cone of length trades + 1, every band starting at startEquity", () => {
    const r = runSimulation(baseInput({ trades: 30 }));
    expect(r.cone).toHaveLength(31);
    const start = r.cone[0]!;
    expect(start.step).toBe(0);
    expect(start.p5).toBe(100);
    expect(start.p50).toBe(100);
    expect(start.p95).toBe(100);
  });

  it("keeps the percentile bands monotonically ordered at each step", () => {
    const r = runSimulation(baseInput());
    for (const band of r.cone) {
      expect(band.p5).toBeLessThanOrEqual(band.p25);
      expect(band.p25).toBeLessThanOrEqual(band.p50);
      expect(band.p50).toBeLessThanOrEqual(band.p75);
      expect(band.p75).toBeLessThanOrEqual(band.p95);
    }
  });

  it("keeps probabilities in [0, 1]", () => {
    const r = runSimulation(baseInput());
    expect(r.riskOfRuin).toBeGreaterThanOrEqual(0);
    expect(r.riskOfRuin).toBeLessThanOrEqual(1);
    expect(r.probNetPositive).toBeGreaterThanOrEqual(0);
    expect(r.probNetPositive).toBeLessThanOrEqual(1);
  });

  it("reports drawdowns as non-negative with worst ≥ median", () => {
    const r = runSimulation(baseInput());
    expect(r.medianMaxDrawdown).toBeGreaterThanOrEqual(0);
    expect(r.worstMaxDrawdown).toBeGreaterThanOrEqual(r.medianMaxDrawdown);
  });
});

describe("runSimulation — economic sanity", () => {
  it("a positive-edge system finishes net-positive most of the time", () => {
    // +0.2R per trade over 100 trades ⇒ strong positive drift.
    const r = runSimulation(baseInput({ trades: 100, paths: 5000 }));
    expect(r.probNetPositive).toBeGreaterThan(0.8);
    expect(r.finalEquity.p50).toBeGreaterThan(100);
  });

  it("a negative-edge system rarely finishes positive and ruins often", () => {
    // 40% win @ +1R, 60% loss @ -1R ⇒ -0.2R per trade. A shallow floor (90% of
    // start = a 10R drawdown) is breached by almost every losing path.
    const r = runSimulation(
      baseInput({
        rSamples: [1, 1, -1, -1, -1],
        trades: 100,
        paths: 5000,
        ruinFloorFraction: 0.9,
      })
    );
    expect(r.probNetPositive).toBeLessThan(0.2);
    expect(r.finalEquity.p50).toBeLessThan(100);
    // A 10R floor on a -20R-drift system is hit on the vast majority of paths.
    expect(r.riskOfRuin).toBeGreaterThan(0.9);
  });

  it("never ruins when the floor is unreachable (floor at 0 and only wins)", () => {
    const r = runSimulation(baseInput({ rSamples: [1, 2, 3], ruinFloorFraction: 0, trades: 20 }));
    // All-positive samples can never drop equity below the start, let alone to 0.
    expect(r.riskOfRuin).toBe(0);
    expect(r.probNetPositive).toBe(1);
    expect(r.medianMaxDrawdown).toBe(0);
  });

  it("a floor at 100% of start ruins on the first losing trade", () => {
    // ruinFloorFraction 1 ⇒ floor == start; any net loss at any step breaches.
    const r = runSimulation(
      baseInput({ rSamples: [-1, -1, -1, -1], ruinFloorFraction: 1, trades: 10 })
    );
    expect(r.riskOfRuin).toBe(1);
  });
});

describe("runSimulation — bootstrap distribution sampling", () => {
  it("preserves the source mean in the median final-equity drift (large n)", () => {
    // Mean R of samples = 0.2. Over 100 trades that's +20R expected drift.
    const r = runSimulation(baseInput({ trades: 100, paths: 20000 }));
    const drift = r.finalEquity.p50 - 100;
    // p50 of a near-symmetric sum sits close to the mean*trades.
    expect(drift).toBeGreaterThan(12);
    expect(drift).toBeLessThan(28);
  });

  it("draws across the full sample range (with replacement)", () => {
    // One trade per path so each path's final equity IS a single bootstrap draw.
    const r = runSimulation({
      rSamples: [10, 20, 30, 40],
      trades: 1,
      paths: 4000,
      startEquityR: 0,
      ruinFloorFraction: 0,
      seed: 99,
    });
    // With 4000 draws of 4 values the extremes must both surface.
    expect(r.finalEquity.p5).toBe(10);
    expect(r.finalEquity.p95).toBe(40);
    // Mean of the four equal-probability values is 25 ⇒ median near it.
    expect(r.finalEquity.p50).toBeGreaterThanOrEqual(20);
    expect(r.finalEquity.p50).toBeLessThanOrEqual(30);
  });

  it("clamps trades and paths to at least 1", () => {
    const r = runSimulation(baseInput({ trades: 0, paths: 0 }));
    expect(r.meta.trades).toBe(1);
    expect(r.meta.paths).toBe(1);
    expect(r.cone).toHaveLength(2);
  });
});

describe("extractRSamples", () => {
  const t = (r: number | null, status = "closed") => ({ r_multiple: r, status });
  it("keeps only finite, non-null R of closed trades", () => {
    const trades = [
      t(1.5),
      t(-1),
      t(null),
      t(2, "open"),
      { r_multiple: Infinity, status: "closed" },
      { r_multiple: NaN, status: "closed" },
    ];
    expect(extractRSamples(trades)).toEqual([1.5, -1]);
  });
  it("returns an empty array when nothing qualifies", () => {
    expect(extractRSamples([t(null), t(1, "open")])).toEqual([]);
  });
});

describe("estimateTradesPerYear", () => {
  const closed = (opened: string) => ({ r_multiple: 1, status: "closed", opened_at: opened });

  it("annualises from the open-time span", () => {
    // 50 trades evenly across ~half a year ⇒ ~100/year.
    const trades = Array.from({ length: 50 }, (_, i) => {
      const d = new Date(2026, 0, 1);
      d.setDate(d.getDate() + i * 3); // every 3 days ⇒ 150 days span for 50 trades
      return closed(d.toISOString());
    });
    const est = estimateTradesPerYear(trades);
    expect(est).toBeGreaterThan(80);
    expect(est).toBeLessThan(140);
  });

  it("falls back to the sample count for a tiny span", () => {
    const trades = [
      closed("2026-01-01T09:00:00Z"),
      closed("2026-01-01T10:00:00Z"),
      closed("2026-01-01T11:00:00Z"),
    ];
    expect(estimateTradesPerYear(trades)).toBe(Math.max(MIN_TRADES, 3));
  });

  it("returns at least MIN_TRADES", () => {
    expect(estimateTradesPerYear([])).toBeGreaterThanOrEqual(0);
    expect(estimateTradesPerYear([closed("2026-01-01T09:00:00Z")])).toBe(MIN_TRADES);
  });
});
