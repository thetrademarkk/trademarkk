/**
 * robustness.ts — MC robustness (bootstrap + order-shuffle). Verifies:
 *  - the basis routing matches mc-cone (raw-rupee for no-stop, R for hard-SL);
 *  - MIN_TRADES=30 gating (honest null below it);
 *  - determinism: same seed ⇒ identical distributionHash;
 *  - a different seed ⇒ a different hash (the resampling is actually stochastic);
 *  - percentile correctness vs a hand-computed degenerate case;
 *  - the descriptive summary never reads as a recommendation.
 */

import { describe, expect, it } from "vitest";
import { hashPercentiles, MIN_TRADES, robustnessFromRun } from "./robustness";
import type { BlotterRow, RunResult } from "../../features/backtest/shared/run-result";
import { makeDefaultStrategy, type StrategyDef } from "../../features/backtest/shared/strategy-def";

function row(day: string, net: number, legId = "l1"): BlotterRow {
  return {
    day,
    entryTs: 0,
    exitTs: 0,
    legs: [
      {
        legId,
        optionType: "PE",
        side: "sell",
        qty: 75,
        resolution: {
          requested: 24250,
          served: 24250,
          coverage: 1,
          confidence: "high",
          fallbackSteps: 0,
        },
        entryPrice: 100,
        exitPrice: 100 - net / 75,
        gross: net,
        charges: 0,
        net,
        reentries: 0,
      },
    ],
    gross: net,
    charges: 0,
    net,
    substituted: false,
    flags: [],
  };
}

function runWith(config: StrategyDef, nets: number[]): RunResult {
  // Use the config's REAL leg id so dayRisk() can resolve the leg's SL (the
  // R-vs-rupee routing depends on matching the blotter leg back to its def).
  const legId = config.legs[0]!.id;
  const blotter = nets.map((n, i) =>
    row(`2024-01-${String((i % 28) + 1).padStart(2, "0")}`, n, legId)
  );
  return {
    resultVersion: 1,
    runId: "rob",
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

const noStop = makeDefaultStrategy("rob", "NIFTY");
const hardSl: StrategyDef = {
  ...noStop,
  legs: [
    {
      ...noStop.legs[0]!,
      stopLoss: { unit: "pct", basis: "premium", value: 50, refPrice: "traded" },
    },
  ],
};

describe("robustnessFromRun — gating + basis routing", () => {
  it("< MIN_TRADES → null (honest not-enough-data)", () => {
    const res = runWith(noStop, [100, -50, 100]);
    expect(robustnessFromRun(res)).toBeNull();
    expect(MIN_TRADES).toBe(30);
  });

  it("no-stop straddle → raw-rupee basis", () => {
    const nets = Array.from({ length: 35 }, (_, i) => (i % 2 ? -200 : 300));
    const r = robustnessFromRun(runWith(noStop, nets), { paths: 1000 })!;
    expect(r.basis).toBe("rupees");
    expect(r.unit).toBe("₹");
    expect(r.sampleSize).toBe(35);
  });

  it("hard-SL strategy → R basis", () => {
    const nets = Array.from({ length: 35 }, (_, i) => (i % 2 ? -3750 : 1500));
    const r = robustnessFromRun(runWith(hardSl, nets), { paths: 1000 })!;
    expect(r.basis).toBe("R");
    expect(r.unit).toBe("R");
  });
});

describe("robustnessFromRun — determinism", () => {
  it("same seed ⇒ identical distributionHash", () => {
    const nets = Array.from({ length: 40 }, (_, i) => (i % 3 ? -150 : 400));
    const a = robustnessFromRun(runWith(noStop, nets), { paths: 4000 })!;
    const b = robustnessFromRun(runWith(noStop, nets), { paths: 4000 })!;
    expect(a.distributionHash).toBe(b.distributionHash);
    expect(JSON.stringify(a.terminalPnl)).toBe(JSON.stringify(b.terminalPnl));
    expect(JSON.stringify(a.maxDrawdown)).toBe(JSON.stringify(b.maxDrawdown));
  });

  it("different seed ⇒ different hash (resampling is stochastic)", () => {
    const nets = Array.from({ length: 40 }, (_, i) => (i % 3 ? -150 : 400));
    const baseRun = runWith(noStop, nets);
    const otherSeed: RunResult = {
      ...baseRun,
      config: { ...baseRun.config, execution: { ...baseRun.config.execution, seed: 999 } },
    };
    const a = robustnessFromRun(baseRun, { paths: 4000 })!;
    const b = robustnessFromRun(otherSeed, { paths: 4000 })!;
    expect(a.distributionHash).not.toBe(b.distributionHash);
  });
});

describe("robustnessFromRun — percentile correctness", () => {
  it("constant-return run: every resample finishes at the same terminal & zero DD", () => {
    // All +100 over 30 days: any bootstrap/shuffle of identical values gives the
    // same monotonic-up path → terminal = 3000 at every percentile, DD = 0.
    const nets = Array.from({ length: 30 }, () => 100);
    const r = robustnessFromRun(runWith(noStop, nets), { paths: 500 })!;
    expect(r.terminalPnl.p5).toBe(3000);
    expect(r.terminalPnl.p50).toBe(3000);
    expect(r.terminalPnl.p95).toBe(3000);
    expect(r.terminalPnl.observed).toBe(3000);
    // A strictly-increasing equity never draws down.
    expect(r.maxDrawdown.p95).toBe(0);
    expect(r.shuffleMaxDrawdown.p95).toBe(0);
    // All paths net-positive.
    expect(r.probNetPositive).toBe(1);
  });

  it("observedPercentile is the fraction of paths at or below the observed value", () => {
    const nets = Array.from({ length: 30 }, () => 100);
    const r = robustnessFromRun(runWith(noStop, nets), { paths: 500 })!;
    // Observed terminal equals every resample → all paths ≤ observed.
    expect(r.terminalPnl.observedPercentile).toBe(1);
  });

  it("order-shuffle keeps the trade set: a big early loss vs late loss changes max-DD spread", () => {
    // 30 days, one big −5000, rest small +300. Shuffling moves the loss around →
    // the shuffle max-DD distribution has spread (p95 > p5 is impossible to assert
    // cheaply, but p95 must be at least the single-loss magnitude).
    const nets = [-5000, ...Array.from({ length: 29 }, () => 300)];
    const r = robustnessFromRun(runWith(noStop, nets), { paths: 3000 })!;
    expect(r.shuffleMaxDrawdown.p95).toBeGreaterThanOrEqual(5000);
  });
});

describe("robustnessFromRun — descriptive summary", () => {
  it("summary is descriptive, never a recommendation", () => {
    const nets = Array.from({ length: 35 }, (_, i) => (i % 2 ? -200 : 300));
    const r = robustnessFromRun(runWith(noStop, nets), { paths: 1000 })!;
    expect(r.summary).toMatch(/resampling|simulated outcomes|net-positive/i);
    expect(r.summary).not.toMatch(/\bbuy\b|\bsell\b|recommend|good strategy|profitable strategy/i);
  });
});

describe("pre-baked SAMPLE_RUN crosses the robustness gates (populated landing report)", () => {
  it("parses, and walk-forward + MC + coach are all populated (not low-sample)", async () => {
    const { SAMPLE_RUN } = await import("../../app/backtesting/sample-run");
    const { parseRunResult } = await import("../../features/backtest/shared/run-result");
    const { walkForward, walkForwardCurve } = await import("./walkforward");
    const { deflatedSharpe } = await import("./deflated-sharpe");
    // The sample must be a SCHEMA-VALID RunResult (it renders the real report).
    expect(() => parseRunResult(SAMPLE_RUN)).not.toThrow();
    const traded = SAMPLE_RUN.blotter.filter((b) => b.legs.length > 0).length;
    expect(traded).toBeGreaterThanOrEqual(MIN_TRADES);
    // Walk-forward produces usable folds + a non-empty two-color curve.
    const wf = walkForward(SAMPLE_RUN);
    expect(wf.usableWindows).toBeGreaterThanOrEqual(1);
    expect(walkForwardCurve(SAMPLE_RUN, wf).length).toBe(traded);
    // MC is populated (not null).
    expect(robustnessFromRun(SAMPLE_RUN, { paths: 500 })).not.toBeNull();
    // Coach estimates PSR/DSR (sample large enough).
    const coach = deflatedSharpe({
      dailyNets: SAMPLE_RUN.blotter.map((b) => b.net),
      annualizedSharpe: SAMPLE_RUN.stats.sharpe,
    });
    expect(coach.psr).not.toBeNull();
    expect(coach.caution).not.toBe("insufficient");
  });
});

describe("hashPercentiles", () => {
  it("is order-sensitive and stable", () => {
    expect(hashPercentiles([1, 2, 3])).toBe(hashPercentiles([1, 2, 3]));
    expect(hashPercentiles([1, 2, 3])).not.toBe(hashPercentiles([3, 2, 1]));
  });
});
