import { describe, expect, it } from "vitest";
import {
  byExpiryDay,
  byHourOfDay,
  byWeekday,
  dailyPnl,
  dayTimeHeatmap,
  equityCurve,
  expectancy,
  maxDrawdown,
  netPnl,
  profitFactor,
  rHistogram,
  streaks,
  winRate,
  withStartBaseline,
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
  it("withStartBaseline prepends a zero point the day before the first trade", () => {
    // Two trades on the same day — a brand-new user's first session must still chart.
    const curve = withStartBaseline(
      equityCurve([t(-15841, "2026-06-12T10:00:00Z"), t(-2005, "2026-06-12T11:00:00Z")])
    );
    expect(curve).toEqual([
      { date: "2026-06-11", equity: 0, pnl: 0 },
      { date: "2026-06-12", equity: -17846, pnl: -17846 },
    ]);
  });
  it("withStartBaseline handles month boundaries", () => {
    const curve = withStartBaseline(equityCurve([t(100, "2024-03-01T10:00:00Z")]));
    expect(curve[0]).toEqual({ date: "2024-02-29", equity: 0, pnl: 0 });
  });
  it("withStartBaseline leaves an empty curve empty", () => {
    expect(withStartBaseline([])).toEqual([]);
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

/** Build a trade with independent open/close instants for IST bucketing tests. */
const tt = (
  net: number,
  openedAt: string,
  closedAt: string,
  extra: Partial<TradeLike & { expiry?: string | null }> = {}
): TradeLike & { expiry?: string | null } => ({
  id: Math.random().toString(36),
  net_pnl: net,
  gross_pnl: net,
  r_multiple: null,
  opened_at: openedAt,
  closed_at: closedAt,
  status: "closed",
  symbol: "NIFTY",
  segment: "OPT",
  direction: "long",
  playbook_id: null,
  ...extra,
});

describe("dailyPnl — IST calendar bucketing (CORR-03)", () => {
  it("buckets a 00:00–05:30 IST close on the IST date, not the UTC date", () => {
    // 2026-06-09T20:00:00Z = 2026-06-10 01:30 IST → must land on 2026-06-10.
    const map = dailyPnl([tt(500, "2026-06-09T20:00:00Z", "2026-06-09T20:00:00Z")]);
    expect(map.get("2026-06-10")).toBe(500);
    expect(map.has("2026-06-09")).toBe(false);
  });

  it("two closes either side of UTC midnight but the same IST day merge into one IST day", () => {
    // Both are 2026-06-10 IST: 19:00Z = 00:30 IST(+1d), 23:59Z = 05:29 IST(+1d).
    const map = dailyPnl([
      tt(100, "2026-06-09T19:00:00Z", "2026-06-09T19:00:00Z"),
      tt(200, "2026-06-09T23:59:00Z", "2026-06-09T23:59:00Z"),
    ]);
    expect(map.get("2026-06-10")).toBe(300);
    expect(map.size).toBe(1);
  });

  it("equityCurve inherits IST bucketing", () => {
    const curve = equityCurve([tt(750, "2026-06-09T20:00:00Z", "2026-06-09T20:00:00Z")]);
    expect(curve).toEqual([{ date: "2026-06-10", equity: 750, pnl: 750 }]);
  });
});

describe("entry-time buckets — IST (CORR-04)", () => {
  it("byHourOfDay buckets the IST entry hour, not UTC/local", () => {
    // 04:00:00Z = 09:30 IST (a real market hour); UTC hour would be 04:00.
    const rows = byHourOfDay([tt(100, "2026-06-10T04:00:00Z", "2026-06-10T05:00:00Z")]);
    expect(rows.map((r) => r.key)).toEqual(["09:00"]);
  });

  it("byWeekday rolls a late-UTC entry into the next IST weekday", () => {
    // 2026-06-09 is a Tuesday. 21:00Z = 2026-06-10 02:30 IST → Wednesday.
    const rows = byWeekday([tt(100, "2026-06-09T21:00:00Z", "2026-06-09T22:00:00Z")]);
    expect(rows.map((r) => r.key)).toEqual(["Wed"]);
  });

  it("byExpiryDay compares expiry against the IST entry date", () => {
    // Entry 2026-06-09T21:00:00Z = 2026-06-10 IST; expiry 2026-06-10 → expiry day.
    const rows = byExpiryDay([
      tt(100, "2026-06-09T21:00:00Z", "2026-06-09T22:00:00Z", { expiry: "2026-06-10" }),
    ]);
    expect(rows[0]?.key).toBe("Expiry day");
  });

  it("dayTimeHeatmap cells are on the IST weekday × IST hour", () => {
    // 2026-06-09 Tue 21:00Z = 2026-06-10 Wed 02:30 IST → weekday 3 (Wed), hour 2.
    const cells = dayTimeHeatmap([tt(100, "2026-06-09T21:00:00Z", "2026-06-09T22:00:00Z")]);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ weekday: 3, hour: 2 });
  });
});
