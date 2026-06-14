import { describe, expect, it } from "vitest";

import { DEFAULT_MED_VOL } from "../engine/types";
import { CoverageManifest, type CoverageSummary } from "./coverage-loader";

const valid: CoverageSummary = {
  manifestSchemaVersion: 1,
  dataset: "thetrademarkk/india-index-options-1m",
  expectedBarsPerDay: 375,
  strikeStep: { NIFTY: 50, BANKNIFTY: 100, SENSEX: 100 },
  generatedFrom: "market_archive_1m",
  symbols: {
    NIFTY: {
      symbol: "NIFTY",
      strikeStep: 50,
      expiries: 2,
      realContracts: 300,
      emptyContracts: 100,
      presentBars: 100000,
      contractCoverage: 0.75,
      meanBarCoverage: 0.58,
    },
    SENSEX: {
      symbol: "SENSEX",
      strikeStep: 100,
      expiries: 1,
      realContracts: 0,
      emptyContracts: 400,
      presentBars: 0,
      contractCoverage: 0,
      meanBarCoverage: 0,
    },
  },
  expiries: [
    {
      symbol: "NIFTY",
      expiry: "2024-07-25",
      strikeStep: 50,
      realContracts: 207,
      emptyContracts: 0,
      strikesPresent: 110,
      contractCoverage: 1,
      meanBarCoverage: 0.71,
      tradingDays: 8,
      minStrike: 21150,
      maxStrike: 26550,
    },
    {
      symbol: "SENSEX",
      expiry: "2022-09-02",
      strikeStep: 100,
      realContracts: 0,
      emptyContracts: 813,
      strikesPresent: 0,
      contractCoverage: 0,
      meanBarCoverage: 0,
      tradingDays: 0,
      minStrike: null,
      maxStrike: null,
    },
  ],
};

describe("CoverageManifest.from", () => {
  it("parses a valid summary", () => {
    const m = CoverageManifest.from(valid);
    expect(m).not.toBeNull();
    expect(m!.summary.dataset).toBe("thetrademarkk/india-index-options-1m");
  });

  it("returns null on a version mismatch (degrades to absent, never throws)", () => {
    const m = CoverageManifest.from({ ...valid, manifestSchemaVersion: 999 });
    expect(m).toBeNull();
  });

  it("returns null on malformed input rather than throwing", () => {
    expect(CoverageManifest.from(null)).toBeNull();
    expect(CoverageManifest.from({ nope: true })).toBeNull();
    expect(CoverageManifest.from({ ...valid, expiries: "bad" })).toBeNull();
  });
});

describe("lookups (present)", () => {
  const m = CoverageManifest.from(valid)!;

  it("returns the per-symbol rollup", () => {
    expect(m.symbol("NIFTY")?.contractCoverage).toBe(0.75);
  });

  it("returns the per-(symbol,expiry) rollup", () => {
    const e = m.expiry("NIFTY", "2024-07-25");
    expect(e?.strikesPresent).toBe(110);
    expect(e?.meanBarCoverage).toBe(0.71);
  });

  it("surfaces real expiry coverage", () => {
    expect(m.expiryCoverage("NIFTY", "2024-07-25")).toBe(0.71);
  });

  it("hasData true for a captured expiry, false for an all-empty one", () => {
    expect(m.hasData("NIFTY", "2024-07-25")).toBe(true);
    expect(m.hasData("SENSEX", "2022-09-02")).toBe(false);
  });
});

describe("absent => fallback / null (additive: never changes default behaviour)", () => {
  const m = CoverageManifest.from(valid)!;

  it("returns null coverage for an unknown (symbol,expiry)", () => {
    expect(m.expiryCoverage("BANKNIFTY", "2099-01-01")).toBeNull();
    expect(m.expiry("BANKNIFTY", "2099-01-01")).toBeNull();
  });

  it("returns null symbol rollup for an absent symbol", () => {
    expect(m.symbol("BANKNIFTY")).toBeNull();
  });

  it("defaultMedVol => engine DEFAULT for a captured expiry", () => {
    expect(m.defaultMedVol("NIFTY", "2024-07-25")).toBe(DEFAULT_MED_VOL);
  });

  it("defaultMedVol => 0 (illiquid) for an all-empty or unknown expiry", () => {
    expect(m.defaultMedVol("SENSEX", "2022-09-02")).toBe(0);
    expect(m.defaultMedVol("BANKNIFTY", "2099-01-01")).toBe(0);
  });

  it("defaultMedVol honours a caller-supplied fallback for a captured expiry", () => {
    expect(m.defaultMedVol("NIFTY", "2024-07-25", 5000)).toBe(5000);
  });
});
