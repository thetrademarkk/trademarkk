import { describe, it, expect } from "vitest";
import { spanCoverage, spanMonthSummary } from "./position-spans";
import { dailyPnl } from "@/lib/stats/stats";
import type { HorizonTradeLike } from "@/lib/stats/horizon";

function mk(over: Partial<HorizonTradeLike> = {}): HorizonTradeLike {
  return {
    id: Math.random().toString(36).slice(2),
    net_pnl: 0,
    gross_pnl: 0,
    r_multiple: null,
    opened_at: "2025-06-02T05:00:00.000Z",
    closed_at: "2025-06-05T08:00:00.000Z",
    status: "closed",
    symbol: "RELIANCE",
    segment: "EQ",
    direction: "long",
    playbook_id: null,
    product: "CNC",
    ...over,
  };
}

const NOW = new Date("2025-06-12T08:00:00.000Z"); // 13:30 IST on 12 Jun

describe("spanCoverage — closed multi-day trade", () => {
  it("marks every IST day from open to close inclusive as held", () => {
    // Opened 2 Jun, closed 5 Jun → days 2,3,4,5 are held.
    const cov = spanCoverage(
      [mk({ opened_at: "2025-06-02T05:00:00Z", closed_at: "2025-06-05T08:00:00Z" })],
      NOW
    );
    expect(cov.get("2025-06-02")?.held).toBe(1);
    expect(cov.get("2025-06-03")?.held).toBe(1);
    expect(cov.get("2025-06-04")?.held).toBe(1);
    expect(cov.get("2025-06-05")?.held).toBe(1);
    expect(cov.get("2025-06-06")).toBeUndefined();
    expect(cov.get("2025-06-01")).toBeUndefined();
  });

  it("does NOT span an intraday round-trip (single IST day)", () => {
    const cov = spanCoverage(
      [
        mk({
          product: "MIS",
          opened_at: "2025-06-02T05:00:00Z",
          closed_at: "2025-06-02T08:00:00Z",
        }),
      ],
      NOW
    );
    expect(cov.size).toBe(0);
  });

  it("spans a hold that crosses a MONTH boundary", () => {
    // Opened 28 Jun, closed 2 Jul → 28,29,30 Jun + 1,2 Jul all held.
    const cov = spanCoverage(
      [mk({ opened_at: "2025-06-28T05:00:00Z", closed_at: "2025-07-02T08:00:00Z" })],
      NOW
    );
    for (const d of ["2025-06-28", "2025-06-29", "2025-06-30", "2025-07-01", "2025-07-02"]) {
      expect(cov.get(d)?.held).toBe(1);
    }
    // The month summary splits the same span across two months.
    expect(spanMonthSummary(cov, 2025, 5).heldDays).toBe(3); // June (0-based month 5)
    expect(spanMonthSummary(cov, 2025, 6).heldDays).toBe(2); // July
  });

  it("counts overlapping holds (two positions live the same day)", () => {
    const cov = spanCoverage(
      [
        mk({ opened_at: "2025-06-02T05:00:00Z", closed_at: "2025-06-04T08:00:00Z" }),
        mk({ opened_at: "2025-06-03T05:00:00Z", closed_at: "2025-06-06T08:00:00Z" }),
      ],
      NOW
    );
    expect(cov.get("2025-06-03")?.held).toBe(2);
  });
});

describe("spanCoverage — open positions", () => {
  it("marks open → today inclusive as open (not held)", () => {
    const cov = spanCoverage(
      [mk({ status: "open", closed_at: null, opened_at: "2025-06-10T05:00:00Z" })],
      NOW
    );
    expect(cov.get("2025-06-10")?.open).toBe(1);
    expect(cov.get("2025-06-11")?.open).toBe(1);
    expect(cov.get("2025-06-12")?.open).toBe(1); // today
    expect(cov.get("2025-06-13")).toBeUndefined(); // future
    // Open spans use the `open` channel, never `held`.
    expect(cov.get("2025-06-10")?.held).toBe(0);
  });

  it("an open position opened today marks just today", () => {
    const cov = spanCoverage(
      [mk({ status: "open", closed_at: null, opened_at: "2025-06-12T04:00:00Z" })],
      NOW
    );
    expect(cov.get("2025-06-12")?.open).toBe(1);
    expect(cov.size).toBe(1);
  });
});

describe("no P&L double-count", () => {
  it("dailyPnl lands ONLY on the close day even though the span covers many days", () => {
    const trade = mk({
      opened_at: "2025-06-02T05:00:00Z",
      closed_at: "2025-06-05T08:00:00Z",
      net_pnl: 5000,
      status: "closed",
    });
    const cov = spanCoverage([trade], NOW);
    const pnl = dailyPnl([trade]);
    // Span marks 4 days …
    expect([...cov.keys()].filter((k) => cov.get(k)!.held > 0)).toHaveLength(4);
    // … but the ₹5000 P&L is attributed to a single day (the close), once.
    expect([...pnl.values()].reduce((s, v) => s + v, 0)).toBe(5000);
    expect(pnl.size).toBe(1);
    expect(pnl.get("2025-06-05")).toBe(5000);
  });

  it("spanCoverage carries no money — it is a pure hold indicator", () => {
    const cov = spanCoverage([mk()], NOW);
    for (const v of cov.values()) {
      expect(Object.keys(v).sort()).toEqual(["held", "open"]);
    }
  });
});
