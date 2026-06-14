import { describe, expect, it } from "vitest";
import { clearHeldRun, holdRun, readHeldRun } from "./held-run";
import { makeDefaultStrategy } from "../shared/strategy-def";
import { RUN_RESULT_VERSION, type RunResult } from "../shared/run-result";

/**
 * The held-run store is a best-effort IndexedDB glue (no fake-indexeddb dep in
 * the node test env). The invariant we CAN assert here is the one the claim
 * flow relies on: every op degrades to a safe no-op / null when IndexedDB is
 * unavailable, so the Save/Share UI never throws — and, critically, holding a
 * run NEVER re-executes the engine (it stores the already-computed artifact).
 */
function makeRunResult(): RunResult {
  return {
    resultVersion: RUN_RESULT_VERSION,
    runId: "run-1",
    config: makeDefaultStrategy("s1", "NIFTY"),
    engineVersion: "1.0.0",
    dataSnapshotId: "snap",
    ranAt: 1,
    coverage: {
      overall: 1,
      byLeg: {},
      substitutions: 0,
      illiquidDays: 0,
      excludedDays: 0,
      filledBarFraction: 1,
    },
    stats: { netPnl: 0, winRate: 0, maxDrawdown: 0, expectancy: 0, profitFactor: 0, sharpe: 0 },
    qualityChips: [],
    equityCurve: [],
    monthlyReturns: [],
    tradeReturns: [],
    blotter: [],
    perLeg: [],
    flags: [],
  };
}

describe("held-run store (anonymous run claim glue)", () => {
  it("degrades to a no-op / null when IndexedDB is unavailable (no throw)", async () => {
    expect(typeof indexedDB).toBe("undefined"); // node env has no IDB
    await expect(holdRun(makeDefaultStrategy("s1"), makeRunResult())).resolves.toBeUndefined();
    await expect(readHeldRun()).resolves.toBeNull();
    await expect(clearHeldRun()).resolves.toBeUndefined();
  });

  it("holdRun is pure persistence — it accepts the already-computed result", async () => {
    // Holding takes a RunResult, never a StrategyDef-to-run: the artifact is
    // captured as-is (claim-on-login persists it; it is never re-derived).
    const result = makeRunResult();
    await holdRun(makeDefaultStrategy("s1"), result);
    expect(result.runId).toBe("run-1"); // unchanged by holding
  });
});
