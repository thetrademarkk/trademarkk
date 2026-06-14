import { describe, it, expect } from "vitest";
import {
  classifyHorizon,
  istCalendarDaysHeld,
  holdingPeriodBuckets,
  horizonMix,
  shouldGateIntradayPanels,
  tradingStyle,
  dashboardEmphasis,
  type HorizonTradeLike,
} from "./horizon";

/** Minimal classifiable trade; override what each test cares about. */
function mk(over: Partial<HorizonTradeLike> = {}): HorizonTradeLike {
  return {
    id: Math.random().toString(36).slice(2),
    net_pnl: 100,
    gross_pnl: 100,
    r_multiple: null,
    opened_at: "2025-06-02T05:00:00.000Z", // 10:30 IST
    closed_at: "2025-06-02T08:00:00.000Z", // 13:30 IST (same IST day)
    status: "closed",
    symbol: "RELIANCE",
    segment: "EQ",
    direction: "long",
    playbook_id: null,
    product: null,
    ...over,
  };
}

describe("istCalendarDaysHeld", () => {
  it("is zero for the same IST day", () => {
    expect(istCalendarDaysHeld("2025-06-02T05:00:00Z", "2025-06-02T08:00:00Z")).toBe(0);
  });
  it("counts whole calendar days across the IST midnight boundary", () => {
    // 2025-06-02 23:00 IST = 17:30Z; 2025-06-03 10:00 IST = 04:30Z next day.
    expect(istCalendarDaysHeld("2025-06-02T17:30:00Z", "2025-06-03T04:30:00Z")).toBe(1);
  });
  it("counts an overnight close after 18:30Z as the next IST day", () => {
    // 2025-03-31 20:00Z = 2025-04-01 01:30 IST → +1 calendar day vs a 2025-03-31 open.
    expect(istCalendarDaysHeld("2025-03-31T05:00:00Z", "2025-03-31T20:00:00Z")).toBe(1);
  });
});

describe("classifyHorizon", () => {
  it("treats a same-IST-day round trip as intraday", () => {
    expect(classifyHorizon(mk())).toBe("intraday");
  });

  it("forces MIS to intraday even when the timestamps span days", () => {
    const t = mk({
      product: "MIS",
      opened_at: "2025-06-02T05:00:00Z",
      closed_at: "2025-06-20T08:00:00Z",
    });
    expect(classifyHorizon(t)).toBe("intraday");
  });

  it("treats overnight CNC delivery as swing, never intraday", () => {
    const t = mk({
      product: "CNC",
      opened_at: "2025-06-02T05:00:00Z",
      closed_at: "2025-06-05T08:00:00Z", // 3 days later
    });
    expect(classifyHorizon(t)).toBe("swing");
  });

  it("treats a CNC trade with same-day timestamps as swing (overnight by product)", () => {
    // Date-only import: both stamped at IST midnight on the same day, but CNC ⇒ held.
    const t = mk({
      product: "CNC",
      opened_at: "2025-06-02T00:00:00Z",
      closed_at: "2025-06-02T00:00:00Z",
    });
    expect(classifyHorizon(t)).toBe("swing");
  });

  it("legacy null-product same-IST-day is intraday", () => {
    const t = mk({
      product: null,
      opened_at: "2025-06-02T04:00:00Z",
      closed_at: "2025-06-02T09:00:00Z",
    });
    expect(classifyHorizon(t)).toBe("intraday");
  });

  it("legacy null-product overnight is swing", () => {
    const t = mk({
      product: null,
      opened_at: "2025-06-02T04:00:00Z",
      closed_at: "2025-06-04T09:00:00Z",
    });
    expect(classifyHorizon(t)).toBe("swing");
  });

  it("exactly 7 calendar days is swing (boundary, inclusive)", () => {
    const t = mk({
      product: "CNC",
      opened_at: "2025-06-02T05:00:00Z",
      closed_at: "2025-06-09T05:00:00Z", // +7 days
    });
    expect(istCalendarDaysHeld(t.opened_at, t.closed_at!)).toBe(7);
    expect(classifyHorizon(t)).toBe("swing");
  });

  it("8 calendar days crosses into positional (boundary, exclusive)", () => {
    const t = mk({
      product: "CNC",
      opened_at: "2025-06-02T05:00:00Z",
      closed_at: "2025-06-10T05:00:00Z", // +8 days
    });
    expect(istCalendarDaysHeld(t.opened_at, t.closed_at!)).toBe(8);
    expect(classifyHorizon(t)).toBe("positional");
  });

  it("NRML carry held over a week is positional", () => {
    const t = mk({
      segment: "FUT",
      product: "NRML",
      opened_at: "2025-06-02T05:00:00Z",
      closed_at: "2025-06-20T05:00:00Z",
    });
    expect(classifyHorizon(t)).toBe("positional");
  });

  it("an open trade (no close) has no horizon", () => {
    expect(classifyHorizon(mk({ status: "open", closed_at: null }))).toBeNull();
  });
});

describe("holdingPeriodBuckets", () => {
  it("aggregates count, net P&L and win rate per horizon and gates at MIN_SAMPLE", () => {
    const trades: HorizonTradeLike[] = [
      // 6 intraday: 4 wins (+100 each), 2 losses (−50 each) → net 300, win 4/6
      ...Array.from({ length: 4 }, () => mk({ product: "MIS", net_pnl: 100 })),
      ...Array.from({ length: 2 }, () => mk({ product: "MIS", net_pnl: -50 })),
      // 2 swing (below MIN_SAMPLE)
      ...Array.from({ length: 2 }, () =>
        mk({
          product: "CNC",
          net_pnl: 200,
          opened_at: "2025-06-02T05:00:00Z",
          closed_at: "2025-06-05T05:00:00Z",
        })
      ),
    ];
    const buckets = holdingPeriodBuckets(trades);
    const intraday = buckets.find((b) => b.horizon === "intraday")!;
    const swing = buckets.find((b) => b.horizon === "swing")!;
    expect(intraday.trades).toBe(6);
    expect(intraday.netPnl).toBe(300);
    expect(intraday.winRate).toBeCloseTo(4 / 6, 5);
    expect(intraday.enough).toBe(true);
    expect(swing.trades).toBe(2);
    expect(swing.enough).toBe(false); // below MIN_SAMPLE → flagged, not signal
  });

  it("returns buckets in intraday → swing → positional order", () => {
    const trades: HorizonTradeLike[] = [
      mk({
        product: "CNC",
        opened_at: "2025-06-02T05:00:00Z",
        closed_at: "2025-06-20T05:00:00Z",
      }), // positional
      mk({ product: "MIS" }), // intraday
      mk({
        product: "CNC",
        opened_at: "2025-06-02T05:00:00Z",
        closed_at: "2025-06-04T05:00:00Z",
      }), // swing
    ];
    expect(holdingPeriodBuckets(trades).map((b) => b.horizon)).toEqual([
      "intraday",
      "swing",
      "positional",
    ]);
  });

  it("drops empty buckets and open trades", () => {
    const trades: HorizonTradeLike[] = [
      mk({ product: "MIS" }),
      mk({ status: "open", closed_at: null }),
    ];
    const buckets = holdingPeriodBuckets(trades);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.horizon).toBe("intraday");
    expect(buckets[0]!.trades).toBe(1);
  });
});

describe("horizonMix + shouldGateIntradayPanels", () => {
  it("computes fractions that sum to 1", () => {
    const trades: HorizonTradeLike[] = [
      ...Array.from({ length: 7 }, () =>
        mk({
          product: "CNC",
          opened_at: "2025-06-02T05:00:00Z",
          closed_at: "2025-06-20T05:00:00Z",
        })
      ), // positional
      ...Array.from({ length: 3 }, () => mk({ product: "MIS" })), // intraday
    ];
    const mix = horizonMix(trades);
    expect(mix.total).toBe(10);
    expect(mix.positionalPct).toBeCloseTo(0.7, 5);
    expect(mix.intradayPct).toBeCloseTo(0.3, 5);
    expect(mix.multiDayPct).toBeCloseTo(0.7, 5);
  });

  it("gates the intraday panels when multi-day ≥ 70% of a meaningful sample", () => {
    const trades: HorizonTradeLike[] = [
      ...Array.from({ length: 7 }, () =>
        mk({
          product: "CNC",
          opened_at: "2025-06-02T05:00:00Z",
          closed_at: "2025-06-20T05:00:00Z",
        })
      ),
      ...Array.from({ length: 3 }, () => mk({ product: "MIS" })),
    ];
    expect(shouldGateIntradayPanels(horizonMix(trades))).toBe(true);
  });

  it("does NOT gate a predominantly intraday book", () => {
    const trades: HorizonTradeLike[] = [
      ...Array.from({ length: 8 }, () => mk({ product: "MIS" })),
      ...Array.from({ length: 2 }, () =>
        mk({
          product: "CNC",
          opened_at: "2025-06-02T05:00:00Z",
          closed_at: "2025-06-20T05:00:00Z",
        })
      ),
    ];
    expect(shouldGateIntradayPanels(horizonMix(trades))).toBe(false);
  });

  it("never gates a thin journal (< GATE_MIN_TRADES classifiable trades)", () => {
    const trades: HorizonTradeLike[] = [
      mk({
        product: "CNC",
        opened_at: "2025-06-02T05:00:00Z",
        closed_at: "2025-06-20T05:00:00Z",
      }),
      mk({
        product: "CNC",
        opened_at: "2025-06-02T05:00:00Z",
        closed_at: "2025-06-20T05:00:00Z",
      }),
    ];
    // 100% multi-day but only 2 trades → too little data to judge → no gating.
    expect(shouldGateIntradayPanels(horizonMix(trades))).toBe(false);
  });
});

describe("tradingStyle", () => {
  it("calls a 68%-positional book 'Mostly positional'", () => {
    const trades: HorizonTradeLike[] = [
      ...Array.from({ length: 68 }, () =>
        mk({
          product: "CNC",
          opened_at: "2025-06-02T05:00:00Z",
          closed_at: "2025-06-20T05:00:00Z",
        })
      ),
      ...Array.from({ length: 32 }, () => mk({ product: "MIS" })),
    ];
    const style = tradingStyle(trades);
    expect(style.dominant).toBe("positional");
    expect(style.pct).toBe(68);
    expect(style.summary).toContain("Mostly positional");
    expect(style.summary).toContain("68%");
  });

  it("calls an even spread 'Mixed style'", () => {
    const trades: HorizonTradeLike[] = [
      ...Array.from({ length: 4 }, () => mk({ product: "MIS" })),
      ...Array.from({ length: 3 }, () =>
        mk({
          product: "CNC",
          opened_at: "2025-06-02T05:00:00Z",
          closed_at: "2025-06-04T05:00:00Z",
        })
      ),
      ...Array.from({ length: 3 }, () =>
        mk({
          product: "CNC",
          opened_at: "2025-06-02T05:00:00Z",
          closed_at: "2025-06-20T05:00:00Z",
        })
      ),
    ];
    expect(tradingStyle(trades).summary).toContain("Mixed style");
  });

  it("has a neutral empty-state summary with no data", () => {
    const style = tradingStyle([]);
    expect(style.dominant).toBeNull();
    expect(style.summary).toContain("Not enough");
  });
});

describe("dashboardEmphasis", () => {
  const positional = (n: number) =>
    Array.from({ length: n }, () =>
      mk({ product: "CNC", opened_at: "2025-06-02T05:00:00Z", closed_at: "2025-06-20T05:00:00Z" })
    );
  const intraday = (n: number) => Array.from({ length: n }, () => mk({ product: "MIS" }));

  it("leans positional when multi-day ≥ 70% of a meaningful sample", () => {
    expect(dashboardEmphasis(horizonMix([...positional(7), ...intraday(3)]))).toBe("positional");
  });

  it("leans intraday when same-day ≥ 70% of a meaningful sample", () => {
    expect(dashboardEmphasis(horizonMix([...intraday(8), ...positional(2)]))).toBe("intraday");
  });

  it("stays balanced for a mixed book (neither side dominant)", () => {
    expect(dashboardEmphasis(horizonMix([...intraday(5), ...positional(5)]))).toBe("balanced");
  });

  it("stays balanced for a thin journal (< GATE_MIN_TRADES) — never hides anything", () => {
    // 100% positional but only 3 closed trades → too little data to adapt.
    expect(dashboardEmphasis(horizonMix(positional(3)))).toBe("balanced");
  });

  it("is balanced with no data", () => {
    expect(dashboardEmphasis(horizonMix([]))).toBe("balanced");
  });
});
