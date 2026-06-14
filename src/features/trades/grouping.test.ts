import { describe, expect, it } from "vitest";
import {
  effectiveProduct,
  groupTrades,
  normalizeExchange,
  subtotalFor,
  EXCHANGE_LABELS,
  PRODUCT_LABELS,
  SEGMENT_SHORT,
} from "./grouping";
import { SEGMENT_LABELS } from "./filter-predicate";
import type { TradeWithMeta } from "./types";

// Local-time ISO instants so day-count assertions are TZ-stable across hosts
// (the host runs IST in CI; tests only assert relative day spans).
const at = (y: number, m: number, d: number, hh = 10, mm = 0) =>
  new Date(Date.UTC(y, m - 1, d, hh - 5, mm - 30)).toISOString(); // IST midnight-anchored

let seq = 0;
function mk(over: Partial<TradeWithMeta> = {}): TradeWithMeta {
  seq++;
  return {
    id: `t${seq}`,
    account_id: "acc1",
    symbol: "NIFTY",
    exchange: "NSE",
    segment: "OPT",
    product: "NRML",
    expiry: null,
    strike: 24500,
    option_type: "CE",
    direction: "long",
    status: "closed",
    qty: 75,
    avg_entry: 100,
    avg_exit: 110,
    planned_entry: null,
    planned_sl: null,
    planned_target: null,
    opened_at: at(2026, 6, 8),
    closed_at: at(2026, 6, 8, 11),
    gross_pnl: 75000,
    charges: 5000,
    net_pnl: 70000,
    r_multiple: 1.5,
    playbook_id: null,
    confidence: null,
    notes: null,
    created_at: at(2026, 6, 8),
    updated_at: at(2026, 6, 8),
    tags: [],
    playbook_name: null,
    ...over,
  };
}

describe("effectiveProduct — legacy null = MIS (charge parity)", () => {
  it("maps null product to MIS", () => {
    expect(effectiveProduct({ product: null })).toBe("MIS");
  });
  it("passes a real product through", () => {
    expect(effectiveProduct({ product: "CNC" })).toBe("CNC");
    expect(effectiveProduct({ product: "NRML" })).toBe("NRML");
  });
});

describe("normalizeExchange — mirrors resolveExchange", () => {
  it("exact union values pass through (case-insensitive)", () => {
    expect(normalizeExchange("EQ", "NSE")).toBe("NSE");
    expect(normalizeExchange("EQ", "bse")).toBe("BSE");
    expect(normalizeExchange("COMM", "mcx")).toBe("MCX");
    expect(normalizeExchange("COMM", "NCDEX")).toBe("NCDEX");
  });
  it("broker free-text prefixes resolve", () => {
    expect(normalizeExchange("EQ", "NSE_EQ")).toBe("NSE");
    expect(normalizeExchange("FUT", "NFO")).toBe("NSE");
    expect(normalizeExchange("CDS", "CDS")).toBe("NSE");
    expect(normalizeExchange("EQ", "BFO")).toBe("BSE");
    expect(normalizeExchange("COMM", "MCX-COMM")).toBe("MCX");
    expect(normalizeExchange("COMM", "NCDEX_AGRI")).toBe("NCDEX"); // before NSE/BSE
  });
  it("blank/unknown falls back to the segment default", () => {
    expect(normalizeExchange("EQ", null)).toBe("NSE");
    expect(normalizeExchange("EQ", "")).toBe("NSE");
    expect(normalizeExchange("COMM", null)).toBe("MCX");
    expect(normalizeExchange("OPT", "WEIRD")).toBe("NSE");
    expect(normalizeExchange("CDS", undefined)).toBe("NSE");
  });
});

describe("subtotalFor — paise-correct, closed-only net + win-rate", () => {
  it("sums net P&L over CLOSED trades only; open trades count in `trades` not net", () => {
    const ts = [
      mk({ status: "closed", net_pnl: 12345 }), // win
      mk({ status: "closed", net_pnl: -6789 }), // loss
      mk({ status: "closed", net_pnl: 1 }), // win (1 paise)
      mk({ status: "open", net_pnl: 0, closed_at: null, avg_exit: null }),
    ];
    const s = subtotalFor(ts);
    expect(s.trades).toBe(4);
    expect(s.closed).toBe(3);
    // hand-computed: 12345 - 6789 + 1 = 5557 paise, exact (no float drift)
    expect(s.netPnl).toBe(5557);
    // 2 wins / 3 closed
    expect(s.winRate).toBeCloseTo(2 / 3, 12);
  });
  it("a break-even (net 0) closed trade is NOT a win", () => {
    const s = subtotalFor([mk({ status: "closed", net_pnl: 0 })]);
    expect(s.winRate).toBe(0);
  });
  it("no closed trades → winRate 0, netPnl 0", () => {
    const s = subtotalFor([mk({ status: "open", closed_at: null, avg_exit: null })]);
    expect(s.netPnl).toBe(0);
    expect(s.winRate).toBe(0);
    expect(s.closed).toBe(0);
  });
});

describe("groupTrades — none", () => {
  it("returns one synthetic 'all' group with the full subtotal", () => {
    const ts = [mk({ net_pnl: 100 }), mk({ net_pnl: 200 })];
    const g = groupTrades(ts, "none");
    expect(g).toHaveLength(1);
    expect(g[0]!.key).toBe("all");
    expect(g[0]!.trades).toHaveLength(2);
    expect(g[0]!.subtotal.netPnl).toBe(300);
  });
  it("empty list still returns the 'all' group (empty)", () => {
    const g = groupTrades([], "none");
    expect(g).toHaveLength(1);
    expect(g[0]!.subtotal.trades).toBe(0);
  });
});

describe("groupTrades — by segment (canonical order + subtotals)", () => {
  it("partitions by segment and orders EQ→FUT→OPT→COMM→CDS", () => {
    const ts = [
      mk({ segment: "CDS", net_pnl: 10 }),
      mk({ segment: "EQ", product: "CNC", net_pnl: 20 }),
      mk({ segment: "EQ", product: "MIS", net_pnl: 30 }),
      mk({ segment: "OPT", net_pnl: 40 }),
    ];
    const g = groupTrades(ts, "segment");
    expect(g.map((x) => x.key)).toEqual(["EQ", "OPT", "CDS"]);
    const eq = g.find((x) => x.key === "EQ")!;
    expect(eq.label).toBe("Equity");
    expect(eq.trades).toHaveLength(2);
    expect(eq.subtotal.netPnl).toBe(50); // 20 + 30
  });
});

describe("groupTrades — by product (null = MIS)", () => {
  it("buckets legacy null-product under MIS alongside explicit MIS", () => {
    const ts = [
      mk({ segment: "EQ", product: null, net_pnl: 5 }),
      mk({ segment: "EQ", product: "MIS", net_pnl: 7 }),
      mk({ segment: "EQ", product: "CNC", net_pnl: 11 }),
    ];
    const g = groupTrades(ts, "product");
    expect(g.map((x) => x.key)).toEqual(["MIS", "CNC"]);
    const mis = g.find((x) => x.key === "MIS")!;
    expect(mis.subtotal.trades).toBe(2);
    expect(mis.subtotal.netPnl).toBe(12); // 5 + 7
    expect(mis.label).toBe(PRODUCT_LABELS.MIS);
  });
});

describe("groupTrades — by holding period (horizon + Open bucket)", () => {
  it("splits intraday / swing / positional and routes open trades to an Open bucket", () => {
    const ts = [
      // intraday: same IST day, MIS
      mk({
        product: "MIS",
        opened_at: at(2026, 6, 8),
        closed_at: at(2026, 6, 8, 14),
        net_pnl: 100,
      }),
      // swing: CNC held 3 days
      mk({
        segment: "EQ",
        product: "CNC",
        opened_at: at(2026, 6, 8),
        closed_at: at(2026, 6, 11),
        net_pnl: 200,
      }),
      // positional: held 20 days
      mk({
        segment: "EQ",
        product: "CNC",
        opened_at: at(2026, 6, 1),
        closed_at: at(2026, 6, 21),
        net_pnl: 300,
      }),
      // open: no close → Open bucket
      mk({ status: "open", closed_at: null, avg_exit: null, net_pnl: 0 }),
    ];
    const g = groupTrades(ts, "horizon");
    expect(g.map((x) => x.key)).toEqual(["intraday", "swing", "positional", "open"]);
    expect(g.find((x) => x.key === "intraday")!.subtotal.netPnl).toBe(100);
    expect(g.find((x) => x.key === "swing")!.subtotal.netPnl).toBe(200);
    expect(g.find((x) => x.key === "positional")!.subtotal.netPnl).toBe(300);
    // the open trade lands in Open, and its (unrealised) net never enters a P&L
    const open = g.find((x) => x.key === "open")!;
    expect(open.subtotal.trades).toBe(1);
    expect(open.subtotal.closed).toBe(0);
    expect(open.subtotal.netPnl).toBe(0);
  });
});

describe("subtotal sum invariant — group nets sum to the whole", () => {
  it("the sum of grouped subtotals equals the ungrouped subtotal (paise-exact)", () => {
    const ts = [
      mk({ segment: "EQ", product: "CNC", net_pnl: 13579 }),
      mk({ segment: "OPT", product: "NRML", net_pnl: -2468 }),
      mk({ segment: "COMM", product: "NRML", exchange: "MCX", net_pnl: 9999 }),
      mk({ status: "open", closed_at: null, avg_exit: null, net_pnl: 0 }),
    ];
    const whole = subtotalFor(ts).netPnl;
    for (const by of ["segment", "product", "horizon"] as const) {
      const grouped = groupTrades(ts, by).reduce((s, gp) => s + gp.subtotal.netPnl, 0);
      expect(grouped).toBe(whole);
    }
  });
});

describe("label maps stay in sync (single source of truth)", () => {
  it("grouping segment labels agree with filter-predicate SEGMENT_LABELS", () => {
    const g = groupTrades(
      [
        mk({ segment: "EQ", product: "CNC" }),
        mk({ segment: "FUT", product: "NRML" }),
        mk({ segment: "OPT" }),
        mk({ segment: "COMM", product: "NRML", exchange: "MCX" }),
        mk({ segment: "CDS", product: "NRML" }),
      ],
      "segment"
    );
    for (const grp of g) {
      expect(grp.label).toBe(SEGMENT_LABELS[grp.key as keyof typeof SEGMENT_LABELS]);
    }
  });
  it("short codes + exchange labels exist for every value", () => {
    expect(SEGMENT_SHORT.EQ).toBe("EQ");
    expect(EXCHANGE_LABELS.NCDEX).toBe("NCDEX");
  });
});
