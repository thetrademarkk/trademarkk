import { describe, expect, it } from "vitest";
import { computeCharges, type ChargeBreakdown, type TradeForCharges } from "./charges";
import { getChargeProfile } from "@/config/brokers";

/**
 * SEG-02 — Charge-engine GOLDEN TABLE.
 *
 * This file locks the exact money math of the per-(segment, product) charge
 * engine (SEG-01) against values computed BY HAND below, so the engine can
 * never silently drift. Every expected number is in RUPEES, rounded to paise
 * (2 dp), exactly as `computeCharges` returns. Each row documents its formula
 * as a comment so a human can re-verify against zerodha.com/charges and the
 * statutory rate sheet.
 *
 * Statutory rates (fractions, verified June 2026 / Budget 2026):
 *   STT  — eq intraday 0.025% sell · eq delivery 0.1% BOTH sides ·
 *          futures 0.05% sell · options 0.15% sell premium
 *   CTT  — commodity non-agri future 0.01% sell · option 0.05% premium sell ·
 *          agri EXEMPT · NO STT on commodities · currency (CDS) NO STT/CTT
 *   NSE txn — options 0.03553% · futures 0.00183% · equity 0.00307% (on premium/
 *             turnover); commodity (MCX) 0.00266% · currency 0.00009% placeholders
 *   SEBI ₹10 / crore of turnover
 *   GST  18% on (brokerage + exchange txn + SEBI)   [NOT on STT/stamp/DP]
 *   stamp (BUY side) — opt/eq-intraday 0.003% · futures/commodity/currency 0.002% ·
 *                      eq-delivery 0.015%
 *   DP   ₹15.34 (incl. GST) per scrip on an equity DELIVERY (CNC) sell
 *   Zerodha brokerage: ₹20 or 0.03% per order (whichever lower); ₹0 on eq delivery
 *   Upstox  brokerage: ₹20 or 0.1% eq per order; charges brokerage on delivery too
 *   "No charges (manual)" zero profile: every component 0
 *
 * Rounding: the engine rounds each component with Math.round(n*100)/100 (paise,
 * half-UP). The boundary rows below lock that behaviour explicitly.
 */

const zerodha = getChargeProfile("zerodha");
const upstox = getChargeProfile("upstox");
const zero = getChargeProfile("zero");

/** Assert a full breakdown equals the hand-computed golden values, paise-exact. */
function expectBreakdown(actual: ChargeBreakdown, expected: ChargeBreakdown) {
  // Each component is asserted exactly (toBe on the paise-rounded rupee value).
  expect(actual.brokerage).toBe(expected.brokerage);
  expect(actual.stt).toBe(expected.stt);
  expect(actual.exchange).toBe(expected.exchange);
  expect(actual.sebi).toBe(expected.sebi);
  expect(actual.gst).toBe(expected.gst);
  expect(actual.stampDuty).toBe(expected.stampDuty);
  expect(actual.dpCharge).toBe(expected.dpCharge);
  expect(actual.total).toBe(expected.total);
}

interface GoldenRow {
  name: string;
  profile: ReturnType<typeof getChargeProfile>;
  trade: TradeForCharges;
  expected: ChargeBreakdown;
  /** Human-readable derivation, kept beside the numbers for re-verification. */
  formula: string;
}

// Canonical fixtures. EQ: 100 sh @ ₹500 → ₹510 (buy 50,000 · sell 51,000 · total 101,000).
const eq = { qty: 100, entryPrice: 500, exitPrice: 510, direction: "long" as const };
// COMM: 100 @ ₹1,000 → ₹1,010 (buy 100,000 · sell 101,000 · total 201,000).
const comm = { qty: 100, entryPrice: 1000, exitPrice: 1010, direction: "long" as const };
// CDS: 1,000 @ ₹83 → ₹83.5 (buy 83,000 · sell 83,500 · total 166,500).
const cds = { qty: 1000, entryPrice: 83, exitPrice: 83.5, direction: "long" as const };
// FUT: 75 @ ₹24,000 → ₹24,100 (buy 18,00,000 · sell 18,07,500 · total 36,07,500).
const fut = { qty: 75, entryPrice: 24000, exitPrice: 24100, direction: "long" as const };
// OPT: 75 @ ₹100 → ₹120 premium (buy 7,500 · sell 9,000 · total 16,500).
const opt = { qty: 75, entryPrice: 100, exitPrice: 120, direction: "long" as const };

const GOLDEN: GoldenRow[] = [
  // ───────────────────────────── ZERODHA ─────────────────────────────
  {
    name: "Zerodha · EQ + MIS (intraday)",
    profile: zerodha,
    trade: { segment: "EQ", product: "MIS", ...eq },
    formula:
      "brokerage min(20, 50,500×0.03%=15.15)×2=30.30 · STT 51,000×0.025%=12.75 (sell) · " +
      "exch 101,000×0.00307%=3.10097→3.10 · SEBI 101,000/1cr×10=0.101→0.10 · " +
      "GST (30.30+3.10+0.10)×18%=6.0318→6.03 · stamp 50,000×0.003%=1.50 · DP 0 · " +
      "total 30.30+12.75+3.10+0.10+6.03+1.50=53.78",
    expected: {
      brokerage: 30.3,
      stt: 12.75,
      exchange: 3.1,
      sebi: 0.1,
      gst: 6.03,
      stampDuty: 1.5,
      dpCharge: 0,
      total: 53.78,
    },
  },
  {
    name: "Zerodha · EQ + CNC (delivery)",
    profile: zerodha,
    trade: { segment: "EQ", product: "CNC", ...eq },
    formula:
      "brokerage 0 (zero-brokerage delivery) · STT 101,000×0.1%=101 (BOTH sides) · " +
      "exch 101,000×0.00307%=3.10 · SEBI 0.10 · GST (0+3.10+0.10)×18%=0.576→0.58 · " +
      "stamp 50,000×0.015%=7.50 · DP 15.34 · total 0+101+3.10+0.10+0.58+7.50+15.34=127.62",
    expected: {
      brokerage: 0,
      stt: 101,
      exchange: 3.1,
      sebi: 0.1,
      gst: 0.58,
      stampDuty: 7.5,
      dpCharge: 15.34,
      total: 127.62,
    },
  },
  {
    name: "Zerodha · EQ + BTST (delivery basis, no DP)",
    profile: zerodha,
    trade: { segment: "EQ", product: "BTST", ...eq },
    formula:
      "delivery STT basis 101 (both sides) · stamp 7.50 · brokerage 0 · NO DP (settles " +
      "without a demat debit) · exch 3.10 · SEBI 0.10 · GST 0.58 · total 112.28",
    expected: {
      brokerage: 0,
      stt: 101,
      exchange: 3.1,
      sebi: 0.1,
      gst: 0.58,
      stampDuty: 7.5,
      dpCharge: 0,
      total: 112.28,
    },
  },
  {
    name: "Zerodha · EQ + STBT (delivery basis, no DP)",
    profile: zerodha,
    trade: { segment: "EQ", product: "STBT", ...eq },
    formula: "identical to BTST — delivery STT 101, stamp 7.50, no DP · total 112.28",
    expected: {
      brokerage: 0,
      stt: 101,
      exchange: 3.1,
      sebi: 0.1,
      gst: 0.58,
      stampDuty: 7.5,
      dpCharge: 0,
      total: 112.28,
    },
  },
  {
    name: "Zerodha · FUT + NRML (carry) — regression guard",
    profile: zerodha,
    trade: { segment: "FUT", product: "NRML", ...fut },
    formula:
      "brokerage 20×2=40 (per-order cap 18,03,750×0.03%=541 > 20) · STT 18,07,500×0.05%=903.75 (sell) · " +
      "exch 36,07,500×0.00183%=66.017→66.02 · SEBI 36,07,500/1cr×10=3.6075→3.61 · " +
      "GST (40+66.02+3.61)×18%=19.7334→19.73 · stamp 18,00,000×0.002%=36 · " +
      "total 40+903.75+66.02+3.61+19.73+36=1069.11",
    expected: {
      brokerage: 40,
      stt: 903.75,
      exchange: 66.02,
      sebi: 3.61,
      gst: 19.73,
      stampDuty: 36,
      dpCharge: 0,
      total: 1069.11,
    },
  },
  {
    name: "Zerodha · OPT + NRML — regression guard",
    profile: zerodha,
    trade: { segment: "OPT", product: "NRML", ...opt },
    formula:
      "brokerage flat 20×2=40 · STT 9,000×0.15%=13.50 (sell premium) · " +
      "exch 16,500×0.03553%=5.86245→5.86 · SEBI 16,500/1cr×10=0.0165→0.02 · " +
      "GST (40+5.86+0.02)×18%=8.2584→8.26 · stamp 7,500×0.003%=0.225→0.23 · " +
      "total 40+13.50+5.86+0.02+8.26+0.23=67.86",
    expected: {
      brokerage: 40,
      stt: 13.5,
      exchange: 5.86,
      sebi: 0.02,
      gst: 8.26,
      stampDuty: 0.23,
      dpCharge: 0,
      total: 67.86,
    },
  },
  {
    name: "Zerodha · COMM future (non-agri) — CTT 0.01%, NO STT",
    profile: zerodha,
    trade: { segment: "COMM", product: "NRML", ...comm },
    formula:
      "brokerage 20×2=40 (cap 100,500×0.03%=30.15 > 20 → flat) · CTT 101,000×0.01%=10.10 (sell) · " +
      "exch 201,000×0.00266%=5.3466→5.35 · SEBI 201,000/1cr×10=0.201→0.20 · " +
      "GST (40+5.35+0.20)×18%=8.199→8.20 · stamp 100,000×0.002%=2 · total 40+10.10+5.35+0.20+8.20+2=65.85",
    expected: {
      brokerage: 40,
      stt: 10.1,
      exchange: 5.35,
      sebi: 0.2,
      gst: 8.2,
      stampDuty: 2,
      dpCharge: 0,
      total: 65.85,
    },
  },
  {
    name: "Zerodha · COMM option (non-agri) — CTT 0.05% on premium",
    profile: zerodha,
    trade: { segment: "COMM", product: "NRML", commodityOption: true, ...comm },
    formula: "CTT 101,000×0.05%=50.50 (sell premium) · rest as COMM future · total 106.25",
    expected: {
      brokerage: 40,
      stt: 50.5,
      exchange: 5.35,
      sebi: 0.2,
      gst: 8.2,
      stampDuty: 2,
      dpCharge: 0,
      total: 106.25,
    },
  },
  {
    name: "Zerodha · COMM agri — CTT EXEMPT (zero transaction tax)",
    profile: zerodha,
    trade: { segment: "COMM", product: "NRML", agriCommodity: true, ...comm },
    formula: "agri ⇒ CTT 0 · everything else as COMM future · total 40+0+5.35+0.20+8.20+2=55.75",
    expected: {
      brokerage: 40,
      stt: 0,
      exchange: 5.35,
      sebi: 0.2,
      gst: 8.2,
      stampDuty: 2,
      dpCharge: 0,
      total: 55.75,
    },
  },
  {
    name: "Zerodha · CDS (currency) — NO STT/CTT (zero tax line)",
    profile: zerodha,
    trade: { segment: "CDS", product: "NRML", ...cds },
    formula:
      "transaction tax 0 (CDS carries neither STT nor CTT) · brokerage flat 20×2=40 · " +
      "exch 166,500×0.00009%=0.149→0.15 · SEBI 166,500/1cr×10=0.1665→0.17 · " +
      "GST (40+0.15+0.17)×18%=7.2576→7.26 · stamp 83,000×0.002%=1.66 · " +
      "total 40+0+0.15+0.17+7.26+1.66=49.23",
    expected: {
      brokerage: 40,
      stt: 0,
      exchange: 0.15,
      sebi: 0.17,
      gst: 7.26,
      stampDuty: 1.66,
      dpCharge: 0,
      total: 49.23,
    },
  },
  // ───────────────────────────── UPSTOX (charges brokerage on delivery) ─────────────────────────────
  {
    name: "Upstox · EQ + MIS (intraday) — flat ₹20 brokerage",
    profile: upstox,
    trade: { segment: "EQ", product: "MIS", ...eq },
    formula:
      "brokerage min(20, 50,500×0.1%=50.5)×2=40 · STT 12.75 · exch 3.10 · SEBI 0.10 · " +
      "GST (40+3.10+0.10)×18%=7.776→7.78 · stamp 1.50 · total 40+12.75+3.10+0.10+7.78+1.50=65.23",
    expected: {
      brokerage: 40,
      stt: 12.75,
      exchange: 3.1,
      sebi: 0.1,
      gst: 7.78,
      stampDuty: 1.5,
      dpCharge: 0,
      total: 65.23,
    },
  },
  {
    name: "Upstox · EQ + CNC (delivery) — still charges brokerage + DP",
    profile: upstox,
    trade: { segment: "EQ", product: "CNC", ...eq },
    formula:
      "brokerage 40 (NOT zero-brokerage) · STT 101 (both sides) · exch 3.10 · SEBI 0.10 · " +
      "GST (40+3.10+0.10)×18%=7.78 · stamp 7.50 · DP 15.34 · total 40+101+3.10+0.10+7.78+7.50+15.34=174.82",
    expected: {
      brokerage: 40,
      stt: 101,
      exchange: 3.1,
      sebi: 0.1,
      gst: 7.78,
      stampDuty: 7.5,
      dpCharge: 15.34,
      total: 174.82,
    },
  },
  // ───────────────────────────── ZERO PROFILE (manual, no charges) ─────────────────────────────
  {
    name: "Zero profile · EQ + MIS — every component 0",
    profile: zero,
    trade: { segment: "EQ", product: "MIS", ...eq },
    formula: "all rates 0 ⇒ every line 0",
    expected: {
      brokerage: 0,
      stt: 0,
      exchange: 0,
      sebi: 0,
      gst: 0,
      stampDuty: 0,
      dpCharge: 0,
      total: 0,
    },
  },
  {
    name: "Zero profile · EQ + CNC — every component 0 (incl. DP)",
    profile: zero,
    trade: { segment: "EQ", product: "CNC", ...eq },
    formula: "all rates 0 ⇒ every line 0 (dpChargePerScrip also 0)",
    expected: {
      brokerage: 0,
      stt: 0,
      exchange: 0,
      sebi: 0,
      gst: 0,
      stampDuty: 0,
      dpCharge: 0,
      total: 0,
    },
  },
  {
    name: "Zero profile · OPT — every component 0",
    profile: zero,
    trade: { segment: "OPT", product: "NRML", ...opt },
    formula: "all rates 0 ⇒ every line 0",
    expected: {
      brokerage: 0,
      stt: 0,
      exchange: 0,
      sebi: 0,
      gst: 0,
      stampDuty: 0,
      dpCharge: 0,
      total: 0,
    },
  },
  {
    name: "Zero profile · COMM — every component 0",
    profile: zero,
    trade: { segment: "COMM", product: "NRML", ...comm },
    formula: "all rates 0 ⇒ every line 0",
    expected: {
      brokerage: 0,
      stt: 0,
      exchange: 0,
      sebi: 0,
      gst: 0,
      stampDuty: 0,
      dpCharge: 0,
      total: 0,
    },
  },
  {
    name: "Zero profile · CDS — every component 0",
    profile: zero,
    trade: { segment: "CDS", product: "NRML", ...cds },
    formula: "all rates 0 ⇒ every line 0",
    expected: {
      brokerage: 0,
      stt: 0,
      exchange: 0,
      sebi: 0,
      gst: 0,
      stampDuty: 0,
      dpCharge: 0,
      total: 0,
    },
  },
];

describe("SEG-02 golden charge table — (segment × product × broker)", () => {
  for (const row of GOLDEN) {
    it(`${row.name}`, () => {
      const actual = computeCharges(row.profile, row.trade);
      expectBreakdown(actual, row.expected);
      // Self-consistency: `total` is the un-rounded sum rounded ONCE, so it may
      // differ from the sum of the individually-rounded component lines by up to
      // one paise (a real, intentional rounding artifact, as on a broker contract
      // note). Assert the total stays within that single-paise band of the sum of
      // the displayed parts.
      const sumOfParts =
        actual.brokerage +
        actual.stt +
        actual.exchange +
        actual.sebi +
        actual.gst +
        actual.stampDuty +
        actual.dpCharge;
      expect(Math.abs(actual.total - sumOfParts)).toBeLessThanOrEqual(0.01 + 1e-9);
    });
  }

  it("covers every meaningful (segment, product) cell + the three broker classes", () => {
    // Documents the matrix breadth so a dropped row is obvious in review.
    const cells = new Set(
      GOLDEN.map(
        (r) =>
          `${r.profile.id}:${r.trade.segment}:${r.trade.product ?? "null"}` +
          `:${r.trade.commodityOption ? "opt" : ""}:${r.trade.agriCommodity ? "agri" : ""}`
      )
    );
    expect(cells.size).toBe(GOLDEN.length); // no accidental duplicate row
    // Zerodha (zero-brokerage delivery), Upstox (charges delivery), zero (manual) all present.
    const brokers = new Set(GOLDEN.map((r) => r.profile.id));
    expect(brokers).toEqual(new Set(["zerodha", "upstox", "zero"]));
  });
});

describe("SEG-02 — legacy back-compat (pre-v4 data has no product)", () => {
  it("equity with product=undefined computes EXACTLY as EQ + MIS (paise-identical)", () => {
    const legacy = computeCharges(zerodha, { segment: "EQ", ...eq });
    const mis = computeCharges(zerodha, { segment: "EQ", product: "MIS", ...eq });
    expectBreakdownEqual(legacy, mis);
  });
  it("equity with product=null computes EXACTLY as EQ + MIS (paise-identical)", () => {
    const legacy = computeCharges(zerodha, { segment: "EQ", product: null, ...eq });
    const mis = computeCharges(zerodha, { segment: "EQ", product: "MIS", ...eq });
    expectBreakdownEqual(legacy, mis);
  });
  it("legacy equity is NOT charged on the delivery (CNC) basis", () => {
    const legacy = computeCharges(zerodha, { segment: "EQ", ...eq });
    const cnc = computeCharges(zerodha, { segment: "EQ", product: "CNC", ...eq });
    expect(legacy.stt).toBe(12.75); // sell-only intraday STT
    expect(cnc.stt).toBe(101); // both-sides delivery STT
    expect(legacy.total).not.toBe(cnc.total);
  });
});

describe("SEG-02 — F&O regression guards (product must NOT change FUT/OPT charges)", () => {
  it("FUT charges are identical with MIS, NRML, or no product", () => {
    const base = computeCharges(zerodha, { segment: "FUT", ...fut });
    const mis = computeCharges(zerodha, { segment: "FUT", product: "MIS", ...fut });
    const nrml = computeCharges(zerodha, { segment: "FUT", product: "NRML", ...fut });
    expectBreakdownEqual(mis, base);
    expectBreakdownEqual(nrml, base);
    expect(base.stt).toBe(903.75); // 0.05% sell, unchanged from pre-SEG-01
  });
  it("OPT charges are identical with MIS, NRML, or no product", () => {
    const base = computeCharges(zerodha, { segment: "OPT", ...opt });
    const mis = computeCharges(zerodha, { segment: "OPT", product: "MIS", ...opt });
    const nrml = computeCharges(zerodha, { segment: "OPT", product: "NRML", ...opt });
    expectBreakdownEqual(mis, base);
    expectBreakdownEqual(nrml, base);
    expect(base.stt).toBe(13.5); // 0.15% sell premium, unchanged from pre-SEG-01
  });
});

describe("SEG-02 — paise rounding behaviour at boundaries", () => {
  it("rounds a half-paise component UP (Math.round half-up): SEBI 0.105 → 0.11", () => {
    // EQ flat trade: 100 sh @ ₹525 both sides ⇒ total turnover 1,05,000.
    // SEBI = 1,05,000/1cr × ₹10 = 0.105 → rounds to 0.11 (half UP).
    const b = computeCharges(zerodha, {
      segment: "EQ",
      product: "MIS",
      qty: 100,
      entryPrice: 525,
      exitPrice: 525,
      direction: "long",
    });
    expect(b.sebi).toBe(0.11);
  });
  it("rounds sub-half-paise DOWN: SEBI 0.101 → 0.10", () => {
    // canonical EQ trade total 1,01,000 ⇒ SEBI 0.101 → 0.10.
    const b = computeCharges(zerodha, { segment: "EQ", product: "MIS", ...eq });
    expect(b.sebi).toBe(0.1);
  });
  it("each returned component is paise-precise (≤ 2 decimal places)", () => {
    const b = computeCharges(zerodha, { segment: "OPT", product: "NRML", ...opt });
    for (const v of Object.values(b)) {
      expect(Number.isInteger(Math.round(v * 100))).toBe(true);
      expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-9);
    }
  });
  it("charges are symmetric for long vs short (same buy/sell turnover)", () => {
    const longT = computeCharges(zerodha, { segment: "EQ", product: "CNC", ...eq });
    const shortT = computeCharges(zerodha, {
      segment: "EQ",
      product: "CNC",
      qty: 100,
      entryPrice: 510,
      exitPrice: 500,
      direction: "short",
    });
    expectBreakdownEqual(shortT, longT);
  });
});

/** Strict paise-exact equality of two breakdowns. */
function expectBreakdownEqual(a: ChargeBreakdown, b: ChargeBreakdown) {
  expect(a.brokerage).toBe(b.brokerage);
  expect(a.stt).toBe(b.stt);
  expect(a.exchange).toBe(b.exchange);
  expect(a.sebi).toBe(b.sebi);
  expect(a.gst).toBe(b.gst);
  expect(a.stampDuty).toBe(b.stampDuty);
  expect(a.dpCharge).toBe(b.dpCharge);
  expect(a.total).toBe(b.total);
}
