/**
 * mc-cone.ts — D3 routing (raw-rupee vs R-based), MIN_TRADES gating, and the
 * seed→determinism passthrough. The bootstrap math itself is already covered by
 * montecarlo/simulate.test.ts; here we test only the backtest-specific routing.
 */

import { describe, expect, it } from "vitest";
import { hasHardStop, monteCarloFromRun } from "./mc-cone";
import type { BlotterRow, RunResult } from "../../features/backtest/shared/run-result";
import { makeDefaultStrategy, type StrategyDef } from "../../features/backtest/shared/strategy-def";

function bookedLeg(net: number, legId = "mc-leg1") {
  return {
    legId,
    optionType: "PE" as const,
    side: "sell" as const,
    qty: 75,
    resolution: {
      requested: 24250,
      served: 24250,
      coverage: 1,
      confidence: "high" as const,
      fallbackSteps: 0,
    },
    entryPrice: 100,
    exitPrice: 100 - net / 75,
    gross: net,
    charges: 0,
    net,
    reentries: 0,
  };
}

function row(day: string, net: number): BlotterRow {
  return {
    day,
    entryTs: 0,
    exitTs: 0,
    legs: [bookedLeg(net)],
    gross: net,
    charges: 0,
    net,
    substituted: false,
    flags: [],
  };
}

function runResultWith(config: StrategyDef, nets: number[]): RunResult {
  const blotter = nets.map((n, i) => row(`2024-01-${String((i % 28) + 1).padStart(2, "0")}`, n));
  return {
    resultVersion: 1,
    runId: "r",
    config,
    engineVersion: "1.0.0",
    dataSnapshotId: "s",
    ranAt: 0,
    coverage: {
      overall: 1,
      byLeg: {},
      substitutions: 0,
      illiquidDays: 0,
      excludedDays: 0,
      filledBarFraction: 1,
    },
    stats: { netPnl: 0, winRate: 0.5, maxDrawdown: 0, expectancy: 0, profitFactor: 1, sharpe: 0 },
    qualityChips: [],
    equityCurve: [],
    monthlyReturns: [],
    tradeReturns: [],
    blotter,
    perLeg: [],
    flags: [],
  };
}

const baseStrat = makeDefaultStrategy("mc", "NIFTY");

describe("hasHardStop", () => {
  it("false for a no-stop straddle, true with a leg SL or overall MTM SL", () => {
    expect(hasHardStop(baseStrat)).toBe(false);
    const withLegSl: StrategyDef = {
      ...baseStrat,
      legs: [
        {
          ...baseStrat.legs[0]!,
          stopLoss: { unit: "pct", basis: "premium", value: 30, refPrice: "traded" },
        },
      ],
    };
    expect(hasHardStop(withLegSl)).toBe(true);
    const withMtm: StrategyDef = {
      ...baseStrat,
      risk: { reEntryOnOverall: false, stopLoss: { unit: "rupees", value: 5000 } },
    };
    expect(hasHardStop(withMtm)).toBe(true);
  });
});

describe("monteCarloFromRun routing + gating", () => {
  it("no-stop straddle → raw-rupee cone (D3)", () => {
    const nets = Array.from({ length: 35 }, (_, i) => (i % 2 ? -200 : 300));
    const res = runResultWith(baseStrat, nets);
    const cone = monteCarloFromRun(res, { paths: 1000 })!;
    expect(cone.basis).toBe("rupees");
    expect(cone.sampleSize).toBe(35);
    // raw-rupee cone starts flat at 0.
    expect(cone.sim.cone[0]!.p50).toBe(0);
  });

  it("hard-SL strategy → R-based cone", () => {
    const stratSl: StrategyDef = {
      ...baseStrat,
      legs: [
        {
          ...baseStrat.legs[0]!,
          stopLoss: { unit: "pct", basis: "premium", value: 50, refPrice: "traded" },
        },
      ],
    };
    const nets = Array.from({ length: 35 }, (_, i) => (i % 2 ? -3750 : 1500));
    const res = runResultWith(stratSl, nets);
    const cone = monteCarloFromRun(res, { paths: 1000 })!;
    expect(cone.basis).toBe("R");
    expect(cone.sim.cone[0]!.p50).toBe(100); // R cone starts at 100R
  });

  it("fewer than 30 samples → null", () => {
    const res = runResultWith(baseStrat, [100, -50, 100]);
    expect(monteCarloFromRun(res)).toBeNull();
  });

  it("identical seed → identical cone (determinism passthrough)", () => {
    const nets = Array.from({ length: 40 }, (_, i) => (i % 3 ? -150 : 400));
    const res = runResultWith(baseStrat, nets);
    const a = monteCarloFromRun(res, { paths: 2000 })!;
    const b = monteCarloFromRun(res, { paths: 2000 })!;
    expect(JSON.stringify(a.sim.cone)).toBe(JSON.stringify(b.sim.cone));
  });
});
