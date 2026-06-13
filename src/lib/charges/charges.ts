import type { ChargeProfile } from "@/config/brokers";

export type Segment = "EQ" | "FUT" | "OPT" | "COMM" | "CDS";

export type Product = "MIS" | "CNC" | "NRML" | "BTST" | "STBT";

export interface TradeForCharges {
  segment: Segment;
  /**
   * Position product. Drives the equity STT/stamp basis and the commodity CTT
   * branch. Absent/legacy (null) is treated as MIS — the pre-v4 intraday
   * behaviour, so charges on existing trades never change.
   */
  product?: Product | null;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  /** 'long' buys first then sells; 'short' sells first then buys. Charges are symmetric. */
  direction: "long" | "short";
  /** Number of executed orders (default 2: one entry, one exit). */
  orders?: number;
  /**
   * Agricultural commodity (e.g. wheat, cotton) — exempt from CTT. Only relevant
   * when segment === 'COMM'. Defaults to false (non-agri, CTT applies).
   */
  agriCommodity?: boolean;
  /**
   * A commodity *option* (vs the default commodity future). Only relevant when
   * segment === 'COMM': commodity options carry CTT 0.05% on the sell premium,
   * commodity futures CTT 0.01% on the sell turnover.
   */
  commodityOption?: boolean;
}

export interface ChargeBreakdown {
  brokerage: number;
  /**
   * Transaction tax: STT (equity/F&O), CTT (commodity), or 0 (currency — CDS
   * carries neither STT nor CTT; we emit a zero line, never a phantom STT).
   */
  stt: number;
  exchange: number;
  sebi: number;
  gst: number;
  stampDuty: number;
  /** Depository (DP) charge — flat ₹ on an equity delivery (CNC) sell, else 0. */
  dpCharge: number;
  total: number;
}

/** A delivery-basis equity product (held overnight): CNC, BTST or STBT. */
const isEquityDelivery = (product: Product | null | undefined): boolean =>
  product === "CNC" || product === "BTST" || product === "STBT";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Computes Indian market charges for a round-trip trade, dispatching on
 * (segment, product). For options, "turnover" means premium turnover (price ×
 * qty). All money is paise-precise; round only at display.
 *
 * Branches:
 *   EQ + MIS (intraday)           STT 0.025% sell-only · stamp 0.003% buy
 *   EQ + CNC/BTST/STBT (delivery) STT 0.1% BOTH sides · stamp 0.015% buy
 *                                 + DP charge on the sell (CNC only; BTST/STBT
 *                                   settle without a debit so no DP) · zero
 *                                   exit-brokerage for zero-brokerage brokers
 *   FUT (F&O)                     STT 0.05% sell — unchanged
 *   OPT (F&O)                     STT 0.15% sell premium — unchanged
 *   COMM (commodity, MCX)         CTT 0.01% non-agri FUT sell / 0.05% OPT
 *                                 premium · agri exempt · NO STT
 *   CDS (currency)                NO STT/CTT — emits a zero transaction-tax line
 */
export function computeCharges(profile: ChargeProfile, t: TradeForCharges): ChargeBreakdown {
  const buyPrice = t.direction === "long" ? t.entryPrice : t.exitPrice;
  const sellPrice = t.direction === "long" ? t.exitPrice : t.entryPrice;
  const buyTurnover = buyPrice * t.qty;
  const sellTurnover = sellPrice * t.qty;
  const totalTurnover = buyTurnover + sellTurnover;
  const orders = t.orders ?? 2;
  const product = t.product ?? null;
  const equityDelivery = t.segment === "EQ" && isEquityDelivery(product);

  // Brokerage. Options/CDS: flat per order. Equity/futures/commodity: % of
  // turnover capped at the flat fee. Zero-brokerage-delivery brokers charge no
  // brokerage on an equity delivery (CNC/BTST/STBT) round trip.
  const perOrderTurnover = totalTurnover / orders;
  const maxPct =
    t.segment === "EQ"
      ? profile.brokerageEqMaxPct
      : t.segment === "FUT" || t.segment === "COMM"
        ? profile.brokerageFutMaxPct
        : 0;
  let brokerage =
    maxPct > 0
      ? Math.min(profile.brokeragePerOrder, perOrderTurnover * maxPct) * orders
      : profile.brokeragePerOrder * orders;
  if (equityDelivery && profile.zeroBrokerageDelivery) brokerage = 0;

  let stt = 0;
  let exchange = 0;
  let stampDuty = 0;
  let dpCharge = 0;

  if (t.segment === "OPT") {
    stt = sellTurnover * profile.sttOptionSellPct;
    exchange = totalTurnover * profile.exchangeOptionPct;
    stampDuty = buyTurnover * profile.stampOptionBuyPct;
  } else if (t.segment === "FUT") {
    stt = sellTurnover * profile.sttFutureSellPct;
    exchange = totalTurnover * profile.exchangeFuturePct;
    stampDuty = buyTurnover * profile.stampFutureBuyPct;
  } else if (t.segment === "COMM") {
    // Commodity (MCX): CTT, not STT. Agri commodities are CTT-exempt. Commodity
    // options carry CTT on the sell premium (0.05%); commodity futures on the
    // sell turnover (0.01%). Both on the SELL side only.
    const cttPct = t.agriCommodity
      ? 0
      : t.commodityOption
        ? profile.cttOptionPct
        : profile.cttFuturePct;
    stt = sellTurnover * cttPct;
    exchange = totalTurnover * profile.exchangeCommodityPct;
    stampDuty = buyTurnover * profile.stampFutureBuyPct;
  } else if (t.segment === "CDS") {
    // Currency derivatives: NO STT and NO CTT. Emit a zero transaction-tax line.
    stt = 0;
    exchange = totalTurnover * profile.exchangeCurrencyPct;
    stampDuty = buyTurnover * profile.stampFutureBuyPct;
  } else if (equityDelivery) {
    // Equity delivery (CNC/BTST/STBT): STT 0.1% on BOTH sides, higher stamp,
    // and a per-scrip DP charge on the delivery sell (CNC only — BTST/STBT
    // settle without a demat debit, so no DP).
    stt = totalTurnover * profile.sttEquityDeliveryPct;
    exchange = totalTurnover * profile.exchangeEquityPct;
    stampDuty = buyTurnover * profile.stampEquityDeliveryBuyPct;
    if (product === "CNC") dpCharge = profile.dpChargePerScrip;
  } else {
    // Equity intraday (MIS / legacy-null): STT 0.025% sell-only, stamp 0.003%.
    stt = sellTurnover * profile.sttEquityIntradaySellPct;
    exchange = totalTurnover * profile.exchangeEquityPct;
    stampDuty = buyTurnover * profile.stampEquityIntradayBuyPct;
  }

  const sebi = (totalTurnover / 1_00_00_000) * profile.sebiPerCrore;
  // DP charge already includes GST; GST applies to brokerage + exchange + SEBI.
  const gst = (brokerage + exchange + sebi) * profile.gstPct;
  const total = brokerage + stt + exchange + sebi + gst + stampDuty + dpCharge;

  return {
    brokerage: r2(brokerage),
    stt: r2(stt),
    exchange: r2(exchange),
    sebi: r2(sebi),
    gst: r2(gst),
    stampDuty: r2(stampDuty),
    dpCharge: r2(dpCharge),
    total: r2(total),
  };
}

export function computeGrossPnl(t: {
  direction: "long" | "short";
  qty: number;
  entryPrice: number;
  exitPrice: number;
}): number {
  const diff = t.direction === "long" ? t.exitPrice - t.entryPrice : t.entryPrice - t.exitPrice;
  return r2(diff * t.qty);
}

/** R multiple achieved, given a planned stop. Returns null when no meaningful risk. */
export function computeRMultiple(t: {
  direction: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  plannedEntry: number | null;
  plannedSl: number | null;
}): number | null {
  if (t.plannedSl == null) return null;
  const ref = t.plannedEntry ?? t.entryPrice;
  const risk = Math.abs(ref - t.plannedSl);
  if (risk <= 0) return null;
  const move = t.direction === "long" ? t.exitPrice - t.entryPrice : t.entryPrice - t.exitPrice;
  return Math.round((move / risk) * 100) / 100;
}
