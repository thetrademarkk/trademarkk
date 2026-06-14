/**
 * Unit tests for the BT-07 pure results layer:
 *   - the NEUTRAL verdict template (descriptive, never evaluative) — exact string;
 *   - the gross → net charges waterfall (cent-for-cent vs the engine's stored Σ);
 *   - monthly-heatmap bucketing (empty months are null/hatched, not faked 0);
 *   - per-stat delta calc;
 *   - quality-chip thresholds (via deriveQualityChips);
 *   - calendar buckets (expiry vs non-expiry, weekday).
 *
 * The charges + verdict + calendar tests run against the REAL committed golden
 * NIFTY 2024-07 slice through the actual engine, so they are end-to-end honest.
 */

import { describe, expect, it } from "vitest";
import { runBacktest } from "@/lib/backtest/engine/engine";
import { FixtureDataSource } from "@/lib/backtest/engine/adapters/fixture-source";
import { loadGoldenSnapshot } from "@/lib/backtest/__fixtures__/golden-loader";
import { makeDefaultStrategy, type StrategyDef } from "@/features/backtest/shared/strategy-def";
import {
  deriveQualityChips,
  type CoverageReport,
  type RunResult,
} from "@/features/backtest/shared/run-result";
import { buildVerdictHeadline, buildCoverageCaveat, formatSpan } from "./verdict";
import { deriveChargesWaterfall, waterfallLines } from "./charges-derive";
import { buildMonthlyGrid, cellMagnitude } from "./monthly-grid";
import { buildStatCards, computeStatDeltas, STAT_ORDER } from "./stat-cards";
import { buildCalendarBuckets } from "./calendar-buckets";
import { buildHeroSeries, topDrawdownEpisodes } from "./equity-series";

const RANGE = { start: "2024-07-24", end: "2024-07-25" };

function goldenStraddle(): RunResult {
  const base = makeDefaultStrategy("golden", "NIFTY");
  const strat: StrategyDef = {
    ...base,
    name: "Short Straddle",
    market: { symbol: "NIFTY", interval: "1m", dateRange: RANGE },
    timing: { mode: "fixed_time", entryTime: "09:20", exitTime: "15:15" },
    execution: { ...base.execution, slippage: { unit: "pct", value: 0.5 } },
    legs: [
      {
        id: "ce",
        enabled: true,
        optionType: "CE",
        side: "sell",
        lots: 1,
        strike: { mode: "ATM_OFFSET", steps: 0 },
        expiry: "WEEKLY",
        squareOff: "partial",
      },
      {
        id: "pe",
        enabled: true,
        optionType: "PE",
        side: "sell",
        lots: 1,
        strike: { mode: "ATM_OFFSET", steps: 0 },
        expiry: "WEEKLY",
        squareOff: "partial",
      },
    ],
  };
  return runBacktest(strat, new FixtureDataSource(loadGoldenSnapshot()), { ranAt: 0 });
}

describe("verdict headline — neutral & descriptive (D10)", () => {
  it("produces an exact descriptive string, never evaluative", () => {
    const run = goldenStraddle();
    const line = buildVerdictHeadline(run);
    // 2 trade-days < 30 → prepends the neutral small-sample caveat.
    expect(line).toBe(
      "Small sample (2 trade-days). Net P&L +₹1,899.29 across 2 trade-days from 24 Jul 2024 – 25 Jul 2024, at 100% data coverage."
    );
    // Never evaluative.
    for (const banned of ["good", "great", "bad", "profitable strategy", "winner", "strong"]) {
      expect(line.toLowerCase()).not.toContain(banned);
    }
  });

  it("drops the caveat once the sample is large enough", () => {
    const run = goldenStraddle();
    // Synthesize 30 trade-days so the small-sample prefix disappears.
    const big: RunResult = {
      ...run,
      blotter: Array.from({ length: 30 }, (_, i) => ({
        ...run.blotter[0]!,
        day: `2024-07-${String(i + 1).padStart(2, "0")}`,
      })),
    };
    const line = buildVerdictHeadline(big);
    expect(line.startsWith("Net P&L")).toBe(true);
    expect(line).toContain("across 30 trade-days");
  });

  it("formatSpan collapses identical start/end", () => {
    expect(formatSpan("2024-07-24", "2024-07-24")).toBe("24 Jul 2024");
  });

  it("coverage caveat is null when nothing needs flagging", () => {
    expect(buildCoverageCaveat(goldenStraddle())).toBeNull();
  });
});

describe("charges waterfall — cent-for-cent vs the engine", () => {
  it("re-derived component sum equals the stored Σ charges and gross − charges = net", () => {
    const run = goldenStraddle();
    const w = deriveChargesWaterfall(run);

    const storedCharges = Math.round(run.blotter.reduce((s, r) => s + r.charges, 0) * 100) / 100;
    const storedGross = Math.round(run.blotter.reduce((s, r) => s + r.gross, 0) * 100) / 100;

    // The re-derivation reproduces the engine's charges EXACTLY.
    expect(w.charges).toBe(storedCharges);
    expect(w.gross).toBe(storedGross);
    // The waterfall closes to the headline net.
    expect(w.net).toBe(run.stats.netPnl);
    expect(Math.round((w.gross - w.charges) * 100) / 100).toBe(w.net);

    // Components themselves sum to the total (no rounding leak).
    const c = w.components;
    const sum =
      Math.round(
        (c.brokerage + c.stt + c.exchange + c.sebi + c.gst + c.stampDuty + c.dpCharge) * 100
      ) / 100;
    expect(sum).toBe(w.charges);
    // Zerodha index options carry a flat per-order brokerage and a sell-side STT.
    expect(c.brokerage).toBeGreaterThan(0);
    expect(c.stt).toBeGreaterThan(0);
  });

  it("waterfall lines render gross, each deduction, and the net total", () => {
    const w = deriveChargesWaterfall(goldenStraddle());
    const lines = waterfallLines(w);
    expect(lines[0]!.kind).toBe("add");
    expect(lines[lines.length - 1]!.kind).toBe("total");
    expect(lines[lines.length - 1]!.value).toBe(w.net);
    // Every deduction line is non-positive.
    for (const l of lines.filter((x) => x.kind === "sub")) expect(l.value).toBeLessThanOrEqual(0);
  });
});

describe("monthly grid — hatched, never faked zero", () => {
  it("marks an in-span month with no data as null (hatched), not 0", () => {
    const grid = buildMonthlyGrid([{ month: "2024-03", pnl: 1200 }], "2024-01-01", "2024-05-31");
    const row = grid.rows.find((r) => r.year === 2024)!;
    const jan = row.cells.find((c) => c.monthIndex === 1)!;
    const mar = row.cells.find((c) => c.monthIndex === 3)!;
    const jun = row.cells.find((c) => c.monthIndex === 6)!; // out of span
    expect(jan.pnl).toBeNull(); // in-span, no data → hatched
    expect(mar.pnl).toBe(1200); // covered
    expect(jun.pnl).toBeNull(); // out of span → hatched
    expect(row.covered).toBe(1);
    expect(grid.maxAbs).toBe(1200);
    // A genuine break-even month stays 0, distinct from a hatched null.
    const g2 = buildMonthlyGrid([{ month: "2024-02", pnl: 0 }], "2024-02-01", "2024-02-28");
    const feb = g2.rows[0]!.cells.find((c) => c.monthIndex === 2)!;
    expect(feb.pnl).toBe(0);
  });

  it("cellMagnitude returns null for hatched cells and 0..1 for covered", () => {
    const grid = buildMonthlyGrid([{ month: "2024-01", pnl: -500 }], "2024-01-01", "2024-02-29");
    const jan = grid.rows[0]!.cells.find((c) => c.monthIndex === 1)!;
    const feb = grid.rows[0]!.cells.find((c) => c.monthIndex === 2)!;
    expect(cellMagnitude(jan, grid.maxAbs)).toBe(1);
    expect(cellMagnitude(feb, grid.maxAbs)).toBeNull();
  });
});

describe("stat cards + per-stat deltas", () => {
  it("emits 6 cards in the R24 lead order with Net P&L derivable", () => {
    const cards = buildStatCards(goldenStraddle());
    expect(cards.map((c) => c.key)).toEqual([...STAT_ORDER]);
    expect(cards.map((c) => c.key)).toEqual([
      "netPnl",
      "winRate",
      "maxDrawdown",
      "expectancy",
      "profitFactor",
      "sharpe",
    ]);
    expect(cards[0]!.derivable).toBe(true);
    expect(cards[0]!.value).toContain("1,899.29");
  });

  it("computes directional deltas vs a previous run", () => {
    const cur = {
      netPnl: 2000,
      winRate: 0.6,
      maxDrawdown: -500,
      expectancy: 100,
      profitFactor: 1.8,
      sharpe: 1.2,
    };
    const prev = {
      netPnl: 1500,
      winRate: 0.5,
      maxDrawdown: -700,
      expectancy: 80,
      profitFactor: 1.5,
      sharpe: 1.0,
    };
    const deltas = computeStatDeltas(cur, prev);
    const byKey = Object.fromEntries(deltas.map((d) => [d.key, d]));
    expect(byKey.netPnl!.diff).toBe(500);
    expect(byKey.netPnl!.direction).toBe("up");
    expect(byKey.netPnl!.display).toBe("+₹500.00");
    // Drawdown got shallower (−700 → −500): a +200 (directionally "up") change.
    expect(byKey.maxDrawdown!.diff).toBe(200);
    expect(byKey.winRate!.display).toBe("+10.0%");
    expect(byKey.sharpe!.display).toBe("+0.20");
    // Identical runs → flat.
    expect(computeStatDeltas(cur, cur).every((d) => d.direction === "flat")).toBe(true);
  });
});

describe("quality-chip thresholds", () => {
  const base: CoverageReport = {
    overall: 1,
    byLeg: {},
    substitutions: 0,
    illiquidDays: 0,
    excludedDays: 0,
    filledBarFraction: 1,
  };
  it("coverage tiers: >=70 good, 40-69 warning, <40 bad", () => {
    expect(deriveQualityChips({ ...base, overall: 0.82 }, 100)[0]!.level).toBe("good");
    expect(deriveQualityChips({ ...base, overall: 0.55 }, 100)[0]!.level).toBe("warning");
    expect(deriveQualityChips({ ...base, overall: 0.3 }, 100)[0]!.level).toBe("bad");
  });
  it("surfaces substitution/illiquid/excluded/sample chips", () => {
    const chips = deriveQualityChips(
      { ...base, overall: 0.9, substitutions: 3, illiquidDays: 2, excludedDays: 1 },
      5
    );
    const kinds = chips.map((c) => c.kind);
    expect(kinds).toContain("substitution");
    expect(kinds).toContain("liquidity");
    expect(kinds).toContain("excluded");
    expect(kinds).toContain("sample"); // 5 < 30
    expect(chips.find((c) => c.kind === "sample")!.level).toBe("bad"); // 5 < 10
  });
});

describe("calendar buckets — expiry vs non-expiry", () => {
  it("splits the golden run: 2024-07-25 is the NIFTY weekly expiry", () => {
    const buckets = buildCalendarBuckets(goldenStraddle());
    // The golden slice's 07-25 is a Thursday weekly expiry; 07-24 is non-expiry.
    expect(buckets.expirySplit.expiry.n).toBe(1);
    expect(buckets.expirySplit.nonExpiry.n).toBe(1);
    // Weekday buckets total the two traded days.
    const totalN = buckets.weekdays.reduce((s, w) => s + w.n, 0);
    expect(totalN).toBe(2);
  });
});

describe("equity + underwater series", () => {
  it("underwater is always <= 0 and shares the equity x-axis", () => {
    const run = goldenStraddle();
    const hero = buildHeroSeries(run.equityCurve);
    expect(hero.length).toBe(run.equityCurve.length);
    for (const p of hero) expect(p.drawdown).toBeLessThanOrEqual(0);
    // The 07-24 +2458.72 then 07-25 loss → a drawdown episode exists on day 2.
    const episodes = topDrawdownEpisodes(run.equityCurve);
    expect(episodes.every((e) => e.depth < 0)).toBe(true);
  });
});
