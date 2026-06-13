import { describe, it, expect } from "vitest";
import { isOpen, openPositions, openPositionsSummary, type OpenTradeLike } from "./open-positions";

/** Minimal trade; override what each test cares about. */
function mk(over: Partial<OpenTradeLike> = {}): OpenTradeLike {
  return {
    id: Math.random().toString(36).slice(2),
    net_pnl: 0,
    gross_pnl: 0,
    r_multiple: null,
    opened_at: "2025-06-02T05:00:00.000Z",
    closed_at: null,
    status: "open",
    symbol: "RELIANCE",
    segment: "EQ",
    direction: "long",
    playbook_id: null,
    qty: 10,
    avg_entry: 100,
    product: "CNC",
    ...over,
  };
}

const NOW = new Date("2025-06-12T08:00:00.000Z"); // 13:30 IST on 12 Jun

describe("isOpen", () => {
  it("is true for status open or a missing close date", () => {
    expect(isOpen({ status: "open", closed_at: null })).toBe(true);
    expect(isOpen({ status: "closed", closed_at: null })).toBe(true);
  });
  it("is false for a realised (closed-with-date) trade", () => {
    expect(isOpen({ status: "closed", closed_at: "2025-06-02T08:00:00Z" })).toBe(false);
  });
});

describe("openPositions days-held", () => {
  it("counts IST calendar days a still-open position has been held", () => {
    // Opened 2 Jun, now 12 Jun → 10 calendar days.
    const p = openPositions([mk({ opened_at: "2025-06-02T05:00:00Z" })], NOW);
    expect(p).toHaveLength(1);
    expect(p[0]!.daysHeld).toBe(10);
  });

  it("is zero for a position opened today", () => {
    const p = openPositions([mk({ opened_at: "2025-06-12T04:00:00Z" })], NOW);
    expect(p[0]!.daysHeld).toBe(0);
  });

  it("excludes realised trades and keeps only the open ones", () => {
    const trades = [
      mk({ id: "open1", opened_at: "2025-06-10T05:00:00Z" }),
      mk({ id: "closed1", status: "closed", closed_at: "2025-06-11T08:00:00Z" }),
    ];
    const p = openPositions(trades, NOW);
    expect(p.map((x) => x.id)).toEqual(["open1"]);
  });

  it("sorts longest-held first", () => {
    const trades = [
      mk({ id: "young", opened_at: "2025-06-11T05:00:00Z" }), // 1 day
      mk({ id: "old", opened_at: "2025-06-02T05:00:00Z" }), // 10 days
    ];
    expect(openPositions(trades, NOW).map((x) => x.id)).toEqual(["old", "young"]);
  });

  it("computes cost-basis exposure = |qty × avg entry| (paise-correct, never marked)", () => {
    const p = openPositions([mk({ qty: 7, avg_entry: 123.45 })], NOW);
    // 7 × 123.45 = 864.15 exactly — no rounding.
    expect(p[0]!.exposure).toBeCloseTo(864.15, 10);
  });
});

describe("openPositionsSummary", () => {
  it("is all-zero when there are no open positions", () => {
    const closed = mk({ status: "closed", closed_at: "2025-06-05T08:00:00Z" });
    expect(openPositionsSummary([closed], NOW)).toEqual({
      count: 0,
      totalExposure: 0,
      maxDaysHeld: 0,
      avgDaysHeld: 0,
      overWeek: 0,
    });
  });

  it("rolls up count, exposure, max/avg days held and the over-a-week tally", () => {
    const trades = [
      mk({ opened_at: "2025-06-02T05:00:00Z", qty: 10, avg_entry: 100 }), // 10 days, ₹1000
      mk({ opened_at: "2025-06-04T05:00:00Z", qty: 5, avg_entry: 200 }), // 8 days, ₹1000
      mk({ opened_at: "2025-06-11T05:00:00Z", qty: 2, avg_entry: 50 }), // 1 day, ₹100
    ];
    const s = openPositionsSummary(trades, NOW);
    expect(s.count).toBe(3);
    expect(s.totalExposure).toBeCloseTo(2100, 10);
    expect(s.maxDaysHeld).toBe(10);
    expect(s.avgDaysHeld).toBe(Math.round((10 + 8 + 1) / 3)); // 6
    expect(s.overWeek).toBe(2); // 10d and 8d are > 7
  });
});
