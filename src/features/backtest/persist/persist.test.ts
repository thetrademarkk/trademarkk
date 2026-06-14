import { describe, expect, it } from "vitest";
import { makeDefaultStrategy } from "../shared/strategy-def";
import { RUN_RESULT_VERSION, type RunResult } from "../shared/run-result";
import {
  STORED_RUN_VERSION,
  serializeRunResult,
  deserializeRunResult,
  safeDeserializeRunResult,
  storedRunEnvelopeSchema,
} from "./serialize";
import { SHARE_ID_ALPHABET, SHARE_ID_LENGTH, generateShareId, isValidShareId } from "./share-id";
import { saveRunBodySchema, shareRunBodySchema } from "./api";

/** A complete, valid RunResult for round-trip tests (mirrors run-result.test). */
function makeRunResult(overrides: Partial<RunResult> = {}): RunResult {
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
    ...overrides,
  };
}

describe("run-result serialization round-trip (immutable artifact)", () => {
  it("RunResult → blob → identical RunResult (deep-equal)", () => {
    const r = makeRunResult();
    const blob = serializeRunResult(r);
    const back = deserializeRunResult(blob);
    expect(back).toEqual(r);
  });

  it("the blob is a versioned envelope wrapping the validated result", () => {
    const blob = serializeRunResult(makeRunResult());
    const parsed = JSON.parse(blob) as unknown;
    expect(storedRunEnvelopeSchema.parse(parsed).storedVersion).toBe(STORED_RUN_VERSION);
  });

  it("round-trips byte-stably (serialize ∘ deserialize ∘ serialize is fixed)", () => {
    const r = makeRunResult();
    const blob1 = serializeRunResult(r);
    const blob2 = serializeRunResult(deserializeRunResult(blob1));
    expect(blob2).toBe(blob1);
  });

  it("refuses to serialize a malformed RunResult", () => {
    const bad = makeRunResult({ coverage: { ...makeRunResult().coverage, overall: 2 } });
    expect(() => serializeRunResult(bad)).toThrow();
  });

  it("safeDeserialize returns null on a tampered / truncated blob", () => {
    expect(safeDeserializeRunResult("{not json")).toBeNull();
    expect(safeDeserializeRunResult(JSON.stringify({ storedVersion: 1 }))).toBeNull();
    // A valid envelope still deserializes.
    expect(safeDeserializeRunResult(serializeRunResult(makeRunResult()))).not.toBeNull();
  });

  it("preserves money exactly (paise-correct) through the round-trip", () => {
    const r = makeRunResult({
      stats: {
        netPnl: 1899.29,
        winRate: 1,
        maxDrawdown: 0,
        expectancy: 949.645,
        profitFactor: 5,
        sharpe: 0,
      },
    });
    expect(deserializeRunResult(serializeRunResult(r)).stats.netPnl).toBe(1899.29);
  });
});

describe("share-id (unguessable, opt-in permalink slug)", () => {
  it("generates 21 chars from the 36-symbol url-safe alphabet", () => {
    const id = generateShareId();
    expect(id).toHaveLength(SHARE_ID_LENGTH);
    for (const ch of id) expect(SHARE_ID_ALPHABET).toContain(ch);
    expect(isValidShareId(id)).toBe(true);
  });

  it("is effectively collision-free across many draws (unguessable)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(generateShareId());
    expect(seen.size).toBe(5000);
  });

  it("rejects malformed share-ids (route-param guard)", () => {
    expect(isValidShareId("")).toBe(false);
    expect(isValidShareId("UPPERCASE0000000000000")).toBe(false);
    expect(isValidShareId("too-short")).toBe(false);
    expect(isValidShareId("has spaces in it 00000")).toBe(false);
    expect(isValidShareId(42)).toBe(false);
    expect(isValidShareId(null)).toBe(false);
  });

  it("honours a custom length", () => {
    expect(generateShareId(10)).toHaveLength(10);
  });
});

describe("save/share API contracts (one schema, client + server)", () => {
  it("accepts a well-formed save body (strategy + immutable result)", () => {
    const body = { strategy: makeDefaultStrategy("s1", "NIFTY"), result: makeRunResult() };
    expect(saveRunBodySchema.safeParse(body).success).toBe(true);
  });

  it("rejects a save body missing the result", () => {
    const body = { strategy: makeDefaultStrategy("s1", "NIFTY") };
    expect(saveRunBodySchema.safeParse(body).success).toBe(false);
  });

  it("share body defaults enabled to true (Share = opt-in mint)", () => {
    expect(shareRunBodySchema.parse({}).enabled).toBe(true);
    expect(shareRunBodySchema.parse({ enabled: false }).enabled).toBe(false);
  });
});
