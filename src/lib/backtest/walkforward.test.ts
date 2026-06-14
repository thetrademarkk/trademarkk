/**
 * walkforward.ts — IS/OOS windowing (correct splits, anchored vs rolling,
 * low-coverage skip), aggregate OOS curve, and the DESCRIPTIVE (never evaluative)
 * plain-language summary thresholds.
 */

import { describe, expect, it } from "vitest";
import {
  MIN_WINDOW_DAYS,
  walkForward,
  walkForwardCurve,
  type WalkForwardConfig,
} from "./walkforward";
import type { BlotterRow, RunResult } from "../../features/backtest/shared/run-result";
import { makeDefaultStrategy } from "../../features/backtest/shared/strategy-def";

function row(day: string, net: number): BlotterRow {
  return {
    day,
    entryTs: 0,
    exitTs: 0,
    legs: [
      {
        legId: "l1",
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

/** Build a RunResult whose tradeable blotter days carry the given nets, in order. */
function runWith(nets: number[], skipIdx: number[] = []): RunResult {
  const blotter: BlotterRow[] = nets.map((n, i) => {
    const day = `2024-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
    if (skipIdx.includes(i)) {
      return { ...row(day, 0), legs: [], gross: 0, net: 0 };
    }
    return row(day, n);
  });
  return {
    resultVersion: 1,
    runId: "wf",
    config: makeDefaultStrategy("wf", "NIFTY"),
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

describe("walkForward — split geometry", () => {
  it("rolling: fixed IS size, non-overlapping OOS blocks, correct boundaries", () => {
    const nets = Array.from({ length: 30 }, () => 100);
    const cfg: WalkForwardConfig = { scheme: "rolling", isDays: 10, oosDays: 5 };
    const wf = walkForward(runWith(nets), cfg);
    expect(wf.windows.length).toBe(4);
    expect(wf.windows[0]!.isDays.count).toBe(10);
    expect(wf.windows[1]!.isDays.count).toBe(10);
    expect(wf.windows[0]!.oosDays.count).toBe(5);
    expect(wf.windows[1]!.isDays.start > wf.windows[0]!.isDays.start).toBe(true);
  });

  it("anchored: IS always starts at day 0 and grows across folds", () => {
    const nets = Array.from({ length: 30 }, () => 100);
    const wf = walkForward(runWith(nets), { scheme: "anchored", isDays: 10, oosDays: 5 });
    expect(wf.windows.length).toBe(4);
    expect(wf.windows[0]!.isDays.count).toBe(10);
    expect(wf.windows[1]!.isDays.count).toBe(15);
    expect(wf.windows[2]!.isDays.count).toBe(20);
    expect(wf.windows[0]!.isDays.start).toBe(wf.windows[1]!.isDays.start);
    expect(wf.windows[0]!.isDays.start).toBe(wf.windows[2]!.isDays.start);
  });

  it("only counts tradeable days — skipped (empty-leg) days are excluded", () => {
    const nets = Array.from({ length: 12 }, () => 100);
    const wf = walkForward(runWith(nets, [3, 7]), { scheme: "rolling", isDays: 5, oosDays: 5 });
    expect(wf.totalDays).toBe(10);
  });
});

describe("walkForward — low-coverage handling (honest, never fabricated)", () => {
  it("flags a fold whose OOS tail is shorter than MIN_WINDOW_DAYS", () => {
    const nets = Array.from({ length: 23 }, () => 100);
    const wf = walkForward(runWith(nets), { scheme: "rolling", isDays: 10, oosDays: 5 });
    const last = wf.windows[wf.windows.length - 1]!;
    expect(last.oosDays.count).toBeLessThan(MIN_WINDOW_DAYS);
    expect(last.lowCoverage).toBe(true);
    expect(wf.usableWindows).toBe(wf.windows.filter((w) => !w.lowCoverage).length);
  });

  it("too few trade-days → inconclusive with an honest summary, no fabricated windows", () => {
    const wf = walkForward(runWith([100, -50]));
    expect(wf.usableWindows).toBe(0);
    expect(wf.verdict).toBe("inconclusive");
    expect(wf.summary).toMatch(/not enough trade-days/i);
  });
});

describe("walkForward — aggregate OOS curve + ratio", () => {
  it("OOS curve stitches every OOS segment end-to-end (cumulative)", () => {
    const nets = Array.from({ length: 20 }, () => 100);
    const wf = walkForward(runWith(nets), { scheme: "rolling", isDays: 5, oosDays: 5 });
    expect(wf.oosCurve.length).toBe(15);
    expect(wf.oosCurve[wf.oosCurve.length - 1]!.equity).toBe(1500);
    for (let i = 1; i < wf.oosCurve.length; i++) {
      expect(wf.oosCurve[i]!.equity).toBeGreaterThan(wf.oosCurve[i - 1]!.equity);
    }
  });

  it("aggregate ratio is OOS net / IS net, sign-aware", () => {
    const nets = [...Array(10).fill(100), ...Array(10).fill(50)];
    const wf = walkForward(runWith(nets), { scheme: "anchored", isDays: 10, oosDays: 10 });
    expect(wf.aggregateOosToIsRatio).toBeCloseTo(0.5, 5);
  });
});

describe("walkForward — DESCRIPTIVE summary thresholds (never evaluative)", () => {
  const cfg: WalkForwardConfig = { scheme: "rolling", isDays: 10, oosDays: 10 };
  const NOT_EVALUATIVE =
    /good|bad|great|excellent|profitable strategy|winner|strong|\bbuy\b|\bsell\b|recommend/i;

  it("OOS ≈ IS → 'held'", () => {
    const nets = [...Array(10).fill(100), ...Array(10).fill(90)];
    const wf = walkForward(runWith(nets), cfg);
    expect(wf.verdict).toBe("held");
    expect(wf.summary).toMatch(/held out-of-sample/i);
    expect(wf.summary).not.toMatch(NOT_EVALUATIVE);
  });

  it("OOS ≈ half of IS → 'softened'", () => {
    const nets = [...Array(10).fill(100), ...Array(10).fill(50)];
    const wf = walkForward(runWith(nets), cfg);
    expect(wf.verdict).toBe("softened");
    expect(wf.summary).toMatch(/softened out-of-sample/i);
    expect(wf.summary).not.toMatch(NOT_EVALUATIVE);
  });

  it("OOS far below IS → 'degraded'", () => {
    const nets = [...Array(10).fill(100), ...Array(10).fill(10)];
    const wf = walkForward(runWith(nets), cfg);
    expect(wf.verdict).toBe("degraded");
    expect(wf.summary).toMatch(/degraded out-of-sample/i);
  });

  it("OOS flips sign vs IS → 'degraded' (reversed direction)", () => {
    const nets = [...Array(10).fill(100), ...Array(10).fill(-80)];
    const wf = walkForward(runWith(nets), cfg);
    expect(wf.verdict).toBe("degraded");
  });

  it("OOS exceeds IS → 'improved'", () => {
    const nets = [...Array(10).fill(50), ...Array(10).fill(120)];
    const wf = walkForward(runWith(nets), cfg);
    expect(wf.verdict).toBe("improved");
    expect(wf.summary).not.toMatch(NOT_EVALUATIVE);
  });
});

describe("walkForwardCurve — two-color IS/OOS split", () => {
  it("splits the cumulative curve at the last fold's OOS start (boundary in both series)", () => {
    const nets = Array.from({ length: 20 }, () => 100);
    const run = runWith(nets);
    const wf = walkForward(run, { scheme: "rolling", isDays: 5, oosDays: 5 });
    const curve = walkForwardCurve(run, wf);
    expect(curve.length).toBe(20);
    // Exactly one boundary point, carrying BOTH series for a seamless join.
    const boundaries = curve.filter((p) => p.boundary);
    expect(boundaries.length).toBe(1);
    expect(boundaries[0]!.isEquity).not.toBeNull();
    expect(boundaries[0]!.oosEquity).not.toBeNull();
    // Before the boundary: only IS has a value; after: only OOS.
    const first = curve[0]!;
    const last = curve[curve.length - 1]!;
    expect(first.isEquity).not.toBeNull();
    expect(first.oosEquity).toBeNull();
    expect(last.oosEquity).not.toBeNull();
    expect(last.isEquity).toBeNull();
    // Cumulative through to the end (20 * 100).
    expect(last.oosEquity).toBe(2000);
  });

  it("no usable folds → empty curve (UI shows the honest state, not a fake line)", () => {
    const run = runWith([100, -50]);
    const wf = walkForward(run);
    expect(walkForwardCurve(run, wf)).toEqual([]);
  });
});

describe("walkForward — determinism", () => {
  it("identical run + config ⇒ identical result (no randomness in windowing)", () => {
    const nets = Array.from({ length: 40 }, (_, i) => (i % 3 ? 120 : -80));
    const a = walkForward(runWith(nets), { scheme: "rolling", isDays: 12, oosDays: 8 });
    const b = walkForward(runWith(nets), { scheme: "rolling", isDays: 12, oosDays: 8 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
