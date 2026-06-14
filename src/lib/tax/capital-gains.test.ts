import { describe, expect, it } from "vitest";
import {
  CG_LTCG_EXEMPTION,
  CG_LTCG_RATE_PCT,
  CG_STCG_RATE_PCT,
  capitalGainsSplit,
  classifyTaxBucket,
  fyTaxSummary,
  taxBucketSplit,
  type TaxTrade,
} from "./turnover";
import { capitalGainsTerm, heldOverTwelveMonths } from "@/lib/stats/horizon";

let seq = 0;
function mk(over: Partial<TaxTrade> = {}): TaxTrade {
  seq++;
  return {
    id: `t${seq}`,
    account_id: "acc1",
    symbol: "RELIANCE",
    segment: "EQ",
    product: "CNC",
    direction: "long",
    qty: 10,
    avg_entry: 2900,
    avg_exit: 3000,
    opened_at: "2024-01-15T04:00:00Z",
    closed_at: "2024-06-15T09:00:00Z",
    gross_pnl: 1000,
    charges: 60,
    net_pnl: 940,
    ...over,
  };
}

describe("classifyTaxBucket — three-way income heads", () => {
  it("intraday equity (MIS) → speculative", () => {
    expect(
      classifyTaxBucket(
        mk({ product: "MIS", opened_at: "2025-06-10T04:00:00Z", closed_at: "2025-06-10T09:00:00Z" })
      )
    ).toBe("speculative");
  });

  it("same-IST-day equity with null product → speculative", () => {
    expect(
      classifyTaxBucket(
        mk({ product: null, opened_at: "2025-06-10T04:00:00Z", closed_at: "2025-06-10T09:00:00Z" })
      )
    ).toBe("speculative");
  });

  it("delivery equity (CNC) → capital-gains", () => {
    expect(classifyTaxBucket(mk({ product: "CNC" }))).toBe("capital-gains");
  });

  it("overnight equity with null product → capital-gains (delivery)", () => {
    expect(
      classifyTaxBucket(
        mk({ product: null, opened_at: "2025-06-10T04:00:00Z", closed_at: "2025-06-12T09:00:00Z" })
      )
    ).toBe("capital-gains");
  });

  it("BTST / STBT equity → capital-gains (delivery basis, short-term)", () => {
    expect(classifyTaxBucket(mk({ product: "BTST" }))).toBe("capital-gains");
    expect(classifyTaxBucket(mk({ product: "STBT" }))).toBe("capital-gains");
  });

  it("F&O (FUT / OPT) → non-speculative business", () => {
    expect(classifyTaxBucket(mk({ segment: "FUT", product: "NRML" }))).toBe(
      "non-speculative-business"
    );
    expect(classifyTaxBucket(mk({ segment: "OPT", product: "NRML" }))).toBe(
      "non-speculative-business"
    );
  });

  it("commodity (COMM) and currency (CDS) → non-speculative business", () => {
    expect(classifyTaxBucket(mk({ segment: "COMM" }))).toBe("non-speculative-business");
    expect(classifyTaxBucket(mk({ segment: "CDS" }))).toBe("non-speculative-business");
  });
});

describe("heldOverTwelveMonths — 12-month IST boundary", () => {
  it("exactly 12 months (same day, one year on) is NOT over 12 months → short", () => {
    expect(heldOverTwelveMonths("2024-01-15T04:00:00Z", "2025-01-15T09:00:00Z")).toBe(false);
    expect(capitalGainsTerm("2024-01-15T04:00:00Z", "2025-01-15T09:00:00Z")).toBe("short");
  });

  it("one day past 12 months → over → long", () => {
    expect(heldOverTwelveMonths("2024-01-15T04:00:00Z", "2025-01-16T09:00:00Z")).toBe(true);
    expect(capitalGainsTerm("2024-01-15T04:00:00Z", "2025-01-16T09:00:00Z")).toBe("long");
  });

  it("one day short of 12 months → short", () => {
    expect(heldOverTwelveMonths("2024-01-15T04:00:00Z", "2025-01-14T09:00:00Z")).toBe(false);
  });

  it("two years held → long", () => {
    expect(capitalGainsTerm("2023-01-15T04:00:00Z", "2025-02-15T09:00:00Z")).toBe("long");
  });

  it("a few days held → short", () => {
    expect(capitalGainsTerm("2025-06-10T04:00:00Z", "2025-06-13T09:00:00Z")).toBe("short");
  });

  it("respects the IST date boundary at the year edge", () => {
    // 2024-03-31 20:00 UTC = 2024-04-01 IST acquisition; sell 2025-04-01 IST →
    // exactly 12 months → short (not over).
    expect(heldOverTwelveMonths("2024-03-31T20:00:00Z", "2025-03-31T20:00:00Z")).toBe(false);
    // sell one IST day later → over 12 months → long.
    expect(heldOverTwelveMonths("2024-03-31T20:00:00Z", "2025-04-01T20:00:00Z")).toBe(true);
  });
});

describe("capitalGainsSplit — STCG / LTCG", () => {
  it("splits delivery-equity P&L by holding period", () => {
    const trades = [
      // STCG: held 5 months
      mk({
        opened_at: "2024-01-15T04:00:00Z",
        closed_at: "2024-06-15T09:00:00Z",
        net_pnl: 940,
        gross_pnl: 1000,
      }),
      // STCG: held exactly 12 months (boundary → short)
      mk({
        opened_at: "2024-01-15T04:00:00Z",
        closed_at: "2025-01-15T09:00:00Z",
        net_pnl: 500,
        gross_pnl: 540,
      }),
      // LTCG: held 13 months
      mk({
        opened_at: "2024-01-15T04:00:00Z",
        closed_at: "2025-02-15T09:00:00Z",
        net_pnl: 2000,
        gross_pnl: 2100,
      }),
      // excluded: intraday EQ (speculative)
      mk({
        product: "MIS",
        opened_at: "2025-06-10T04:00:00Z",
        closed_at: "2025-06-10T09:00:00Z",
        net_pnl: 99,
      }),
      // excluded: F&O
      mk({ segment: "OPT", product: "NRML", net_pnl: 99 }),
    ];
    const cg = capitalGainsSplit(trades);
    expect(cg.trades).toBe(3);
    expect(cg.shortTerm.trades).toBe(2);
    expect(cg.shortTerm.netPnl).toBe(1440); // 940 + 500
    expect(cg.longTerm.trades).toBe(1);
    expect(cg.longTerm.netPnl).toBe(2000);
  });

  it("excludes open (unrealised) delivery positions", () => {
    const cg = capitalGainsSplit([mk({ closed_at: null, avg_exit: null })]);
    expect(cg.trades).toBe(0);
    expect(cg.shortTerm.trades).toBe(0);
    expect(cg.longTerm.trades).toBe(0);
  });

  it("applies the LTCG exemption for display only, floored at zero", () => {
    const small = capitalGainsSplit([
      mk({ opened_at: "2023-01-15T04:00:00Z", closed_at: "2024-06-15T09:00:00Z", net_pnl: 50000 }),
    ]);
    // 50000 net LTCG < 1.25L exemption → taxable after exemption is 0.
    expect(small.ltcgExemption).toBe(CG_LTCG_EXEMPTION);
    expect(small.ltcgTaxableAfterExemption).toBe(0);

    const big = capitalGainsSplit([
      mk({ opened_at: "2023-01-15T04:00:00Z", closed_at: "2024-06-15T09:00:00Z", net_pnl: 200000 }),
    ]);
    // 200000 - 125000 = 75000.
    expect(big.ltcgTaxableAfterExemption).toBe(75000);
  });

  it("statutory rate labels are the post-23-Jul-2024 values", () => {
    expect(CG_STCG_RATE_PCT).toBe(20);
    expect(CG_LTCG_RATE_PCT).toBe(12.5);
    expect(CG_LTCG_EXEMPTION).toBe(125000);
  });
});

describe("taxBucketSplit — full three-way", () => {
  it("buckets every trade into exactly one head and always returns all three", () => {
    const trades = [
      mk({
        product: "MIS",
        opened_at: "2025-06-10T04:00:00Z",
        closed_at: "2025-06-10T09:00:00Z",
        net_pnl: 100,
        gross_pnl: 120,
        charges: 20,
      }),
      mk({ product: "CNC", net_pnl: 940, gross_pnl: 1000, charges: 60 }),
      mk({ segment: "OPT", product: "NRML", net_pnl: 300, gross_pnl: 350, charges: 50 }),
      mk({ segment: "COMM", net_pnl: 200, gross_pnl: 240, charges: 40 }),
    ];
    const s = taxBucketSplit(trades);
    expect(s.speculative.trades).toBe(1);
    expect(s.speculative.netPnl).toBe(100);
    expect(s.capitalGains.trades).toBe(1);
    expect(s.capitalGains.netPnl).toBe(940);
    expect(s.nonSpeculativeBusiness.trades).toBe(2); // OPT + COMM
    expect(s.nonSpeculativeBusiness.netPnl).toBe(500);
    // Capital-gains sub-split present.
    expect(s.cg.trades).toBe(1);
    expect(s.cg.shortTerm.trades).toBe(1);
  });

  it("returns all three buckets at zero for an empty FY", () => {
    const s = taxBucketSplit([]);
    expect(s.speculative.trades).toBe(0);
    expect(s.nonSpeculativeBusiness.trades).toBe(0);
    expect(s.capitalGains.trades).toBe(0);
    expect(s.cg.trades).toBe(0);
  });

  it("the three bucket counts sum to the total trade count", () => {
    const trades = [
      mk({ product: "MIS", opened_at: "2025-06-10T04:00:00Z", closed_at: "2025-06-10T09:00:00Z" }),
      mk({ product: "CNC" }),
      mk({ segment: "FUT", product: "NRML" }),
      mk({ segment: "CDS" }),
    ];
    const s = taxBucketSplit(trades);
    expect(s.speculative.trades + s.nonSpeculativeBusiness.trades + s.capitalGains.trades).toBe(
      trades.length
    );
  });
});

describe("fyTaxSummary exposes the three-way buckets", () => {
  it("includes buckets alongside the legacy two-way split", () => {
    const s = fyTaxSummary([
      mk({
        product: "CNC",
        opened_at: "2023-01-15T04:00:00Z",
        closed_at: "2025-02-15T09:00:00Z",
        net_pnl: 5000,
      }),
      mk({ segment: "OPT", product: "NRML", net_pnl: 300 }),
    ]);
    expect(s.buckets.capitalGains.trades).toBe(1);
    expect(s.buckets.cg.longTerm.trades).toBe(1);
    expect(s.buckets.nonSpeculativeBusiness.trades).toBe(1);
    // Legacy split still present (CNC delivery is non-speculative there).
    expect(s.split.nonSpeculative.trades).toBe(2);
  });
});
