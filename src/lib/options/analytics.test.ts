import { describe, expect, it } from "vitest";
import {
  dteBuckets,
  strategyGroups,
  legShapesForTrade,
  MIN_SAMPLE,
  type OptionTradeLike,
} from "./analytics";
import type { LegShape } from "./payoff";

let seq = 0;
const trade = (p: Partial<OptionTradeLike>): OptionTradeLike => ({
  id: `t${seq++}`,
  segment: "OPT",
  status: "closed",
  net_pnl: 0,
  opened_at: "2026-06-01T10:00:00Z",
  expiry: "2026-06-05",
  strike: 100,
  option_type: "CE",
  direction: "long",
  qty: 50,
  ...p,
});

describe("dteBuckets", () => {
  it("buckets by days-to-expiry and gates n>=MIN_SAMPLE", () => {
    const trades: OptionTradeLike[] = [
      // 6 trades expiring same day → 0DTE, enough.
      ...Array.from({ length: 6 }, (_, i) =>
        trade({ opened_at: "2026-06-05T10:00:00Z", expiry: "2026-06-05", net_pnl: i < 4 ? 100 : -50 })
      ),
      // 2 trades at 8–30 DTE → below MIN_SAMPLE, flagged not-enough.
      trade({ opened_at: "2026-06-01T10:00:00Z", expiry: "2026-06-20", net_pnl: 200 }),
      trade({ opened_at: "2026-06-01T10:00:00Z", expiry: "2026-06-20", net_pnl: -100 }),
    ];
    const buckets = dteBuckets(trades);
    const zero = buckets.find((b) => b.bucket === "0DTE")!;
    expect(zero.trades).toBe(6);
    expect(zero.enough).toBe(true);
    expect(zero.winRate).toBeCloseTo(4 / 6, 5);
    expect(zero.netPnl).toBe(4 * 100 - 2 * 50);

    const mid = buckets.find((b) => b.bucket === "8–30")!;
    expect(mid.trades).toBe(2);
    expect(mid.enough).toBe(false);
  });

  it("ignores non-OPT, open and expiry-less trades", () => {
    const trades: OptionTradeLike[] = [
      trade({ segment: "EQ", expiry: null }),
      trade({ status: "open" }),
      trade({ expiry: null }),
    ];
    expect(dteBuckets(trades)).toHaveLength(0);
  });

  it(`requires ${MIN_SAMPLE} per bucket to mark enough`, () => {
    const four = Array.from({ length: 4 }, () =>
      trade({ opened_at: "2026-06-05T10:00:00Z", expiry: "2026-06-05" })
    );
    const b = dteBuckets(four);
    expect(b[0]!.enough).toBe(false);
  });
});

describe("legShapesForTrade", () => {
  it("uses explicit leg rows when present", () => {
    const legs: LegShape[] = [
      { strike: 100, optionType: "CE", direction: "long", qty: 50 },
      { strike: 100, optionType: "PE", direction: "long", qty: 50 },
    ];
    const shapes = legShapesForTrade(trade({}), legs);
    expect(shapes).toHaveLength(2);
  });
  it("falls back to top-level fields for single-leg trades", () => {
    const shapes = legShapesForTrade(
      trade({ strike: 200, option_type: "PE", direction: "short", qty: 25 }),
      undefined
    );
    expect(shapes).toEqual([{ strike: 200, optionType: "PE", direction: "short", qty: 25 }]);
  });
  it("returns empty when no strike/type", () => {
    expect(legShapesForTrade(trade({ strike: null, option_type: null }), undefined)).toEqual([]);
  });
});

describe("strategyGroups", () => {
  it("collapses multi-leg trades into named structures and counts multi-leg", () => {
    const straddleLegs: LegShape[] = [
      { strike: 100, optionType: "CE", direction: "long", qty: 50 },
      { strike: 100, optionType: "PE", direction: "long", qty: 50 },
    ];
    const trades: OptionTradeLike[] = [
      trade({ id: "s1", net_pnl: 500 }), // multi-leg straddle
      trade({ id: "s2", net_pnl: -200 }), // multi-leg straddle
      trade({ id: "c1", strike: 100, option_type: "CE", direction: "long", net_pnl: 300 }), // single long call
    ];
    const legsByTrade = new Map<string, LegShape[]>([
      ["s1", straddleLegs],
      ["s2", straddleLegs],
    ]);
    const groups = strategyGroups(trades, legsByTrade);

    const straddle = groups.find((g) => g.label === "Straddle")!;
    expect(straddle.trades).toBe(2);
    expect(straddle.multiLeg).toBe(2);
    expect(straddle.netPnl).toBe(300);
    expect(straddle.winRate).toBe(0.5);

    const longCall = groups.find((g) => g.label === "Long Call")!;
    expect(longCall.trades).toBe(1);
    expect(longCall.multiLeg).toBe(0);
  });

  it("sorts by net P&L so winners surface first", () => {
    const trades: OptionTradeLike[] = [
      trade({ id: "a", strike: 100, option_type: "CE", direction: "long", net_pnl: -100 }),
      trade({ id: "b", strike: 100, option_type: "PE", direction: "long", net_pnl: 500 }),
    ];
    const groups = strategyGroups(trades, new Map());
    expect(groups[0]!.label).toBe("Long Put");
    expect(groups[0]!.netPnl).toBe(500);
  });

  it("ignores non-OPT and open trades", () => {
    const trades: OptionTradeLike[] = [
      trade({ segment: "EQ", strike: null, option_type: null }),
      trade({ status: "open" }),
    ];
    expect(strategyGroups(trades, new Map())).toHaveLength(0);
  });
});
