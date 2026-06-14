import { describe, expect, it } from "vitest";
import type { GroupStat } from "@/lib/stats/stats";
import {
  calendarCellAriaLabel,
  disciplineTrendAriaSummary,
  equityConeAriaSummary,
  equityCurveAriaSummary,
  groupBarAriaSummary,
  heatCellAriaLabel,
  payoffAriaSummary,
  rHistogramAriaSummary,
  statTileAriaValue,
} from "./chart-aria";

const stat = (key: string, netPnl: number, trades: number): GroupStat => ({
  key,
  netPnl,
  trades,
  winRate: 0.5,
  profitFactor: 1,
  expectancy: 0,
});

describe("groupBarAriaSummary", () => {
  it("reports an honest empty state", () => {
    expect(groupBarAriaSummary("By symbol", [])).toBe("By symbol: not enough data yet.");
  });

  it("names best and worst groups with signed P&L", () => {
    const s = groupBarAriaSummary("By symbol", [
      stat("NIFTY", 5000, 10),
      stat("BANKNIFTY", -2000, 4),
      stat("RELIANCE", 1000, 1),
    ]);
    expect(s).toContain("3 groups");
    expect(s).toContain("Best: NIFTY at +₹5,000 over 10 trades");
    expect(s).toContain("Worst: BANKNIFTY at -₹2,000 over 4 trades");
  });

  it("singular trade grammar and no worst for a single group", () => {
    const s = groupBarAriaSummary("By segment", [stat("OPT", 1000, 1)]);
    expect(s).toContain("1 group");
    expect(s).toContain("over 1 trade.");
    expect(s).not.toContain("Worst");
  });
});

describe("rHistogramAriaSummary", () => {
  it("empty", () => {
    expect(rHistogramAriaSummary([])).toContain("not enough data");
  });
  it("names the peak bucket and total", () => {
    const s = rHistogramAriaSummary([
      { bucket: "0 to 1", count: 3 },
      { bucket: "1 to 2", count: 7 },
    ]);
    expect(s).toContain("10 trades");
    expect(s).toContain("1 to 2R with 7 trades");
  });
});

describe("equityCurveAriaSummary", () => {
  it("prompts when too few points", () => {
    expect(equityCurveAriaSummary([{ date: "2026-01-01", equity: 0 }])).toContain(
      "log a few trades"
    );
  });
  it("reports end, peak and low with signs", () => {
    const s = equityCurveAriaSummary([
      { date: "2026-01-01", equity: 0 },
      { date: "2026-01-02", equity: 5000 },
      { date: "2026-01-03", equity: -1000 },
    ]);
    expect(s).toContain("2 steps");
    expect(s).toContain("Ends at -₹1,000");
    expect(s).toContain("Peak +₹5,000");
    expect(s).toContain("low -₹1,000");
  });
});

describe("disciplineTrendAriaSummary", () => {
  it("empty", () => {
    expect(disciplineTrendAriaSummary([], null)).toContain("not enough data");
  });
  it("latest score and average", () => {
    const s = disciplineTrendAriaSummary(
      [
        { date: "2026-01-01", score: 80 },
        { date: "2026-01-02", score: 60 },
      ],
      70
    );
    expect(s).toContain("2 days");
    expect(s).toContain("Latest 60");
    expect(s).toContain("Average 70 out of 100");
  });
});

describe("equityConeAriaSummary", () => {
  it("empty", () => {
    expect(equityConeAriaSummary([], 100)).toContain("not enough data");
  });
  it("reports median and percentile band at the horizon", () => {
    const s = equityConeAriaSummary(
      [
        { p5: 100, p50: 100, p95: 100 },
        { p5: 60, p50: 120, p95: 200 },
      ],
      100
    );
    expect(s).toContain("1 trade");
    expect(s).toContain("median 120R");
    expect(s).toContain("5th percentile 60R");
    expect(s).toContain("95th percentile 200R");
    // Fractional values keep one decimal, matching the cone legend.
    const frac = equityConeAriaSummary(
      [
        { p5: 100, p50: 100, p95: 100 },
        { p5: 60.5, p50: 120.25, p95: 200.75 },
      ],
      100
    );
    expect(frac).toContain("median 120.3R");
    expect(frac).toContain("5th percentile 60.5R");
  });
});

describe("payoffAriaSummary", () => {
  it("single breakeven", () => {
    const s = payoffAriaSummary({
      symbol: "NIFTY",
      strategy: "Long Call",
      maxProfit: "Unlimited",
      maxLoss: "-₹5,000",
      breakevens: [25100],
    });
    expect(s).toContain("NIFTY Long Call payoff");
    expect(s).toContain("Max profit Unlimited");
    expect(s).toContain("breakeven at 25,100");
  });
  it("no breakeven and multiple breakevens grammar", () => {
    expect(
      payoffAriaSummary({
        symbol: "X",
        strategy: "Y",
        maxProfit: "a",
        maxLoss: "b",
        breakevens: [],
      })
    ).toContain("no breakeven");
    const s = payoffAriaSummary({
      symbol: "X",
      strategy: "Iron Condor",
      maxProfit: "a",
      maxLoss: "b",
      breakevens: [100, 200],
    });
    expect(s).toContain("breakevens at 100 and 200");
  });
});

describe("statTileAriaValue", () => {
  it("formats currency with sign and locale", () => {
    expect(
      statTileAriaValue(-1234.5, {
        format: { style: "currency", currency: "INR", minimumFractionDigits: 2 },
      })
    ).toBe("-₹1,234.50");
  });
  it("applies suffix and prefix", () => {
    expect(statTileAriaValue(62, { format: { maximumFractionDigits: 0 }, suffix: "%" })).toBe(
      "62%"
    );
  });
});

describe("heatCellAriaLabel", () => {
  const base = { weekday: "Mon", hour: 9, minSample: 5 };
  it("no trades", () => {
    expect(heatCellAriaLabel({ ...base, trades: 0, winRate: 0, netPnl: 0 })).toBe(
      "Mon 09:00: no trades"
    );
  });
  it("below sample", () => {
    expect(heatCellAriaLabel({ ...base, trades: 2, winRate: 0.5, netPnl: 100 })).toContain(
      "only 2 trades, need 5"
    );
  });
  it("full slot with win rate and signed P&L", () => {
    const s = heatCellAriaLabel({ ...base, trades: 8, winRate: 0.625, netPnl: -300 });
    expect(s).toContain("8 trades");
    expect(s).toContain("63% win rate");
    expect(s).toContain("-₹300");
  });
});

describe("calendarCellAriaLabel", () => {
  it("no trades", () => {
    expect(calendarCellAriaLabel("2026-01-15", undefined)).toBe("2026-01-15: no trades");
  });
  it("signed P&L", () => {
    expect(calendarCellAriaLabel("2026-01-15", 4200)).toBe("2026-01-15: +₹4,200");
  });
});
