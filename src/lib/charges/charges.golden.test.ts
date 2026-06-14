import { describe, expect, it } from "vitest";
import { computeCharges, type ChargeBreakdown, type TradeForCharges } from "./charges";
import { getChargeProfile } from "@/config/brokers";

/**
 * SEG-02 / SEG-CHG — Charge-engine GOLDEN TABLE.
 *
 * This file locks the exact money math of the per-(segment, product, exchange)
 * charge engine against values computed BY HAND below, so the engine can never
 * silently drift. Every expected number is in RUPEES, rounded to paise (2 dp),
 * exactly as `computeCharges` returns. Each row documents its formula as a
 * comment so a human can re-verify against zerodha.com/charges and the statutory
 * rate sheet.
 *
 * Statutory rates (fractions, verified June 2026 / Budget 2026):
 *   STT  — eq intraday 0.025% sell · eq delivery 0.1% BOTH sides ·
 *          futures 0.05% sell · options 0.15% sell premium
 *   CTT  — commodity non-agri future 0.01% sell · option 0.05% premium sell ·
 *          agri EXEMPT · NO STT on commodities · currency (CDS) NO STT/CTT
 *   Exchange txn (per EXCHANGE — SEG-CHG, on premium/turnover):
 *     NSE  eq 0.00307% · fut 0.00183% · opt 0.03553% · cds-fut 0.00035% · cds-opt 0.0311%
 *     BSE  eq 0.00375% · fut 0% · opt 0.0325%
 *     MCX  commodity fut 0.0021% (uniform) · commodity opt 0.0418%
 *     NCDEX commodity agri-fut 0.003% · non-agri/processed fut 0.0058% · opt 0.03%
 *   SEBI ₹10 / crore (₹1 / crore for AGRI commodities)
 *   GST  18% on (brokerage + exchange txn + SEBI)   [NOT on STT/stamp/DP]
 *   stamp (BUY side) — opt/eq-intraday/commodity-opt 0.003% · futures/commodity-fut 0.002% ·
 *                      eq-delivery 0.015% · currency 0.0001%
 *   DP   ₹15.34 (incl. GST) per scrip on an equity DELIVERY (CNC) sell
 *   Zerodha brokerage: ₹20 or 0.03% per order (whichever lower); ₹0 on eq delivery;
 *                      flat ₹20 on options (incl. commodity options)
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
// CDS future: 1,000 @ ₹83 → ₹83.5 (buy 83,000 · sell 83,500 · total 166,500).
const cds = { qty: 1000, entryPrice: 83, exitPrice: 83.5, direction: "long" as const };
// CDS option: 1,000 @ ₹2 → ₹2.5 premium (buy 2,000 · sell 2,500 · total 4,500).
const cdsOpt = { qty: 1000, entryPrice: 2, exitPrice: 2.5, direction: "long" as const };
// FUT: 75 @ ₹24,000 → ₹24,100 (buy 18,00,000 · sell 18,07,500 · total 36,07,500).
const fut = { qty: 75, entryPrice: 24000, exitPrice: 24100, direction: "long" as const };
// OPT: 75 @ ₹100 → ₹120 premium (buy 7,500 · sell 9,000 · total 16,500).
const opt = { qty: 75, entryPrice: 100, exitPrice: 120, direction: "long" as const };
// BSE OPT: 75 @ ₹100 → ₹120 premium (same fixture; only exchange differs).
const bseOpt = { qty: 75, entryPrice: 100, exitPrice: 120, direction: "long" as const };

const GOLDEN: GoldenRow[] = [
  // ───────────────────────────── ZERODHA (NSE) ─────────────────────────────
  {
    name: "Zerodha · EQ + MIS (intraday) · NSE",
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
    // Finding (16): per-leg brokerage cap. A long that ran up hard —
    // 100 sh @ ₹400 → ₹800 — has a LOPSIDED round trip: buyTurnover 40,000 ≪
    // sellTurnover 80,000. The cap is statutory PER ORDER, capped against THAT
    // leg's own turnover, NOT the average. The sell leg's % (80,000×0.03%=24)
    // clears the ₹20 flat cap (→ capped at 20) while the buy leg's % (12) does
    // not, so brokerage = 12 + 20 = 32.00. The OLD average-based math computed
    // min(20, (120,000/2)×0.03%=18)×2 = 18×2 = 36.00 — overcharging by ₹4 on
    // the buy leg (whose true % was only ₹12). This row LOCKS the per-leg fix:
    // 32.00 ≠ the old 36.00.
    name: "Zerodha · EQ + MIS (LOPSIDED, per-leg cap) · NSE — Finding (16)",
    profile: zerodha,
    trade: {
      segment: "EQ",
      product: "MIS",
      qty: 100,
      entryPrice: 400,
      exitPrice: 800,
      direction: "long",
    },
    formula:
      "brokerage min(20, 40,000×0.03%=12)=12 + min(20, 80,000×0.03%=24→20)=20 ⇒ 32.00 " +
      "(per-leg; OLD average min(20, 60,000×0.03%=18)×2=36.00) · STT 80,000×0.025%=20 (sell) · " +
      "exch 120,000×0.00307%=3.684→3.68 · SEBI 120,000/1cr×10=0.12 · " +
      "GST (32+3.684+0.12)×18%=6.44472→6.44 · stamp 40,000×0.003%=1.20 · DP 0 · " +
      "total 32+20+3.684+0.12+6.44472+1.20=63.44872→63.45",
    expected: {
      brokerage: 32,
      stt: 20,
      exchange: 3.68,
      sebi: 0.12,
      gst: 6.44,
      stampDuty: 1.2,
      dpCharge: 0,
      total: 63.45,
    },
  },
  {
    name: "Zerodha · EQ + CNC (delivery) · NSE",
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
    name: "Zerodha · EQ + BTST (delivery basis, no DP) · NSE",
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
    name: "Zerodha · EQ + STBT (delivery basis, no DP) · NSE",
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
    name: "Zerodha · FUT + NRML (carry) · NSE — regression guard",
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
    name: "Zerodha · OPT + NRML · NSE — regression guard",
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
  // ───────── MCX commodity (SEG-CHG: txn 0.0021% fut / 0.0418% opt; agri exempt + ₹1/cr) ─────────
  {
    name: "Zerodha · COMM future (non-agri) · MCX — CTT 0.01%, exch 0.0021%, NO STT",
    profile: zerodha,
    trade: { segment: "COMM", product: "NRML", ...comm },
    formula:
      "brokerage 20×2=40 (cap 100,500×0.03%=30.15 > 20 → flat) · CTT 101,000×0.01%=10.10 (sell) · " +
      "exch 201,000×0.0021%=4.221→4.22 · SEBI 201,000/1cr×10=0.201→0.20 · " +
      "GST (40+4.22+0.20)×18%=7.9956→8.00 · stamp 100,000×0.002%=2 · total 40+10.10+4.22+0.20+8.00+2=64.52",
    expected: {
      brokerage: 40,
      stt: 10.1,
      exchange: 4.22,
      sebi: 0.2,
      gst: 8,
      stampDuty: 2,
      dpCharge: 0,
      total: 64.52,
    },
  },
  {
    name: "Zerodha · COMM option (non-agri) · MCX — CTT 0.05%, exch 0.0418% premium, stamp 0.003%",
    profile: zerodha,
    trade: { segment: "COMM", product: "NRML", commodityOption: true, ...comm },
    formula:
      "brokerage flat 20×2=40 (option → no % cap) · CTT 101,000×0.05%=50.50 (sell premium) · " +
      "exch 201,000×0.0418%=84.018→84.02 · SEBI 0.20 · GST (40+84.02+0.20)×18%=22.3596→22.36 · " +
      "stamp 100,000×0.003%=3 · total 40+50.50+84.02+0.20+22.36+3=200.08",
    expected: {
      brokerage: 40,
      stt: 50.5,
      exchange: 84.02,
      sebi: 0.2,
      gst: 22.36,
      stampDuty: 3,
      dpCharge: 0,
      total: 200.08,
    },
  },
  {
    name: "Zerodha · COMM agri · MCX — CTT EXEMPT, SEBI ₹1/cr",
    profile: zerodha,
    trade: { segment: "COMM", product: "NRML", agriCommodity: true, ...comm },
    formula:
      "agri ⇒ CTT 0, SEBI 201,000/1cr×1=0.0201→0.02 · brokerage 40 · exch 201,000×0.0021%=4.22 · " +
      "GST (40+4.22+0.02)×18%=7.9596→7.96 · stamp 2 · total 40+0+4.22+0.02+7.96+2=54.20",
    expected: {
      brokerage: 40,
      stt: 0,
      exchange: 4.22,
      sebi: 0.02,
      gst: 7.96,
      stampDuty: 2,
      dpCharge: 0,
      total: 54.2,
    },
  },
  // ───────── NCDEX commodity (SEG-CHG: agri-fut 0.003% / non-agri 0.0058%) ─────────
  {
    name: "Zerodha · COMM agri future · NCDEX — exch 0.003%, CTT-exempt, SEBI ₹1/cr",
    profile: zerodha,
    trade: { segment: "COMM", product: "NRML", agriCommodity: true, exchange: "NCDEX", ...comm },
    formula:
      "agri ⇒ CTT 0 · exch 201,000×0.003%=6.03 · SEBI 201,000/1cr×1=0.0201→0.02 · brokerage 40 · " +
      "GST (40+6.03+0.02)×18%=8.289→8.29 · stamp 100,000×0.002%=2 · total 40+0+6.03+0.02+8.29+2=56.34",
    expected: {
      brokerage: 40,
      stt: 0,
      exchange: 6.03,
      sebi: 0.02,
      gst: 8.29,
      stampDuty: 2,
      dpCharge: 0,
      total: 56.34,
    },
  },
  {
    name: "Zerodha · COMM non-agri future (Guar Gum) · NCDEX — exch 0.0058%, CTT 0.01%, SEBI ₹10/cr",
    profile: zerodha,
    trade: { segment: "COMM", product: "NRML", exchange: "NCDEX", ...comm },
    formula:
      "non-agri ⇒ CTT 101,000×0.01%=10.10 · exch 201,000×0.0058%=11.658→11.66 · SEBI 0.20 · brokerage 40 · " +
      "GST (40+11.66+0.20)×18%=9.3348→9.33 · stamp 2 · total 40+10.10+11.66+0.20+9.33+2=73.29",
    expected: {
      brokerage: 40,
      stt: 10.1,
      exchange: 11.66,
      sebi: 0.2,
      gst: 9.33,
      stampDuty: 2,
      dpCharge: 0,
      total: 73.29,
    },
  },
  // ───────── Currency (CDS) — SEG-CHG: fut exch 0.00035%, opt 0.0311%, stamp 0.0001% ─────────
  {
    name: "Zerodha · CDS future · NSE — NO STT/CTT, exch 0.00035%, stamp 0.0001%",
    profile: zerodha,
    trade: { segment: "CDS", product: "NRML", ...cds },
    formula:
      "transaction tax 0 (CDS carries neither STT nor CTT) · brokerage flat 20×2=40 · " +
      "exch 166,500×0.00035%=0.58275→0.58 · SEBI 166,500/1cr×10=0.1665→0.17 · " +
      "GST (40+0.58+0.17)×18%=7.3350→7.33 · stamp 83,000×0.0001%=0.083→0.08 · " +
      "total 40+0+0.58+0.17+7.33+0.08=48.16 (un-rounded sum 48.17→ rounded once)",
    expected: {
      brokerage: 40,
      stt: 0,
      exchange: 0.58,
      sebi: 0.17,
      gst: 7.33,
      stampDuty: 0.08,
      dpCharge: 0,
      total: 48.17,
    },
  },
  {
    name: "Zerodha · CDS option · NSE — exch 0.0311% premium, NO STT/CTT",
    profile: zerodha,
    trade: { segment: "CDS", product: "NRML", isOption: true, ...cdsOpt },
    formula:
      "tax 0 · brokerage flat 40 · exch 4,500×0.0311%=1.3995→1.40 · SEBI 4,500/1cr×10=0.0045→0.00 · " +
      "GST (40+1.40+0.00)×18%=7.452→7.45 · stamp 2,000×0.0001%=0.002→0.00 · total 40+1.40+0+7.45+0=48.86",
    expected: {
      brokerage: 40,
      stt: 0,
      exchange: 1.4,
      sebi: 0,
      gst: 7.45,
      stampDuty: 0,
      dpCharge: 0,
      total: 48.86,
    },
  },
  // ───────── BSE (SEG-CHG: eq 0.00375% · fut 0% · opt 0.0325%) ─────────
  {
    name: "Zerodha · FUT + NRML · BSE — exch 0 (BSE futures free)",
    profile: zerodha,
    trade: { segment: "FUT", product: "NRML", exchange: "BSE", ...fut },
    formula:
      "brokerage 40 · STT 903.75 (sell) · exch 36,07,500×0%=0 · SEBI 3.61 · " +
      "GST (40+0+3.61)×18%=7.8498→7.85 · stamp 36 · total 40+903.75+0+3.61+7.85+36=991.21",
    expected: {
      brokerage: 40,
      stt: 903.75,
      exchange: 0,
      sebi: 3.61,
      gst: 7.85,
      stampDuty: 36,
      dpCharge: 0,
      total: 991.21,
    },
  },
  {
    name: "Zerodha · OPT + NRML · BSE — exch 0.0325% premium",
    profile: zerodha,
    trade: { segment: "OPT", product: "NRML", exchange: "BSE", ...bseOpt },
    formula:
      "brokerage flat 40 · STT 9,000×0.15%=13.50 (sell premium) · exch 16,500×0.0325%=5.3625→5.36 · " +
      "SEBI 0.02 · GST (40+5.36+0.02)×18%=8.1684→8.17 · stamp 7,500×0.003%=0.225→0.23 · " +
      "total 40+13.50+5.36+0.02+8.17+0.23=67.28 (un-rounded sum 67.27→ rounded once)",
    expected: {
      brokerage: 40,
      stt: 13.5,
      exchange: 5.36,
      sebi: 0.02,
      gst: 8.17,
      stampDuty: 0.23,
      dpCharge: 0,
      total: 67.27,
    },
  },
  {
    name: "Zerodha · EQ + MIS · BSE — exch 0.00375%",
    profile: zerodha,
    trade: { segment: "EQ", product: "MIS", exchange: "BSE", ...eq },
    formula:
      "brokerage 30.30 · STT 51,000×0.025%=12.75 (sell) · exch 101,000×0.00375%=3.7875→3.79 · " +
      "SEBI 0.10 · GST (30.30+3.79+0.10)×18%=6.1542→6.15 · stamp 50,000×0.003%=1.50 · " +
      "total 30.30+12.75+3.79+0.10+6.15+1.50=54.59",
    expected: {
      brokerage: 30.3,
      stt: 12.75,
      exchange: 3.79,
      sebi: 0.1,
      gst: 6.15,
      stampDuty: 1.5,
      dpCharge: 0,
      total: 54.59,
    },
  },
  // ───────────────────────────── UPSTOX (charges brokerage on delivery) ─────────────────────────────
  {
    name: "Upstox · EQ + MIS (intraday) · NSE — flat ₹20 brokerage",
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
    name: "Upstox · EQ + CNC (delivery) · NSE — still charges brokerage + DP",
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
    name: "Zero profile · COMM agri · NCDEX — every component 0",
    profile: zero,
    trade: { segment: "COMM", product: "NRML", agriCommodity: true, exchange: "NCDEX", ...comm },
    formula: "all rates 0 (incl. agri SEBI & NCDEX txn) ⇒ every line 0",
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
    name: "Zero profile · FUT · BSE — every component 0",
    profile: zero,
    trade: { segment: "FUT", product: "NRML", exchange: "BSE", ...fut },
    formula: "all rates 0 (incl. BSE txn) ⇒ every line 0",
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

describe("SEG-02/SEG-CHG golden charge table — (segment × product × exchange × broker)", () => {
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

  it("covers every meaningful (segment, product, exchange) cell + the three broker classes", () => {
    // Documents the matrix breadth so a dropped row is obvious in review.
    const cells = new Set(
      GOLDEN.map(
        (r) =>
          `${r.profile.id}:${r.trade.segment}:${r.trade.product ?? "null"}` +
          `:${r.trade.exchange ?? "default"}` +
          `:${r.trade.commodityOption ? "comOpt" : ""}:${r.trade.isOption ? "ccyOpt" : ""}` +
          `:${r.trade.agriCommodity ? "agri" : ""}` +
          // Price fixture distinguishes the LOPSIDED per-leg-cap row (Finding 16)
          // from the canonical EQ+MIS row, which share (broker,segment,product,exchange).
          `:${r.trade.entryPrice}-${r.trade.exitPrice}`
      )
    );
    expect(cells.size).toBe(GOLDEN.length); // no accidental duplicate row
    // Zerodha (zero-brokerage delivery), Upstox (charges delivery), zero (manual) all present.
    const brokers = new Set(GOLDEN.map((r) => r.profile.id));
    expect(brokers).toEqual(new Set(["zerodha", "upstox", "zero"]));
    // Every exchange exercised.
    const exchanges = new Set(GOLDEN.map((r) => r.trade.exchange ?? "default"));
    expect(exchanges).toEqual(new Set(["default", "NCDEX", "BSE"]));
  });
});

describe("SEG-CHG — exchange back-compat (undefined exchange == the segment default, paise-identical)", () => {
  it("NSE EQ: exchange=undefined === exchange='NSE'", () => {
    const legacy = computeCharges(zerodha, { segment: "EQ", product: "MIS", ...eq });
    const nse = computeCharges(zerodha, { segment: "EQ", product: "MIS", exchange: "NSE", ...eq });
    expectBreakdownEqual(legacy, nse);
  });
  it("FUT: exchange=undefined === exchange='NSE'", () => {
    const legacy = computeCharges(zerodha, { segment: "FUT", product: "NRML", ...fut });
    const nse = computeCharges(zerodha, {
      segment: "FUT",
      product: "NRML",
      exchange: "NSE",
      ...fut,
    });
    expectBreakdownEqual(legacy, nse);
  });
  it("OPT: exchange=undefined === exchange='NSE'", () => {
    const legacy = computeCharges(zerodha, { segment: "OPT", product: "NRML", ...opt });
    const nse = computeCharges(zerodha, {
      segment: "OPT",
      product: "NRML",
      exchange: "NSE",
      ...opt,
    });
    expectBreakdownEqual(legacy, nse);
  });
  it("COMM: exchange=undefined === exchange='MCX' (segment default is MCX)", () => {
    const legacy = computeCharges(zerodha, { segment: "COMM", product: "NRML", ...comm });
    const mcx = computeCharges(zerodha, {
      segment: "COMM",
      product: "NRML",
      exchange: "MCX",
      ...comm,
    });
    expectBreakdownEqual(legacy, mcx);
  });
  it("CDS: exchange=undefined === exchange='NSE'", () => {
    const legacy = computeCharges(zerodha, { segment: "CDS", product: "NRML", ...cds });
    const nse = computeCharges(zerodha, {
      segment: "CDS",
      product: "NRML",
      exchange: "NSE",
      ...cds,
    });
    expectBreakdownEqual(legacy, nse);
  });
  it("empty-string and unknown free-text exchange fall back to the segment default", () => {
    const base = computeCharges(zerodha, { segment: "EQ", product: "MIS", ...eq });
    for (const x of ["", "  ", "WHATEVER"]) {
      expectBreakdownEqual(
        computeCharges(zerodha, { segment: "EQ", product: "MIS", exchange: x, ...eq }),
        base
      );
    }
  });
  it("broker free-text exchanges normalise (NSE_EQ→NSE, BFO→BSE, ncdex→NCDEX)", () => {
    const nseEq = computeCharges(zerodha, {
      segment: "EQ",
      product: "MIS",
      exchange: "NSE_EQ",
      ...eq,
    });
    const nse = computeCharges(zerodha, { segment: "EQ", product: "MIS", exchange: "NSE", ...eq });
    expectBreakdownEqual(nseEq, nse);

    const bfo = computeCharges(zerodha, {
      segment: "FUT",
      product: "NRML",
      exchange: "BFO",
      ...fut,
    });
    const bse = computeCharges(zerodha, {
      segment: "FUT",
      product: "NRML",
      exchange: "BSE",
      ...fut,
    });
    expectBreakdownEqual(bfo, bse);

    const lower = computeCharges(zerodha, {
      segment: "COMM",
      product: "NRML",
      agriCommodity: true,
      exchange: "ncdex",
      ...comm,
    });
    const ncdex = computeCharges(zerodha, {
      segment: "COMM",
      product: "NRML",
      agriCommodity: true,
      exchange: "NCDEX",
      ...comm,
    });
    expectBreakdownEqual(lower, ncdex);
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
