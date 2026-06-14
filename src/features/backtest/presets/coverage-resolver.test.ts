import { describe, expect, it } from "vitest";
import {
  CoverageManifest,
  type CoverageSummary,
} from "../../../lib/backtest/manifest/coverage-loader";
import { resolveCoverage, resolvePresetCoverage } from "./coverage-resolver";
import { PRESETS } from "./catalogue";

function expiry(symbol: string, exp: string, meanBarCoverage: number) {
  return {
    symbol,
    expiry: exp,
    strikeStep: 50,
    realContracts: 100,
    emptyContracts: 0,
    strikesPresent: 50,
    contractCoverage: 1,
    meanBarCoverage,
    tradingDays: 5,
    minStrike: 20000,
    maxStrike: 25000,
  };
}

const summary: CoverageSummary = {
  manifestSchemaVersion: 1,
  dataset: "test",
  expectedBarsPerDay: 375,
  strikeStep: { NIFTY: 50, BANKNIFTY: 100, SENSEX: 100 },
  symbols: {
    NIFTY: {
      symbol: "NIFTY",
      strikeStep: 50,
      expiries: 3,
      realContracts: 300,
      emptyContracts: 100,
      presentBars: 100000,
      contractCoverage: 0.75,
      meanBarCoverage: 0.58,
    },
    BANKNIFTY: {
      symbol: "BANKNIFTY",
      strikeStep: 100,
      expiries: 0,
      realContracts: 0,
      emptyContracts: 0,
      presentBars: 0,
      contractCoverage: 0,
      meanBarCoverage: 0.42,
    },
  },
  expiries: [
    expiry("NIFTY", "2024-07-25", 0.8), // high
    expiry("NIFTY", "2024-08-01", 0.4), // medium — averages with above
    expiry("SENSEX", "2025-01-03", 0.32), // low
  ],
};

const manifest = CoverageManifest.from(summary)!;

describe("resolveCoverage — averages real expiries, never cherry-picks", () => {
  it("averages the meanBarCoverage over the declared expiries the manifest has", () => {
    const res = resolveCoverage(manifest, "NIFTY", ["2024-07-25", "2024-08-01"]);
    expect(res.fraction).toBeCloseTo(0.6, 5); // (0.8 + 0.4) / 2
    expect(res.matchedExpiries).toBe(2);
    expect(res.totalExpiries).toBe(2);
    expect(res.usedSymbolFallback).toBe(false);
    expect(res.info.bucket).toBe("medium");
  });

  it("ignores declared expiries the manifest does NOT have (counts only matched)", () => {
    const res = resolveCoverage(manifest, "NIFTY", ["2024-07-25", "2099-12-31"]);
    expect(res.fraction).toBeCloseTo(0.8, 5);
    expect(res.matchedExpiries).toBe(1);
    expect(res.totalExpiries).toBe(2);
    expect(res.info.bucket).toBe("high");
  });

  it("surfaces a low SENSEX number exactly (no flattering)", () => {
    const res = resolveCoverage(manifest, "SENSEX", ["2025-01-03"]);
    expect(res.fraction).toBeCloseTo(0.32, 5);
    expect(res.info.bucket).toBe("low");
    expect(res.info.percent).toBe(32);
  });
});

describe("resolveCoverage — fallbacks", () => {
  it("falls back to the per-symbol rollup when no expiry matches", () => {
    const res = resolveCoverage(manifest, "BANKNIFTY", ["2024-12-24"]);
    expect(res.usedSymbolFallback).toBe(true);
    expect(res.fraction).toBeCloseTo(0.42, 5);
    expect(res.matchedExpiries).toBe(0);
  });

  it("absent symbol + absent expiries => honest unknown (null)", () => {
    const res = resolveCoverage(manifest, "SENSEX", ["2099-01-01"]);
    expect(res.fraction).toBeNull();
    expect(res.usedSymbolFallback).toBe(false);
    expect(res.info.bucket).toBe("unknown");
  });

  it("a null manifest => unknown for every query", () => {
    const res = resolveCoverage(null, "NIFTY", ["2024-07-25"]);
    expect(res.fraction).toBeNull();
    expect(res.info.bucket).toBe("unknown");
  });
});

describe("resolvePresetCoverage — every preset resolves without throwing", () => {
  for (const preset of PRESETS) {
    it(`${preset.meta.id}`, () => {
      const res = resolvePresetCoverage(manifest, preset);
      expect(res.totalExpiries).toBe(preset.meta.coverageExpiries.length);
      expect(["high", "medium", "low", "unknown"]).toContain(res.info.bucket);
    });
  }
});
