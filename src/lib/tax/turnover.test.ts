import { describe, expect, it } from "vitest";
import {
  chargesBreakdown,
  classifyTrade,
  fnoTurnover,
  fyTaxSummary,
  isFno,
  realisedPnlByInstrument,
  speculativeSplit,
  tradeTurnover,
  type TaxTrade,
} from "./turnover";

let seq = 0;
function mk(over: Partial<TaxTrade> = {}): TaxTrade {
  seq++;
  return {
    id: `t${seq}`,
    account_id: "acc1",
    symbol: "NIFTY",
    segment: "OPT",
    direction: "long",
    qty: 75,
    avg_entry: 100,
    avg_exit: 120,
    opened_at: "2025-06-10T04:00:00Z",
    closed_at: "2025-06-10T09:00:00Z",
    gross_pnl: 1500,
    charges: 50,
    net_pnl: 1450,
    ...over,
  };
}

describe("classifyTrade", () => {
  it("intraday equity (same IST day) is speculative", () => {
    const t = mk({
      segment: "EQ",
      opened_at: "2025-06-10T04:00:00Z",
      closed_at: "2025-06-10T09:00:00Z",
    });
    expect(classifyTrade(t)).toBe("speculative");
  });

  it("delivery equity (overnight) is non-speculative", () => {
    const t = mk({
      segment: "EQ",
      opened_at: "2025-06-10T04:00:00Z",
      closed_at: "2025-06-11T09:00:00Z",
    });
    expect(classifyTrade(t)).toBe("non-speculative");
  });

  it("same-day EQ detection respects the IST boundary", () => {
    // Opened 2025-06-10 19:00 UTC = 2025-06-11 00:30 IST; closed 2025-06-11 05:00 UTC
    // = 2025-06-11 10:30 IST → same IST day even though UTC dates differ.
    const t = mk({
      segment: "EQ",
      opened_at: "2025-06-10T19:00:00Z",
      closed_at: "2025-06-11T05:00:00Z",
    });
    expect(classifyTrade(t)).toBe("speculative");
  });

  it("futures and options are always non-speculative", () => {
    expect(classifyTrade(mk({ segment: "FUT" }))).toBe("non-speculative");
    expect(classifyTrade(mk({ segment: "OPT" }))).toBe("non-speculative");
  });

  it("open equity (no close) defaults to non-speculative (delivery)", () => {
    expect(classifyTrade(mk({ segment: "EQ", closed_at: null }))).toBe("non-speculative");
  });
});

describe("isFno", () => {
  it("flags FUT and OPT only", () => {
    expect(isFno(mk({ segment: "FUT" }))).toBe(true);
    expect(isFno(mk({ segment: "OPT" }))).toBe(true);
    expect(isFno(mk({ segment: "EQ" }))).toBe(false);
  });
});

describe("tradeTurnover", () => {
  it("computes buy/sell/notional for a long round trip", () => {
    const tt = tradeTurnover(mk({ direction: "long", avg_entry: 100, avg_exit: 120, qty: 75 }));
    expect(tt.buy).toBe(7500); // 100 * 75
    expect(tt.sell).toBe(9000); // 120 * 75
    expect(tt.notional).toBe(16500);
  });

  it("swaps buy/sell for a short round trip", () => {
    const tt = tradeTurnover(mk({ direction: "short", avg_entry: 120, avg_exit: 100, qty: 75 }));
    // short sells first at entry (120), buys back at exit (100)
    expect(tt.sell).toBe(9000);
    expect(tt.buy).toBe(7500);
  });

  it("uses entry as exit when the trade is still open", () => {
    const tt = tradeTurnover(mk({ avg_exit: null, avg_entry: 100, qty: 50 }));
    expect(tt.buy).toBe(5000);
    expect(tt.sell).toBe(5000);
  });
});

describe("fnoTurnover (absolute-profit convention)", () => {
  it("sums absolute settlements and notional turnover, ignoring equity", () => {
    const trades = [
      mk({ segment: "OPT", net_pnl: 1000, avg_entry: 100, avg_exit: 110, qty: 50 }), // +1000
      mk({ segment: "FUT", net_pnl: -400, avg_entry: 200, avg_exit: 190, qty: 25 }), // -400
      mk({ segment: "EQ", net_pnl: 9999 }), // excluded
    ];
    const s = fnoTurnover(trades);
    expect(s.trades).toBe(2);
    expect(s.totalProfit).toBe(1000);
    expect(s.totalLoss).toBe(400);
    expect(s.absoluteProfitTurnover).toBe(1400); // |+1000| + |-400|
    expect(s.netRealised).toBe(600);
    // notional: OPT 100*50 + 110*50 = 10500; FUT 200*25 + 190*25 = 9750
    expect(s.notionalTurnover).toBe(20250);
  });

  it("returns zeros for no F&O trades", () => {
    const s = fnoTurnover([mk({ segment: "EQ" })]);
    expect(s).toMatchObject({ trades: 0, absoluteProfitTurnover: 0, notionalTurnover: 0 });
  });

  it("keeps paise precision (no premature rounding)", () => {
    const s = fnoTurnover([
      mk({ segment: "OPT", net_pnl: 100.05 }),
      mk({ segment: "OPT", net_pnl: -0.05 }),
    ]);
    expect(s.absoluteProfitTurnover).toBe(100.1);
    expect(s.netRealised).toBe(100);
  });
});

describe("speculativeSplit", () => {
  it("splits intraday EQ from F&O and delivery EQ", () => {
    const trades = [
      mk({
        segment: "EQ",
        opened_at: "2025-06-10T04:00:00Z",
        closed_at: "2025-06-10T09:00:00Z",
        net_pnl: 500,
        gross_pnl: 550,
        charges: 50,
      }),
      mk({
        segment: "EQ",
        opened_at: "2025-06-10T04:00:00Z",
        closed_at: "2025-06-12T09:00:00Z",
        net_pnl: -200,
        gross_pnl: -150,
        charges: 50,
      }),
      mk({ segment: "OPT", net_pnl: 300, gross_pnl: 350, charges: 50 }),
    ];
    const { speculative, nonSpeculative } = speculativeSplit(trades);
    expect(speculative.trades).toBe(1);
    expect(speculative.netPnl).toBe(500);
    expect(speculative.turnover).toBe(500);
    expect(nonSpeculative.trades).toBe(2);
    expect(nonSpeculative.netPnl).toBe(100); // -200 + 300
    expect(nonSpeculative.turnover).toBe(500); // |−200| + |300|
  });

  it("always returns both buckets, even empty", () => {
    const { speculative, nonSpeculative } = speculativeSplit([]);
    expect(speculative.trades).toBe(0);
    expect(nonSpeculative.trades).toBe(0);
  });
});

describe("chargesBreakdown", () => {
  const profileFor = () => "zerodha";

  it("derives components, scales to the stored aggregate, and flags estimated", () => {
    const trades = [
      mk({ segment: "OPT", avg_entry: 100, avg_exit: 120, qty: 75, charges: 50 }),
      mk({ segment: "FUT", avg_entry: 20000, avg_exit: 20100, qty: 25, charges: 40 }),
    ];
    const b = chargesBreakdown(trades, profileFor);
    expect(b.estimated).toBe(true);
    expect(b.actualTotal).toBe(90); // honest stored aggregate (50 + 40)
    // Scaled components must sum (within paise) to the stored aggregate.
    const sum = b.brokerage + b.stt + b.exchange + b.sebi + b.gst + b.stampDuty + b.dpCharge;
    expect(Math.abs(sum - b.actualTotal)).toBeLessThan(0.05);
    // Every component is non-negative.
    for (const v of [b.brokerage, b.stt, b.exchange, b.sebi, b.gst, b.stampDuty, b.dpCharge]) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("surfaces a DP-charge component for equity-delivery (CNC) trades", () => {
    const trades = [
      mk({ segment: "EQ", product: "CNC", avg_entry: 500, avg_exit: 510, qty: 100, charges: 130 }),
    ];
    const b = chargesBreakdown(trades, profileFor);
    expect(b.dpCharge).toBeGreaterThan(0);
    const sum = b.brokerage + b.stt + b.exchange + b.sebi + b.gst + b.stampDuty + b.dpCharge;
    expect(Math.abs(sum - b.actualTotal)).toBeLessThan(0.05);
  });

  it("handles zero charges without dividing by zero", () => {
    const b = chargesBreakdown(
      [mk({ charges: 0, avg_entry: 0, avg_exit: 0, qty: 0 })],
      () => "zero"
    );
    expect(b.actualTotal).toBe(0);
    expect(b.brokerage).toBe(0);
  });
});

describe("realisedPnlByInstrument", () => {
  it("groups by symbol+segment with cost basis and proceeds", () => {
    const rows = realisedPnlByInstrument([
      mk({
        symbol: "NIFTY",
        segment: "OPT",
        avg_entry: 100,
        avg_exit: 120,
        qty: 50,
        gross_pnl: 1000,
        charges: 30,
        net_pnl: 970,
      }),
      mk({
        symbol: "NIFTY",
        segment: "OPT",
        avg_entry: 100,
        avg_exit: 90,
        qty: 50,
        gross_pnl: -500,
        charges: 30,
        net_pnl: -530,
      }),
      mk({
        symbol: "BANKNIFTY",
        segment: "FUT",
        avg_entry: 50000,
        avg_exit: 50200,
        qty: 15,
        gross_pnl: 3000,
        charges: 60,
        net_pnl: 2940,
      }),
    ]);
    expect(rows).toHaveLength(2);
    const nifty = rows.find((r) => r.symbol === "NIFTY")!;
    expect(nifty.trades).toBe(2);
    expect(nifty.netPnl).toBe(440); // 970 - 530
    expect(nifty.buyValue).toBe(10000); // 100*50 + 100*50
    expect(nifty.sellValue).toBe(10500); // 120*50 + 90*50
    // Sorted net P&L desc: BANKNIFTY (2940) before NIFTY (440).
    expect(rows[0]!.symbol).toBe("BANKNIFTY");
  });
});

describe("fyTaxSummary", () => {
  it("rolls up totals, drag, turnover, split and instruments", () => {
    const trades = [
      mk({ segment: "OPT", gross_pnl: 1000, charges: 100, net_pnl: 900 }),
      mk({
        segment: "EQ",
        opened_at: "2025-06-10T04:00:00Z",
        closed_at: "2025-06-10T09:00:00Z",
        gross_pnl: 500,
        charges: 50,
        net_pnl: 450,
      }),
    ];
    const s = fyTaxSummary(trades);
    expect(s.trades).toBe(2);
    expect(s.grossPnl).toBe(1500);
    expect(s.charges).toBe(150);
    expect(s.netPnl).toBe(1350);
    expect(s.chargeDragPct).toBeCloseTo(150 / 1500, 6);
    expect(s.turnover.trades).toBe(1); // only the OPT trade is F&O
    expect(s.split.speculative.trades).toBe(1);
    expect(s.split.nonSpeculative.trades).toBe(1);
    expect(s.byInstrument).toHaveLength(2);
  });

  it("reports zero drag when gross is zero", () => {
    const s = fyTaxSummary([mk({ gross_pnl: 0, net_pnl: -10, charges: 10 })]);
    expect(s.chargeDragPct).toBe(0);
  });
});
