import type { ChargeProfile, Exchange } from "@/config/brokers";

export type { Exchange };

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
  /**
   * Exchange the trade was executed on (SEG-CHG). Only the exchange transaction
   * charge varies by exchange. Absent/legacy (null/"") resolves to the segment
   * default (EQ/FUT/OPT → NSE, COMM → MCX, CDS → NSE) so existing trades — which
   * never stored a real exchange — are charged byte-identically to before.
   */
  exchange?: Exchange | string | null;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  /** 'long' buys first then sells; 'short' sells first then buys. Charges are symmetric. */
  direction: "long" | "short";
  /** Number of executed orders (default 2: one entry, one exit). */
  orders?: number;
  /**
   * Agricultural commodity (e.g. wheat, cotton) — exempt from CTT and charged
   * the lower ₹1/crore SEBI slab. Only relevant when segment === 'COMM'.
   * Defaults to false (non-agri, CTT applies, ₹10/crore SEBI).
   */
  agriCommodity?: boolean;
  /**
   * A commodity *option* (vs the default commodity future). Only relevant when
   * segment === 'COMM': commodity options carry CTT 0.05% on the sell premium,
   * commodity futures CTT 0.01% on the sell turnover.
   */
  commodityOption?: boolean;
  /**
   * A currency *option* (vs the default currency future). Only relevant when
   * segment === 'CDS': currency options carry the option exchange rate on the
   * premium turnover (currency futures the lower futures rate). Neither carries
   * STT/CTT.
   */
  isOption?: boolean;
  /**
   * EXERCISE settlement of a net-long ITM option at expiry (the "STT trap").
   * Only relevant when segment === 'OPT'. When set, the leg was NOT sold back in
   * the market — it was exercised/settled at intrinsic value — so the ordinary
   * 0.15% premium-SELL STT does NOT apply; instead the buyer pays the exercise
   * STT (0.125%) on the INTRINSIC settlement notional carried here. `exitPrice`
   * is the intrinsic settlement price (so gross P&L is correct); the premium-sell
   * exchange/stamp lines still bill on the leg's own turnover as before.
   */
  exercise?: {
    /** |strike − settlementSpot| × qty — the intrinsic settlement value exercised. */
    intrinsicNotional: number;
  };
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
  /**
   * EXERCISE STT (the "STT trap") — 0.125% of the intrinsic settlement value of a
   * net-long ITM option exercised at expiry. 0 for every non-exercise trade (the
   * default), so existing breakdowns are byte-identical.
   */
  exerciseStt: number;
  total: number;
}

/** A delivery-basis equity product (held overnight): CNC, BTST or STBT. */
const isEquityDelivery = (product: Product | null | undefined): boolean =>
  product === "CNC" || product === "BTST" || product === "STBT";

const VALID_EXCHANGES = new Set<Exchange>(["NSE", "BSE", "MCX", "NCDEX"]);

/**
 * Resolves the effective {@link Exchange} for a trade (SEG-CHG). A trade may
 * carry an explicit exchange, a normalisable broker free-text value
 * ("NSE_EQ", "nse", "ncdex"), or nothing at all (every pre-SEG-CHG row). When
 * the value is missing or unrecognised it falls back to the segment default —
 * EQ/FUT/OPT → NSE, COMM → MCX, CDS → NSE — so existing trades are charged
 * exactly as before.
 */
export function resolveExchange(segment: Segment, exchange?: Exchange | string | null): Exchange {
  if (exchange) {
    const up = String(exchange).trim().toUpperCase();
    // Exact union match first, then a prefix match for broker free-text like
    // "NSE_EQ" / "NSEFO" / "MCX-COMM".
    if (VALID_EXCHANGES.has(up as Exchange)) return up as Exchange;
    if (up.startsWith("NCDEX")) return "NCDEX"; // before NSE/BSE — distinct prefix
    if (up.startsWith("NSE") || up.startsWith("NFO") || up.startsWith("CDS")) return "NSE";
    if (up.startsWith("BSE") || up.startsWith("BFO")) return "BSE";
    if (up.startsWith("MCX")) return "MCX";
  }
  return segment === "COMM" ? "MCX" : "NSE";
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Computes Indian market charges for a round-trip trade, dispatching on
 * (segment, product, exchange). For options, "turnover" means premium turnover
 * (price × qty). All money is paise-precise; round only at display.
 *
 * Branches:
 *   EQ + MIS (intraday)           STT 0.025% sell-only · stamp 0.003% buy
 *   EQ + CNC/BTST/STBT (delivery) STT 0.1% BOTH sides · stamp 0.015% buy
 *                                 + DP charge on the sell (CNC only; BTST/STBT
 *                                   settle without a debit so no DP) · zero
 *                                   exit-brokerage for zero-brokerage brokers
 *   FUT (F&O)                     STT 0.05% sell — unchanged
 *   OPT (F&O)                     STT 0.15% sell premium — unchanged
 *   COMM (commodity, MCX/NCDEX)   CTT 0.01% non-agri FUT sell / 0.05% OPT
 *                                 premium · agri exempt (₹1/cr SEBI) · NO STT ·
 *                                 stamp 0.002% FUT / 0.003% OPT
 *   CDS (currency)                NO STT/CTT · stamp 0.0001% · zero tax line
 *
 * Only the exchange *transaction* charge (and the agri SEBI slab) vary by
 * exchange; STT/CTT/stamp/GST are statutory.
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
  const exch = resolveExchange(t.segment, t.exchange);
  const txn = profile.exchangeTxn[exch];

  // Brokerage. Options/CDS: flat per order. Equity/futures/commodity: % of
  // turnover capped at the flat fee. Commodity OPTIONS bill flat like F&O
  // options. Zero-brokerage-delivery brokers charge no brokerage on an equity
  // delivery (CNC/BTST/STBT) round trip.
  //
  // The percentage cap is statutory PER ORDER (per leg), capped against THAT
  // leg's own turnover — NOT the average across legs. For a lopsided round trip
  // (e.g. a long whose price ran up: buyTurnover ≪ sellTurnover) the average
  // misprices, because one leg's % may clear the flat cap while the other does
  // not. The standard round trip is two legs (buy + sell), so cap each side
  // against its own turnover: min(flat, buyTurnover×pct) + min(flat, sellTurnover×pct).
  // For the rare multi-fill case (orders ≠ 2) we still only know aggregate
  // buy/sell turnover, so we split the flat capacity evenly across the two
  // sides — flat × (orders/2) per side — keeping total flat capacity = flat ×
  // orders, identical to the old behaviour when orders === 2.
  const commodityFuture = t.segment === "COMM" && !t.commodityOption;
  const maxPct =
    t.segment === "EQ"
      ? profile.brokerageEqMaxPct
      : t.segment === "FUT" || commodityFuture
        ? profile.brokerageFutMaxPct
        : 0;
  let brokerage: number;
  if (maxPct > 0) {
    const flatPerSide = profile.brokeragePerOrder * (orders / 2);
    brokerage =
      Math.min(flatPerSide, buyTurnover * maxPct) + Math.min(flatPerSide, sellTurnover * maxPct);
  } else {
    brokerage = profile.brokeragePerOrder * orders;
  }
  if (equityDelivery && profile.zeroBrokerageDelivery) brokerage = 0;

  let stt = 0;
  let exchange = 0;
  let stampDuty = 0;
  let dpCharge = 0;
  let exerciseStt = 0;
  // SEBI is ₹1/crore for agri commodities, ₹10/crore otherwise.
  let sebiPerCrore = profile.sebiPerCrore;

  if (t.segment === "OPT") {
    if (t.exercise) {
      // EXERCISE settlement (the "STT trap"): the long ITM leg was settled at
      // intrinsic, not sold back in the market, so there is NO premium-sell STT.
      // The buyer pays exercise STT (0.125%) on the intrinsic settlement notional
      // instead. Exchange + stamp still bill on the leg's own premium turnover.
      stt = 0;
      exerciseStt = t.exercise.intrinsicNotional * profile.sttOptionExercisePct;
    } else {
      stt = sellTurnover * profile.sttOptionSellPct;
    }
    exchange = totalTurnover * txn.option;
    stampDuty = buyTurnover * profile.stampOptionBuyPct;
  } else if (t.segment === "FUT") {
    stt = sellTurnover * profile.sttFutureSellPct;
    exchange = totalTurnover * txn.future;
    stampDuty = buyTurnover * profile.stampFutureBuyPct;
  } else if (t.segment === "COMM") {
    // Commodity (MCX/NCDEX): CTT, not STT. Agri commodities are CTT-exempt and
    // charged the ₹1/cr SEBI slab. Commodity options carry CTT on the sell
    // premium (0.05%) + the option exchange rate + the option stamp (0.003%);
    // commodity futures CTT on the sell turnover (0.01%) + the futures rate +
    // futures stamp (0.002%). Both on the SELL side only.
    if (t.agriCommodity) sebiPerCrore = profile.sebiPerCroreAgri;
    const cttPct = t.agriCommodity
      ? 0
      : t.commodityOption
        ? profile.cttOptionPct
        : profile.cttFuturePct;
    stt = sellTurnover * cttPct;
    exchange =
      totalTurnover *
      (t.commodityOption
        ? txn.commodityOption
        : t.agriCommodity
          ? txn.commodityFutureAgri
          : txn.commodityFuture);
    stampDuty =
      buyTurnover * (t.commodityOption ? profile.stampOptionBuyPct : profile.stampFutureBuyPct);
  } else if (t.segment === "CDS") {
    // Currency derivatives: NO STT and NO CTT. Emit a zero transaction-tax line.
    // Options carry the option exchange rate, futures the (lower) futures rate;
    // stamp is the dedicated low currency rate (0.0001%).
    stt = 0;
    exchange = totalTurnover * (t.isOption ? txn.currencyOption : txn.currencyFuture);
    stampDuty = buyTurnover * profile.stampCurrencyBuyPct;
  } else if (equityDelivery) {
    // Equity delivery (CNC/BTST/STBT): STT 0.1% on BOTH sides, higher stamp,
    // and a per-scrip DP charge on the delivery sell (CNC only — BTST/STBT
    // settle without a demat debit, so no DP).
    stt = totalTurnover * profile.sttEquityDeliveryPct;
    exchange = totalTurnover * txn.equity;
    stampDuty = buyTurnover * profile.stampEquityDeliveryBuyPct;
    if (product === "CNC") dpCharge = profile.dpChargePerScrip;
  } else {
    // Equity intraday (MIS / legacy-null): STT 0.025% sell-only, stamp 0.003%.
    stt = sellTurnover * profile.sttEquityIntradaySellPct;
    exchange = totalTurnover * txn.equity;
    stampDuty = buyTurnover * profile.stampEquityIntradayBuyPct;
  }

  const sebi = (totalTurnover / 1_00_00_000) * sebiPerCrore;
  // DP charge already includes GST; GST applies to brokerage + exchange + SEBI.
  // Exercise STT, like ordinary STT/stamp, is statutory and carries no GST.
  const gst = (brokerage + exchange + sebi) * profile.gstPct;
  const total = brokerage + stt + exchange + sebi + gst + stampDuty + dpCharge + exerciseStt;

  return {
    brokerage: r2(brokerage),
    stt: r2(stt),
    exchange: r2(exchange),
    sebi: r2(sebi),
    gst: r2(gst),
    stampDuty: r2(stampDuty),
    dpCharge: r2(dpCharge),
    exerciseStt: r2(exerciseStt),
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
