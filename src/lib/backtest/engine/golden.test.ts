/**
 * GOLDEN runs against a REAL local-archive slice (golden-nifty-2024-07.json,
 * extracted from market_archive_1m by scripts/gen-backtest-golden.py). Two
 * founder-style strategies on a known well-covered NIFTY weekly expiry
 * (2024-07-25): a 9:20 ATM short straddle and a 9:20 OTM short strangle. Asserts
 * the RunResult SHAPE (zod-valid), the coverage-honesty layer, plausibility, and
 * the LOAD-BEARING expiry-at-LTP behaviour against real prices.
 */

import { describe, expect, it } from "vitest";
import { FixtureDataSource } from "./adapters/fixture-source";
import { runBacktest } from "./engine";
import { loadGoldenSnapshot } from "../__fixtures__/golden-loader";
import { parseRunResult } from "../../../features/backtest/shared/run-result";
import {
  makeDefaultStrategy,
  type StrategyDef,
} from "../../../features/backtest/shared/strategy-def";

const RANGE = { start: "2024-07-24", end: "2024-07-25" };

function goldenStrategy(legs: StrategyDef["legs"]): StrategyDef {
  const base = makeDefaultStrategy("golden", "NIFTY");
  return {
    ...base,
    name: "Golden",
    market: { symbol: "NIFTY", interval: "1m", dateRange: RANGE },
    timing: { mode: "fixed_time", entryTime: "09:20", exitTime: "15:15" },
    legs,
    execution: { ...base.execution, slippage: { unit: "pct", value: 0.5 } },
  };
}

describe("GOLDEN — real NIFTY 2024-07-25 archive slice", () => {
  const src = new FixtureDataSource(loadGoldenSnapshot());

  it("9:20 ATM short straddle: full coverage, no flags, expiry settles at LTP", () => {
    const res = runBacktest(
      goldenStrategy([
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
      ]),
      src,
      { ranAt: 0 }
    );

    // RunResult is schema-valid (round-trips the BT-02 zod schema).
    expect(() => parseRunResult(res)).not.toThrow();

    // Two trade-days booked, both legs each day, full real coverage.
    expect(res.blotter.length).toBe(2);
    expect(res.coverage.overall).toBe(1);
    expect(res.coverage.excludedDays).toBe(0);
    expect(res.flags).toEqual([]);

    // ATM resolution from real spot: 24450 (07-24), 24250 (07-25, expiry).
    const d24 = res.blotter.find((r) => r.day === "2024-07-24")!;
    const d25 = res.blotter.find((r) => r.day === "2024-07-25")!;
    expect(d24.legs.every((l) => l.resolution.served === 24450)).toBe(true);
    expect(d25.legs.every((l) => l.resolution.served === 24250)).toBe(true);

    // EXPIRY-AT-LTP (invariant 4) on real data: the 24250 PE collapsed to its
    // last traded price 0.15 at square-off — NOT to intrinsic value.
    const pe25 = d25.legs.find((l) => l.optionType === "PE")!;
    expect(pe25.exitPrice).toBe(0.15);

    // Confirmed cent-for-cent expected day P&L (real prices, 0.5% slippage).
    expect(d24.net).toBe(2458.72);
    expect(d25.net).toBe(-559.43);
    expect(res.stats.netPnl).toBe(1899.29);

    // Plausibility: finite stats, charges positive, gross/charge/net consistent.
    expect(Number.isFinite(res.stats.sharpe)).toBe(true);
    for (const row of res.blotter) {
      expect(row.charges).toBeGreaterThan(0);
      expect(row.net).toBeCloseTo(row.gross - row.charges, 2);
    }
  });

  it("9:20 OTM short strangle (ATM±1): off-ATM strikes resolve from real chain", () => {
    const res = runBacktest(
      goldenStrategy([
        {
          id: "ce",
          enabled: true,
          optionType: "CE",
          side: "sell",
          lots: 1,
          strike: { mode: "ATM_OFFSET", steps: 1 },
          expiry: "WEEKLY",
          squareOff: "partial",
        },
        {
          id: "pe",
          enabled: true,
          optionType: "PE",
          side: "sell",
          lots: 1,
          strike: { mode: "ATM_OFFSET", steps: -1 },
          expiry: "WEEKLY",
          squareOff: "partial",
        },
      ]),
      src,
      { ranAt: 0 }
    );
    expect(() => parseRunResult(res)).not.toThrow();
    expect(res.blotter.length).toBe(2);

    const d24 = res.blotter.find((r) => r.day === "2024-07-24")!;
    // ATM 24450 → +1 CE = 24500, −1 PE = 24400.
    expect(d24.legs.find((l) => l.optionType === "CE")!.resolution.served).toBe(24500);
    expect(d24.legs.find((l) => l.optionType === "PE")!.resolution.served).toBe(24400);

    expect(res.stats.netPnl).toBe(2443.93);
  });

  it("the data-source snapshotId rides on the RunResult (provenance)", () => {
    const res = runBacktest(
      goldenStrategy([
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
      ]),
      src,
      { ranAt: 0 }
    );
    expect(res.dataSnapshotId).toBe("local-NIFTY-2024-07-golden-v1");
    expect(res.engineVersion).toBe("1.0.0");
  });
});
