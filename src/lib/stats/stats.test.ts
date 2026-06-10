import { describe, expect, it } from "vitest";
import {
  dailyPnl,
  equityCurve,
  expectancy,
  maxDrawdown,
  netPnl,
  profitFactor,
  rHistogram,
  streaks,
  winRate,
  type TradeLike,
} from "./stats";

const t = (net: number, closedAt: string, r: number | null = null): TradeLike => ({
  id: Math.random().toString(36),
  net_pnl: net,
  gross_pnl: net,
  r_multiple: r,
  opened_at: closedAt,
  closed_at: closedAt,
  status: "closed",
  symbol: "NIFTY",
  segment: "OPT",
  direction: "long",
  playbook_id: null,
});

const sample = [
  t(1000, "2026-06-01T10:00:00Z", 2),
  t(-500, "2026-06-02T10:00:00Z", -1),
  t(-500, "2026-06-03T10:00:00Z", -1),
  t(2000, "2026-06-04T10:00:00Z", 3),
];

describe("core stats", () => {
  it("netPnl sums", () => expect(netPnl(sample)).toBe(2000));
  it("winRate", () => expect(winRate(sample)).toBe(0.5));
  it("profitFactor = wins / |losses|", () => expect(profitFactor(sample)).toBe(3));
  it("expectancy = net / count", () => expect(expectancy(sample)).toBe(500));
  it("profitFactor with no losses is Infinity", () =>
    expect(profitFactor([t(100, "2026-06-01")])).toBe(Infinity));
});

describe("equity & drawdown", () => {
  it("builds a cumulative curve by day", () => {
    const curve = equityCurve(sample);
    expect(curve.map((p) => p.equity)).toEqual([1000, 500, 0, 2000]);
  });
  it("max drawdown is peak-to-trough", () => {
    expect(maxDrawdown(equityCurve(sample))).toBe(1000);
  });
  it("dailyPnl groups by close date", () => {
    const map = dailyPnl(sample);
    expect(map.get("2026-06-01")).toBe(1000);
    expect(map.size).toBe(4);
  });
});

describe("streaks", () => {
  it("tracks current and longest streaks", () => {
    const s = streaks(sample);
    expect(s.current).toBe(1); // last trade was a win
    expect(s.longestLoss).toBe(2);
  });
});

describe("rHistogram", () => {
  it("buckets r multiples", () => {
    const data = rHistogram(sample);
    expect(data.reduce((s, b) => s + b.count, 0)).toBe(4);
  });
});
