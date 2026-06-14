import { describe, expect, it } from "vitest";
import { makeDefaultStrategy } from "./strategy-def";
import {
  RUN_RESULT_VERSION,
  deriveQualityChips,
  parseRunResult,
  safeParseRunResult,
  type CoverageReport,
  type RunResult,
} from "./run-result";

function makeRunResult(): RunResult {
  const config = makeDefaultStrategy("s1", "NIFTY");
  return {
    resultVersion: RUN_RESULT_VERSION,
    runId: "run-1",
    config,
    engineVersion: "1.0.0",
    dataSnapshotId: "snap-2026-06",
    ranAt: 1_700_000_000_000,
    coverage: {
      overall: 0.82,
      byLeg: { "s1-leg1": 0.82 },
      substitutions: 1,
      illiquidDays: 0,
      excludedDays: 0,
      filledBarFraction: 0.91,
    },
    stats: {
      netPnl: 12500,
      winRate: 0.61,
      maxDrawdown: -8800,
      expectancy: 420,
      profitFactor: 1.8,
      sharpe: 1.1,
    },
    qualityChips: [{ kind: "coverage", level: "good", label: "82% data coverage" }],
    equityCurve: [
      { ts: 1_700_000_000_000, equity: 0 },
      { ts: 1_700_086_400_000, equity: 12500 },
    ],
    monthlyReturns: [{ month: "2024-01", pnl: 12500 }],
    tradeReturns: [{ day: "2024-01-04", net: 12500 }],
    blotter: [
      {
        day: "2024-01-04",
        entryTs: 1_700_000_000_000,
        exitTs: 1_700_020_000_000,
        legs: [
          {
            legId: "s1-leg1",
            optionType: "PE",
            side: "sell",
            qty: 75,
            resolution: {
              requested: 21500,
              served: 21500,
              coverage: 0.82,
              confidence: "high",
              fallbackSteps: 0,
            },
            entryPrice: 120,
            exitPrice: 80,
            gross: 3000,
            charges: 60,
            net: 2940,
            reentries: 0,
          },
        ],
        gross: 3000,
        charges: 60,
        net: 2940,
        substituted: false,
        flags: [],
      },
    ],
    perLeg: [
      {
        legId: "s1-leg1",
        optionType: "PE",
        side: "sell",
        net: 12500,
        trades: 20,
        meanCoverage: 0.82,
      },
    ],
    flags: [],
  };
}

describe("RunResult zod round-trip", () => {
  it("parses a complete, self-contained snapshot", () => {
    const r = makeRunResult();
    const parsed = parseRunResult(r);
    expect(parsed.engineVersion).toBe("1.0.0");
    expect(parsed.dataSnapshotId).toBe("snap-2026-06");
    // JSON round-trip is stable (determinism / save-share contract).
    expect(parseRunResult(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it("embeds the producing StrategyDef so it re-validates", () => {
    const parsed = parseRunResult(makeRunResult());
    expect(parsed.config.schemaVersion).toBe(1);
    expect(parsed.config.legs).toHaveLength(1);
  });

  it("rejects coverage outside [0,1]", () => {
    const bad = makeRunResult();
    bad.coverage.overall = 1.5;
    expect(safeParseRunResult(bad).success).toBe(false);
  });

  it("rejects an unknown result flag", () => {
    const bad = makeRunResult() as unknown as Record<string, unknown>;
    (bad.flags as unknown[]) = ["NOT_A_FLAG"];
    expect(safeParseRunResult(bad).success).toBe(false);
  });

  it("requires engineVersion + dataSnapshotId (determinism stamps)", () => {
    const bad = makeRunResult() as unknown as Record<string, unknown>;
    bad.dataSnapshotId = "";
    expect(safeParseRunResult(bad).success).toBe(false);
  });

  it("rejects an over-cap per-day array (storage-exhaustion guard)", () => {
    const bad = makeRunResult();
    const point = bad.equityCurve[0]!;
    // One element past MAX_RUN_DAYS (1500) must fail the .max() bound.
    bad.equityCurve = Array.from({ length: 1501 }, () => ({ ...point }));
    expect(safeParseRunResult(bad).success).toBe(false);
  });

  it("rejects an over-length free-text chip label", () => {
    const bad = makeRunResult();
    bad.qualityChips = [{ kind: "coverage", level: "good", label: "x".repeat(121) }];
    expect(safeParseRunResult(bad).success).toBe(false);
  });
});

describe("deriveQualityChips", () => {
  const base: CoverageReport = {
    overall: 0.85,
    byLeg: {},
    substitutions: 0,
    illiquidDays: 0,
    excludedDays: 0,
    filledBarFraction: 0.9,
  };

  it("emits a single good coverage chip on a clean run", () => {
    const chips = deriveQualityChips(base, 50);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ kind: "coverage", level: "good" });
  });

  it("marks coverage warning (40-69%) and bad (<40%)", () => {
    expect(deriveQualityChips({ ...base, overall: 0.55 }, 50)[0]!.level).toBe("warning");
    expect(deriveQualityChips({ ...base, overall: 0.3 }, 50)[0]!.level).toBe("bad");
  });

  it("adds substitution / liquidity / excluded chips when present", () => {
    const chips = deriveQualityChips(
      { ...base, substitutions: 3, illiquidDays: 2, excludedDays: 1 },
      50
    );
    const kinds = chips.map((c) => c.kind);
    expect(kinds).toContain("substitution");
    expect(kinds).toContain("liquidity");
    expect(kinds).toContain("excluded");
  });

  it("flags a small sample (<30 warning, <10 bad)", () => {
    const small = deriveQualityChips(base, 8).find((c) => c.kind === "sample");
    expect(small?.level).toBe("bad");
    const medium = deriveQualityChips(base, 20).find((c) => c.kind === "sample");
    expect(medium?.level).toBe("warning");
    const big = deriveQualityChips(base, 40).find((c) => c.kind === "sample");
    expect(big).toBeUndefined();
  });
});
