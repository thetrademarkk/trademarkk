/**
 * deflated-sharpe.ts — the overfitting coach. Verifies:
 *  - the normal CDF / inverse-CDF helpers against known values;
 *  - the PSR formula against a hand-computed worked example (skew=0, kurt=3);
 *  - DSR deflates the benchmark upward as `trials` grows (PSR ≥ DSR);
 *  - the small-sample honest "insufficient" path;
 *  - the caution copy is DESCRIPTIVE — never a recommendation;
 *  - determinism (closed-form: same input ⇒ identical output).
 */

import { describe, expect, it } from "vitest";
import {
  deflatedSharpe,
  expectedMaxStandardNormal,
  MIN_SAMPLE,
  normalCdf,
  normalInv,
  psrAgainst,
} from "./deflated-sharpe";

describe("normal helpers", () => {
  it("normalCdf matches known points", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.6448536)).toBeCloseTo(0.95, 4); // 95th percentile z
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 4);
    expect(normalCdf(-1.959964)).toBeCloseTo(0.025, 4);
  });

  it("normalInv inverts normalCdf at standard quantiles", () => {
    expect(normalInv(0.975)).toBeCloseTo(1.959964, 3);
    expect(normalInv(0.5)).toBeCloseTo(0, 4);
    expect(normalInv(0.95)).toBeCloseTo(1.644854, 3);
  });

  it("expectedMaxStandardNormal grows with trials and is 0 at trials=1", () => {
    expect(expectedMaxStandardNormal(1)).toBe(0);
    const e10 = expectedMaxStandardNormal(10);
    const e100 = expectedMaxStandardNormal(100);
    // Known approximate values: E[max] of 10 ~1.54, of 100 ~2.5.
    expect(e10).toBeGreaterThan(1.3);
    expect(e10).toBeLessThan(1.8);
    expect(e100).toBeGreaterThan(e10);
  });
});

describe("psrAgainst — hand-computed worked example", () => {
  it("normal series (skew 0, kurt 3): PSR = Φ(SR·√(n−1))", () => {
    // Worked example: per-period Sharpe sr=0.2, n=50, skew=0, kurt=3, bench=0.
    // denom = √(1 − 0·0.2 + (3−1)/4·0.2²) = √(1 + 0.5·0.04) = √1.02 = 1.009950.
    // z = 0.2·√49 / 1.009950 = 0.2·7 / 1.009950 = 1.4 / 1.009950 = 1.386208.
    // PSR = Φ(1.386208) ≈ 0.91722.
    const sr = 0.2;
    const n = 50;
    const z = (sr * Math.sqrt(n - 1)) / Math.sqrt(1 + 0.5 * sr * sr);
    const expected = normalCdf(z);
    const got = psrAgainst(sr, 0, n, 0, 3);
    expect(got).toBeCloseTo(expected, 9);
    expect(got).toBeCloseTo(0.917158, 5);
  });

  it("PSR rises with a higher observed Sharpe and falls vs a higher benchmark", () => {
    const a = psrAgainst(0.1, 0, 60, 0, 3);
    const b = psrAgainst(0.3, 0, 60, 0, 3);
    expect(b).toBeGreaterThan(a);
    const benchHigher = psrAgainst(0.3, 0.2, 60, 0, 3);
    expect(benchHigher).toBeLessThan(b);
  });

  it("negative skew and fat tails reduce PSR (non-normality penalty)", () => {
    const normal = psrAgainst(0.2, 0, 60, 0, 3);
    const fatTailed = psrAgainst(0.2, 0, 60, -0.8, 8);
    expect(fatTailed).toBeLessThan(normal);
  });
});

describe("deflatedSharpe — end to end", () => {
  // A deterministic positive-drift series of 60 trade-days.
  const series = Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? -100 : 180));

  it("DSR ≤ PSR and the gap widens as trials grow", () => {
    const t1 = deflatedSharpe({ dailyNets: series, annualizedSharpe: 2, trials: 1 });
    const t50 = deflatedSharpe({ dailyNets: series, annualizedSharpe: 2, trials: 50 });
    expect(t1.dsr!).toBeLessThanOrEqual(t1.psr! + 1e-9);
    // With more trials the deflated benchmark is higher → DSR is lower.
    expect(t50.dsr!).toBeLessThan(t1.dsr!);
    expect(t50.deflatedBenchmark).toBeGreaterThan(t1.deflatedBenchmark);
  });

  it("trials=1 (or omitted) → deflatedBenchmark 0 → DSR equals PSR", () => {
    const r = deflatedSharpe({ dailyNets: series, annualizedSharpe: 2 });
    expect(r.deflatedBenchmark).toBe(0);
    expect(r.dsr).toBeCloseTo(r.psr!, 9);
    expect(r.trialsKnown).toBe(false);
  });

  it("small sample → honest insufficient state (null psr/dsr)", () => {
    const r = deflatedSharpe({ dailyNets: [100, -50, 80], annualizedSharpe: 1 });
    expect(r.sampleSize).toBeLessThan(MIN_SAMPLE);
    expect(r.psr).toBeNull();
    expect(r.dsr).toBeNull();
    expect(r.caution).toBe("insufficient");
    expect(r.message).toMatch(/too few trade-days/i);
  });

  it("caution copy is DESCRIPTIVE — never a recommendation", () => {
    const cautions = [1, 5, 100].map((trials) =>
      deflatedSharpe({ dailyNets: series, annualizedSharpe: 2, trials })
    );
    const banned =
      /\bbuy\b|\bsell\b|recommend|good strategy|profitable strategy|trade this|you should/i;
    for (const c of cautions) {
      expect(c.message).not.toMatch(banned);
      // It cites the concept descriptively.
      expect(c.message.toLowerCase()).toContain("deflated sharpe");
    }
    // Elevated caution explicitly frames it as educational.
    const elevated = cautions[2]!;
    expect(elevated.caution).toBe("elevated");
    expect(elevated.message).toMatch(/educational caution/i);
  });

  it("deterministic — same input yields byte-identical output", () => {
    const a = deflatedSharpe({ dailyNets: series, annualizedSharpe: 2, trials: 10 });
    const b = deflatedSharpe({ dailyNets: series, annualizedSharpe: 2, trials: 10 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("reports skew and kurtosis of the series", () => {
    const r = deflatedSharpe({ dailyNets: series, annualizedSharpe: 2, trials: 1 });
    expect(Number.isFinite(r.skew)).toBe(true);
    expect(Number.isFinite(r.kurtosis)).toBe(true);
    // A symmetric two-value series like this has bounded kurtosis.
    expect(r.kurtosis).toBeGreaterThan(1);
  });
});
