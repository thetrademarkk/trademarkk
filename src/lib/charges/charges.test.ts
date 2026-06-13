import { describe, expect, it } from "vitest";
import { computeCharges, computeGrossPnl, computeRMultiple, resolveExchange } from "./charges";
import { getChargeProfile } from "@/config/brokers";

const zerodha = getChargeProfile("zerodha");

describe("computeGrossPnl", () => {
  it("long: profit when exit > entry", () => {
    expect(computeGrossPnl({ direction: "long", qty: 75, entryPrice: 100, exitPrice: 120 })).toBe(
      1500
    );
  });
  it("short: profit when exit < entry", () => {
    expect(computeGrossPnl({ direction: "short", qty: 75, entryPrice: 100, exitPrice: 80 })).toBe(
      1500
    );
  });
  it("long: loss when exit < entry", () => {
    expect(computeGrossPnl({ direction: "long", qty: 50, entryPrice: 200, exitPrice: 180 })).toBe(
      -1000
    );
  });
});

describe("computeCharges (options) — Budget 2026 rates", () => {
  const trade = {
    segment: "OPT" as const,
    qty: 75,
    entryPrice: 100,
    exitPrice: 120,
    direction: "long" as const,
  };
  const breakdown = computeCharges(zerodha, trade);

  it("charges flat ₹20 brokerage per order (2 orders)", () => {
    expect(breakdown.brokerage).toBe(40);
  });
  it("applies STT only on the sell-side premium (0.15%)", () => {
    // sell turnover = 120 * 75 = 9000 → 0.15% = 13.5
    expect(breakdown.stt).toBeCloseTo(13.5, 2);
  });
  it("NSE transaction charge 0.03553% on premium turnover", () => {
    // total premium turnover = 7500 + 9000 = 16500 → 0.03553% = 5.86
    expect(breakdown.exchange).toBeCloseTo(5.86, 2);
  });
  it("applies stamp duty only on the buy side", () => {
    // buy turnover = 100 * 75 = 7500 → 0.003% = 0.23
    expect(breakdown.stampDuty).toBeCloseTo(0.23, 2);
  });
  it("total = sum of components", () => {
    const sum =
      breakdown.brokerage +
      breakdown.stt +
      breakdown.exchange +
      breakdown.sebi +
      breakdown.gst +
      breakdown.stampDuty;
    expect(breakdown.total).toBeCloseTo(sum, 1);
  });
});

describe("computeCharges (futures) — Budget 2026 rates", () => {
  it("applies 0.05% STT on the sell side", () => {
    const b = computeCharges(zerodha, {
      segment: "FUT",
      qty: 75,
      entryPrice: 24000,
      exitPrice: 24100,
      direction: "long",
    });
    // sell turnover = 24100 * 75 = 18,07,500 → 0.05% = 903.75
    expect(b.stt).toBeCloseTo(903.75, 1);
  });
});

describe("computeCharges (equity intraday)", () => {
  it("uses percentage brokerage cap when lower than flat", () => {
    // tiny turnover → 0.03% beats ₹20 flat
    const b = computeCharges(zerodha, {
      segment: "EQ",
      qty: 1,
      entryPrice: 100,
      exitPrice: 101,
      direction: "long",
    });
    expect(b.brokerage).toBeLessThan(40);
  });
  it("applies 0.025% STT on the sell side", () => {
    const b = computeCharges(zerodha, {
      segment: "EQ",
      qty: 100,
      entryPrice: 500,
      exitPrice: 510,
      direction: "long",
    });
    // sell turnover 51,000 → 0.025% = 12.75
    expect(b.stt).toBeCloseTo(12.75, 2);
  });
});

describe("computeCharges — Segment × Product engine (journal-DB v4)", () => {
  // 100 shares of a ₹500 → ₹510 stock. buy turnover 50,000 · sell 51,000.
  const eq = { qty: 100, entryPrice: 500, exitPrice: 510, direction: "long" as const };

  describe("EQ + MIS (intraday)", () => {
    const b = computeCharges(zerodha, { segment: "EQ", product: "MIS", ...eq });
    it("STT 0.025% on the SELL side only", () => {
      // 51,000 × 0.025% = 12.75
      expect(b.stt).toBeCloseTo(12.75, 2);
    });
    it("stamp 0.003% on the buy side", () => {
      // 50,000 × 0.003% = 1.5
      expect(b.stampDuty).toBeCloseTo(1.5, 2);
    });
    it("no DP charge for intraday", () => {
      expect(b.dpCharge).toBe(0);
    });
  });

  describe("EQ + CNC (delivery)", () => {
    const b = computeCharges(zerodha, { segment: "EQ", product: "CNC", ...eq });
    it("STT 0.1% on BOTH sides (buy + sell turnover)", () => {
      // (50,000 + 51,000) × 0.1% = 101
      expect(b.stt).toBeCloseTo(101, 2);
    });
    it("higher delivery stamp 0.015% on the buy side", () => {
      // 50,000 × 0.015% = 7.5
      expect(b.stampDuty).toBeCloseTo(7.5, 2);
    });
    it("adds the per-scrip DP charge on the delivery sell", () => {
      expect(b.dpCharge).toBeCloseTo(15.34, 2);
    });
    it("zero brokerage on delivery for a zero-brokerage broker (Zerodha)", () => {
      expect(b.brokerage).toBe(0);
    });
    it("Upstox still charges brokerage on delivery (not zero-brokerage)", () => {
      const u = computeCharges(getChargeProfile("upstox"), {
        segment: "EQ",
        product: "CNC",
        ...eq,
      });
      expect(u.brokerage).toBeGreaterThan(0);
      expect(u.dpCharge).toBeCloseTo(15.34, 2);
    });
    it("delivery STT (both sides) is far larger than intraday STT (sell-only)", () => {
      const mis = computeCharges(zerodha, { segment: "EQ", product: "MIS", ...eq });
      expect(b.stt).toBeGreaterThan(mis.stt * 5);
    });
  });

  describe("EQ + BTST/STBT (delivery basis, no DP)", () => {
    const btst = computeCharges(zerodha, { segment: "EQ", product: "BTST", ...eq });
    it("uses the delivery STT basis (0.1% both sides)", () => {
      expect(btst.stt).toBeCloseTo(101, 2);
    });
    it("charges NO DP (settles without a demat debit)", () => {
      expect(btst.dpCharge).toBe(0);
    });
    it("STBT also delivery-basis, no DP", () => {
      const stbt = computeCharges(zerodha, { segment: "EQ", product: "STBT", ...eq });
      expect(stbt.stt).toBeCloseTo(101, 2);
      expect(stbt.dpCharge).toBe(0);
    });
  });

  describe("COMM (commodity, MCX) — CTT not STT", () => {
    const comm = { qty: 100, entryPrice: 1000, exitPrice: 1010, direction: "long" as const };
    it("non-agri futures: CTT 0.01% on the sell turnover", () => {
      const b = computeCharges(zerodha, { segment: "COMM", product: "NRML", ...comm });
      // sell 101,000 × 0.01% = 10.1
      expect(b.stt).toBeCloseTo(10.1, 2);
    });
    it("commodity options: CTT 0.05% on the sell premium", () => {
      const b = computeCharges(zerodha, {
        segment: "COMM",
        product: "NRML",
        commodityOption: true,
        ...comm,
      });
      // sell 101,000 × 0.05% = 50.5
      expect(b.stt).toBeCloseTo(50.5, 2);
    });
    it("agri commodities are CTT-exempt (zero transaction tax)", () => {
      const b = computeCharges(zerodha, {
        segment: "COMM",
        product: "NRML",
        agriCommodity: true,
        ...comm,
      });
      expect(b.stt).toBe(0);
    });
  });

  describe("CDS (currency) — neither STT nor CTT", () => {
    const b = computeCharges(zerodha, {
      segment: "CDS",
      product: "NRML",
      qty: 1000,
      entryPrice: 83,
      exitPrice: 83.5,
      direction: "long",
    });
    it("emits a zero transaction-tax line (no phantom STT)", () => {
      expect(b.stt).toBe(0);
    });
    it("still charges brokerage + exchange + gst", () => {
      expect(b.brokerage).toBeGreaterThan(0);
      expect(b.total).toBeGreaterThan(0);
    });
  });

  describe("FnO regression — must match pre-v4 behaviour exactly", () => {
    it("OPT charges are identical with or without a product field", () => {
      const t = {
        segment: "OPT" as const,
        qty: 75,
        entryPrice: 100,
        exitPrice: 120,
        direction: "long" as const,
      };
      const withoutProduct = computeCharges(zerodha, t);
      const withProduct = computeCharges(zerodha, { ...t, product: "NRML" });
      expect(withProduct.total).toBeCloseTo(withoutProduct.total, 2);
      expect(withProduct.stt).toBeCloseTo(13.5, 2); // 0.15% sell premium unchanged
    });
    it("FUT STT 0.05% sell unchanged regardless of product", () => {
      const t = {
        segment: "FUT" as const,
        qty: 75,
        entryPrice: 24000,
        exitPrice: 24100,
        direction: "long" as const,
      };
      const a = computeCharges(zerodha, t);
      const b = computeCharges(zerodha, { ...t, product: "NRML" });
      expect(a.stt).toBeCloseTo(903.75, 1);
      expect(b.stt).toBeCloseTo(903.75, 1);
    });
  });

  describe("legacy back-compat — equity with no product = intraday (MIS)", () => {
    it("undefined/null product computes the same as MIS (no P&L regression)", () => {
      const t = { segment: "EQ" as const, ...eq };
      const legacyUndefined = computeCharges(zerodha, t);
      const legacyNull = computeCharges(zerodha, { ...t, product: null });
      const mis = computeCharges(zerodha, { ...t, product: "MIS" });
      expect(legacyUndefined.total).toBeCloseTo(mis.total, 2);
      expect(legacyNull.total).toBeCloseTo(mis.total, 2);
      // and crucially NOT the delivery branch
      const cnc = computeCharges(zerodha, { ...t, product: "CNC" });
      expect(legacyUndefined.total).not.toBeCloseTo(cnc.total, 2);
    });
  });

  it("total always equals the sum of every component (incl. DP)", () => {
    const b = computeCharges(zerodha, { segment: "EQ", product: "CNC", ...eq });
    const sum = b.brokerage + b.stt + b.exchange + b.sebi + b.gst + b.stampDuty + b.dpCharge;
    expect(b.total).toBeCloseTo(sum, 2);
  });
});

describe("per-broker brokerage differences", () => {
  it("Upstox futures cap (0.05%) differs from equity cap (0.1%)", () => {
    const upstox = getChargeProfile("upstox");
    const small = { qty: 1, entryPrice: 1000, exitPrice: 1000, direction: "long" as const };
    const eq = computeCharges(upstox, { segment: "EQ", ...small });
    const fut = computeCharges(upstox, { segment: "FUT", ...small });
    // per-order turnover 1000 → eq: 1000*0.1% = 1 ×2; fut: 1000*0.05% = 0.5 ×2
    expect(eq.brokerage).toBeCloseTo(2, 2);
    expect(fut.brokerage).toBeCloseTo(1, 2);
  });
});

describe("computeRMultiple", () => {
  it("computes +2R when reward = 2x risk", () => {
    expect(
      computeRMultiple({
        direction: "long",
        entryPrice: 100,
        exitPrice: 120,
        plannedEntry: 100,
        plannedSl: 90,
      })
    ).toBe(2);
  });
  it("computes -1R at stop loss", () => {
    expect(
      computeRMultiple({
        direction: "long",
        entryPrice: 100,
        exitPrice: 90,
        plannedEntry: 100,
        plannedSl: 90,
      })
    ).toBe(-1);
  });
  it("handles shorts", () => {
    expect(
      computeRMultiple({
        direction: "short",
        entryPrice: 100,
        exitPrice: 90,
        plannedEntry: 100,
        plannedSl: 105,
      })
    ).toBe(2);
  });
  it("returns null without a stop", () => {
    expect(
      computeRMultiple({
        direction: "long",
        entryPrice: 100,
        exitPrice: 110,
        plannedEntry: null,
        plannedSl: null,
      })
    ).toBeNull();
  });
});

describe("resolveExchange — back-compat segment defaults + free-text normalisation (SEG-CHG)", () => {
  it("undefined/null/empty exchange falls back to the segment default", () => {
    expect(resolveExchange("EQ")).toBe("NSE");
    expect(resolveExchange("FUT", null)).toBe("NSE");
    expect(resolveExchange("OPT", "")).toBe("NSE");
    expect(resolveExchange("CDS", undefined)).toBe("NSE");
    expect(resolveExchange("COMM")).toBe("MCX"); // commodity default is MCX
  });
  it("exact union values pass through", () => {
    expect(resolveExchange("EQ", "BSE")).toBe("BSE");
    expect(resolveExchange("COMM", "NCDEX")).toBe("NCDEX");
    expect(resolveExchange("COMM", "MCX")).toBe("MCX");
  });
  it("normalises broker free-text exchanges", () => {
    expect(resolveExchange("EQ", "NSE_EQ")).toBe("NSE");
    expect(resolveExchange("FUT", "NFO")).toBe("NSE");
    expect(resolveExchange("EQ", "bse")).toBe("BSE");
    expect(resolveExchange("FUT", "BFO")).toBe("BSE");
    expect(resolveExchange("COMM", "MCX-COMM")).toBe("MCX");
    expect(resolveExchange("COMM", "ncdex agri")).toBe("NCDEX");
  });
  it("NCDEX is matched before NSE/BSE (distinct prefix, not swallowed)", () => {
    expect(resolveExchange("COMM", "NCDEX")).toBe("NCDEX");
    expect(resolveExchange("COMM", "ncdexabc")).toBe("NCDEX");
  });
  it("unknown free-text falls back to the segment default", () => {
    expect(resolveExchange("EQ", "WHATEVER")).toBe("NSE");
    expect(resolveExchange("COMM", "???")).toBe("MCX");
  });
});

describe("SEG-CHG — fixed/added exchange & segment rates", () => {
  const eqf = { qty: 100, entryPrice: 500, exitPrice: 510, direction: "long" as const };
  const commf = { qty: 100, entryPrice: 1000, exitPrice: 1010, direction: "long" as const };
  const cdsf = { qty: 1000, entryPrice: 83, exitPrice: 83.5, direction: "long" as const };
  const futf = { qty: 75, entryPrice: 24000, exitPrice: 24100, direction: "long" as const };

  it("MCX commodity FUTURE uses the FIXED 0.0021% rate (was 0.00266% placeholder)", () => {
    const b = computeCharges(zerodha, { segment: "COMM", product: "NRML", ...commf });
    // 201,000 × 0.0021% = 4.221 → 4.22
    expect(b.exchange).toBe(4.22);
  });
  it("MCX commodity OPTION uses 0.0418% premium (was ~20x understated by the futures rate)", () => {
    const fut = computeCharges(zerodha, { segment: "COMM", product: "NRML", ...commf });
    const optn = computeCharges(zerodha, {
      segment: "COMM",
      product: "NRML",
      commodityOption: true,
      ...commf,
    });
    expect(optn.exchange).toBe(84.02); // 201,000 × 0.0418%
    expect(optn.exchange).toBeGreaterThan(fut.exchange * 15);
  });
  it("commodity OPTION uses the option stamp 0.003% (not the futures 0.002%)", () => {
    const optn = computeCharges(zerodha, {
      segment: "COMM",
      product: "NRML",
      commodityOption: true,
      ...commf,
    });
    expect(optn.stampDuty).toBe(3); // 100,000 × 0.003%
  });
  it("commodity OPTION brokerage is flat ₹20×2 (no % cap path)", () => {
    // A large commodity-option turnover where a % cap would otherwise apply.
    const optn = computeCharges(zerodha, {
      segment: "COMM",
      product: "NRML",
      commodityOption: true,
      qty: 1000,
      entryPrice: 1000,
      exitPrice: 1010,
      direction: "long",
    });
    expect(optn.brokerage).toBe(40);
  });
  it("agri commodity uses the ₹1/crore SEBI slab (vs ₹10/crore non-agri)", () => {
    const agri = computeCharges(zerodha, {
      segment: "COMM",
      product: "NRML",
      agriCommodity: true,
      ...commf,
    });
    const nonAgri = computeCharges(zerodha, { segment: "COMM", product: "NRML", ...commf });
    expect(agri.sebi).toBe(0.02); // 201,000/1cr × 1
    expect(nonAgri.sebi).toBe(0.2); // 201,000/1cr × 10
    expect(agri.stt).toBe(0); // agri is CTT-exempt
  });
  it("CDS FUTURE uses the FIXED 0.00035% rate (was 0.00009% — ~4x too low)", () => {
    const b = computeCharges(zerodha, { segment: "CDS", product: "NRML", ...cdsf });
    expect(b.exchange).toBe(0.58); // 166,500 × 0.00035%
  });
  it("CDS uses the dedicated 0.0001% stamp (not the futures 0.002% — was ~20x too high)", () => {
    const b = computeCharges(zerodha, { segment: "CDS", product: "NRML", ...cdsf });
    expect(b.stampDuty).toBe(0.08); // 83,000 × 0.0001%
  });
  it("CDS OPTION carries the 0.0311% premium exchange rate, still zero tax", () => {
    const b = computeCharges(zerodha, {
      segment: "CDS",
      product: "NRML",
      isOption: true,
      qty: 1000,
      entryPrice: 2,
      exitPrice: 2.5,
      direction: "long",
    });
    expect(b.stt).toBe(0);
    expect(b.exchange).toBe(1.4); // 4,500 × 0.0311%
  });
  it("BSE futures carry NO exchange transaction charge (0)", () => {
    const b = computeCharges(zerodha, {
      segment: "FUT",
      product: "NRML",
      exchange: "BSE",
      ...futf,
    });
    expect(b.exchange).toBe(0);
  });
  it("BSE equity exchange rate (0.00375%) exceeds NSE (0.00307%)", () => {
    const bse = computeCharges(zerodha, { segment: "EQ", product: "MIS", exchange: "BSE", ...eqf });
    const nse = computeCharges(zerodha, { segment: "EQ", product: "MIS", exchange: "NSE", ...eqf });
    expect(bse.exchange).toBeGreaterThan(nse.exchange);
    expect(bse.exchange).toBe(3.79);
    expect(nse.exchange).toBe(3.1);
  });
  it("NCDEX agri future (0.003%) < NCDEX non-agri future (0.0058%)", () => {
    const agri = computeCharges(zerodha, {
      segment: "COMM",
      product: "NRML",
      agriCommodity: true,
      exchange: "NCDEX",
      ...commf,
    });
    const nonAgri = computeCharges(zerodha, {
      segment: "COMM",
      product: "NRML",
      exchange: "NCDEX",
      ...commf,
    });
    expect(agri.exchange).toBe(6.03); // 201,000 × 0.003%
    expect(nonAgri.exchange).toBe(11.66); // 201,000 × 0.0058%
  });
});
