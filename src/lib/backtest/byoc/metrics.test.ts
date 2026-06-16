import { describe, expect, it } from "vitest";
import { scoreTrades } from "./metrics";
import type { ByocBar } from "./types";

function bar(t: string, c: number): ByocBar {
  return { t, o: c, h: c, l: c, c, v: 0 };
}

const BARS: ByocBar[] = [
  bar("2026-01-01 09:15:00", 100),
  bar("2026-01-01 09:16:00", 110),
  bar("2026-01-01 09:17:00", 99),
  bar("2026-01-01 09:18:00", 121),
];

describe("scoreTrades", () => {
  it("scores a long trade as the signed close-to-close return", () => {
    const { scored, stats } = scoreTrades([{ entryIndex: 0, exitIndex: 1, side: "long" }], BARS);
    expect(scored[0]!.ret).toBeCloseTo(0.1, 10); // 100 → 110 = +10%
    expect(stats.totalReturn).toBeCloseTo(0.1, 10);
    expect(stats.winRate).toBe(1);
  });

  it("scores a short trade with inverted sign", () => {
    const { scored } = scoreTrades([{ entryIndex: 1, exitIndex: 2, side: "short" }], BARS);
    // 110 → 99 is -10% long, so short = +10%
    expect(scored[0]!.ret).toBeCloseTo(0.1, 10);
  });

  it("compounds equity and tracks max drawdown", () => {
    const { stats } = scoreTrades(
      [
        { entryIndex: 0, exitIndex: 1, side: "long" }, // +10% → eq 1.1
        { entryIndex: 1, exitIndex: 2, side: "long" }, // -10% → eq 0.99
        { entryIndex: 2, exitIndex: 3, side: "long" }, // +~22.2% → eq ~1.21
      ],
      BARS
    );
    expect(stats.trades).toBe(3);
    expect(stats.equity).toHaveLength(3);
    expect(stats.equity[0]).toBeCloseTo(1.1, 6);
    expect(stats.maxDrawdown).toBeGreaterThan(0); // peaked at 1.1 then dipped to 0.99
    expect(stats.totalReturn).toBeCloseTo(stats.equity[2]! - 1, 6);
  });

  it("an empty trade list yields zeroed stats (never NaN)", () => {
    const { stats } = scoreTrades([], BARS);
    expect(stats).toMatchObject({ trades: 0, winRate: 0, totalReturn: 0, maxDrawdown: 0 });
    expect(Number.isNaN(stats.avgReturn)).toBe(false);
  });
});
