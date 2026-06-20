/**
 * Indian broker charge profiles — DATA, not code. Update here (or per-account
 * overrides in Settings) without touching the engine.
 *
 * Statutory rates verified June 2026 against zerodha.com/charges (kept current)
 * and the Budget 2026 STT revision (effective 1 Apr 2026):
 *   STT: options 0.15% sell-side premium · futures 0.05% sell · eq intraday 0.025% sell
 *        · eq delivery 0.1% BOTH sides
 *   CTT (commodities, MCX/NCDEX): non-agri futures 0.01% sell · options 0.05% premium sell
 *        · agri commodities exempt. Currency derivatives (CDS): NO STT/CTT.
 *   Exchange txn (per EXCHANGE — SEG-CHG):
 *        NSE  eq 0.00307% · fut 0.00183% · opt 0.03553% premium · cds-fut 0.00035% · cds-opt 0.0311%
 *        BSE  eq 0.00375% · fut 0% · opt 0.0325% premium
 *        MCX  commodity fut 0.0021% (uniform post-1-Oct-2024) · commodity opt 0.0418% premium
 *        NCDEX commodity agri-fut 0.003% · non-agri/processed fut 0.0058% · opt 0.03%
 *   SEBI ₹10/crore (₹1/crore for AGRI commodities) · GST 18% on (brokerage + txn + SEBI)
 *   stamp (buy): opt/eq-intraday 0.003%, fut/commodity-fut 0.002%, commodity-opt 0.003%,
 *        eq-delivery 0.015%, currency 0.0001%
 *   DP charge: ~₹15.34 (incl. GST) per scrip on the SELL of a delivery (CNC) holding.
 * Percentages are fractions (0.0015 = 0.15%).
 */

/**
 * Exchange dimension (SEG-CHG). Only the exchange *transaction* charge and the
 * agri-SEBI rate vary by exchange; STT/CTT/stamp/GST are statutory and identical
 * everywhere. EQ/FUT/OPT default to NSE, COMM to MCX, CDS to NSE — so a trade
 * whose exchange is unknown (every pre-SEG-CHG row) charges byte-identically to
 * before.
 */
export type Exchange = "NSE" | "BSE" | "MCX" | "NCDEX";

/**
 * The exchange transaction-charge rates for one exchange, as fractions of
 * turnover (premium turnover for options). A rate of 0 is a real "free" rate
 * (e.g. BSE futures), distinct from "this exchange does not list this product".
 */
export interface ExchangeTxnRates {
  /** Cash equity (intraday + delivery share the same exchange txn rate). */
  equity: number;
  /** NSE/BSE index & stock futures. */
  future: number;
  /** NSE/BSE options — on premium turnover. */
  option: number;
  /** Commodity (MCX/NCDEX) futures, non-agri. */
  commodityFuture: number;
  /** Commodity futures, AGRI (NCDEX agri carries a lower slab; MCX uniform = same as non-agri). */
  commodityFutureAgri: number;
  /** Commodity options — on premium turnover. */
  commodityOption: number;
  /** Currency (CDS) futures. */
  currencyFuture: number;
  /** Currency (CDS) options — on premium turnover. */
  currencyOption: number;
}

export interface ChargeProfile {
  id: string;
  label: string;
  /** Flat brokerage per executed order (always applies to options). */
  brokeragePerOrder: number;
  /** Equity intraday: % of turnover per order, capped at the flat fee (0 = flat only). */
  brokerageEqMaxPct: number;
  /** Futures: % of turnover per order, capped at the flat fee (0 = flat only). */
  brokerageFutMaxPct: number;
  /** STT: options — on premium, SELL side. */
  sttOptionSellPct: number;
  /**
   * STT: options EXERCISED at expiry (the "STT trap") — on the INTRINSIC
   * settlement value of a net-long ITM option that is exercised/settled, charged
   * to the buyer. 0.125% (vs the 0.0625% effective sell-side premium STT). This
   * line only fires on an expiry-day intrinsic settlement of a long ITM leg.
   */
  sttOptionExercisePct: number;
  /** STT: futures — on turnover, SELL side. */
  sttFutureSellPct: number;
  /** STT: equity intraday — SELL side. */
  sttEquityIntradaySellPct: number;
  /** STT: equity delivery (CNC) — charged on BOTH buy and sell turnover. */
  sttEquityDeliveryPct: number;
  /** CTT: commodity (non-agri) futures — SELL side turnover. */
  cttFuturePct: number;
  /** CTT: commodity (non-agri) options — SELL side premium. */
  cttOptionPct: number;
  /**
   * Per-exchange transaction charges (SEG-CHG). Keyed by {@link Exchange}; the
   * engine resolves the trade's exchange (defaulting per segment for legacy
   * rows) and reads the right product rate. The flat `exchange*Pct` fields below
   * remain as the documented NSE rates and seed the NSE entry.
   */
  exchangeTxn: Record<Exchange, ExchangeTxnRates>;
  /** NSE exchange transaction charges — options on premium. (Legacy flat fields, = exchangeTxn.NSE.) */
  exchangeOptionPct: number;
  exchangeFuturePct: number;
  exchangeEquityPct: number;
  /**
   * NSE commodity (MCX) & currency (CDS) flat rates — kept for documentation /
   * back-compat; the engine now reads {@link exchangeTxn}.
   */
  exchangeCommodityPct: number;
  exchangeCurrencyPct: number;
  /** SEBI charges per crore of turnover (non-agri). */
  sebiPerCrore: number;
  /** SEBI charges per crore of turnover for AGRI commodities (₹1/cr vs ₹10/cr). */
  sebiPerCroreAgri: number;
  /** GST on (brokerage + exchange + SEBI). */
  gstPct: number;
  /** Stamp duty — BUY side. */
  stampOptionBuyPct: number;
  stampFutureBuyPct: number;
  stampEquityIntradayBuyPct: number;
  /** Stamp duty — equity delivery (CNC) BUY side (0.015%). */
  stampEquityDeliveryBuyPct: number;
  /** Stamp duty — currency (CDS) BUY side (0.0001%). */
  stampCurrencyBuyPct: number;
  /** Depository (DP) charge per scrip on a delivery sell — flat ₹ incl. GST. */
  dpChargePerScrip: number;
  /**
   * Zero-brokerage-on-delivery broker (Zerodha/Dhan/Fyers etc.): the exit order
   * of an equity CNC trade is free. When true the engine halves the round-trip
   * equity brokerage for CNC (entry charged, exit free).
   */
  zeroBrokerageDelivery: boolean;
}

// Per-exchange transaction-charge rates (SEG-CHG). Statutory across brokers —
// set by each exchange, identical for everyone. Fractions of turnover.
const exchangeTxn: Record<Exchange, ExchangeTxnRates> = {
  NSE: {
    equity: 0.0000307, // 0.00307%
    future: 0.0000183, // 0.00183%
    option: 0.0003553, // 0.03553% premium
    commodityFuture: 0.000021, // (NSE does not list commodities; placeholder = MCX)
    commodityFutureAgri: 0.000021,
    commodityOption: 0.000418,
    currencyFuture: 0.0000035, // 0.00035%
    currencyOption: 0.000311, // 0.0311% premium
  },
  BSE: {
    equity: 0.0000375, // 0.00375%
    future: 0, // BSE index futures carry NO exchange transaction charge
    option: 0.000325, // 0.0325% premium
    commodityFuture: 0.000021,
    commodityFutureAgri: 0.000021,
    commodityOption: 0.000418,
    currencyFuture: 0.0000035,
    currencyOption: 0.000311,
  },
  MCX: {
    // Post SEBI true-to-label (1 Oct 2024) MCX uses ONE uniform commodity rate.
    equity: 0.0000307,
    future: 0.0000183,
    option: 0.0003553,
    commodityFuture: 0.000021, // 0.0021% (uniform, all commodities)
    commodityFutureAgri: 0.000021,
    commodityOption: 0.000418, // 0.0418% premium
    currencyFuture: 0.0000035,
    currencyOption: 0.000311,
  },
  NCDEX: {
    equity: 0.0000307,
    future: 0.0000183,
    option: 0.0003553,
    commodityFuture: 0.000058, // 0.0058% non-agri / processed
    commodityFutureAgri: 0.00003, // 0.003% agri futures
    commodityOption: 0.0003, // ~₹30/lakh on premium
    currencyFuture: 0.0000035,
    currencyOption: 0.000311,
  },
};

// Statutory charges are identical across brokers (set by govt/exchanges).
const statutory = {
  sttOptionSellPct: 0.0015, // 0.15% on premium (sell) — Budget 2026
  sttOptionExercisePct: 0.00125, // 0.125% on intrinsic settlement value — exercised ITM long
  sttFutureSellPct: 0.0005, // 0.05% (sell) — Budget 2026
  sttEquityIntradaySellPct: 0.00025, // 0.025% (sell)
  sttEquityDeliveryPct: 0.001, // 0.1% on BOTH buy + sell turnover (delivery)
  cttFuturePct: 0.0001, // 0.01% commodity non-agri futures (sell)
  cttOptionPct: 0.0005, // 0.05% commodity options premium (sell)
  exchangeTxn,
  exchangeOptionPct: exchangeTxn.NSE.option,
  exchangeFuturePct: exchangeTxn.NSE.future,
  exchangeEquityPct: exchangeTxn.NSE.equity,
  exchangeCommodityPct: exchangeTxn.MCX.commodityFuture,
  exchangeCurrencyPct: exchangeTxn.NSE.currencyFuture,
  sebiPerCrore: 10,
  sebiPerCroreAgri: 1, // ₹1/crore for agri commodities
  gstPct: 0.18,
  stampOptionBuyPct: 0.00003, // 0.003% (buy)
  stampFutureBuyPct: 0.00002, // 0.002% (buy)
  stampEquityIntradayBuyPct: 0.00003, // 0.003% (buy)
  stampEquityDeliveryBuyPct: 0.00015, // 0.015% (buy) — delivery
  stampCurrencyBuyPct: 0.000001, // 0.0001% (buy) — currency
};

// Most modern discount brokers charge ZERO brokerage on equity delivery and a
// flat ~₹15.34 (incl. GST) DP charge per scrip on the delivery sell.
const delivery = { dpChargePerScrip: 15.34, zeroBrokerageDelivery: true };

// An all-zero exchange-txn map for the manual "No charges" profile.
const zeroExchangeTxn: Record<Exchange, ExchangeTxnRates> = {
  NSE: zeroRates(),
  BSE: zeroRates(),
  MCX: zeroRates(),
  NCDEX: zeroRates(),
};
function zeroRates(): ExchangeTxnRates {
  return {
    equity: 0,
    future: 0,
    option: 0,
    commodityFuture: 0,
    commodityFutureAgri: 0,
    commodityOption: 0,
    currencyFuture: 0,
    currencyOption: 0,
  };
}

// Brokerage differs per broker (from each broker's pricing page, June 2026).
export const CHARGE_PROFILES: ChargeProfile[] = [
  // Zerodha/Dhan/Fyers: ₹0 brokerage on equity delivery (CNC), ₹15.34 DP on sell.
  {
    id: "zerodha",
    label: "Zerodha",
    brokeragePerOrder: 20,
    brokerageEqMaxPct: 0.0003,
    brokerageFutMaxPct: 0.0003,
    ...statutory,
    ...delivery,
  },
  // Upstox: ₹20 (or 0.1%) brokerage even on delivery → not zero-brokerage.
  {
    id: "upstox",
    label: "Upstox",
    brokeragePerOrder: 20,
    brokerageEqMaxPct: 0.001,
    brokerageFutMaxPct: 0.0005,
    ...statutory,
    ...delivery,
    zeroBrokerageDelivery: false,
  },
  // Angel One: ₹20/0.25% (capped) on delivery → not zero-brokerage.
  {
    id: "angelone",
    label: "Angel One",
    brokeragePerOrder: 20,
    brokerageEqMaxPct: 0.0025,
    brokerageFutMaxPct: 0.0025,
    ...statutory,
    ...delivery,
    zeroBrokerageDelivery: false,
  },
  {
    id: "dhan",
    label: "Dhan",
    brokeragePerOrder: 20,
    brokerageEqMaxPct: 0.0003,
    brokerageFutMaxPct: 0.0003,
    ...statutory,
    ...delivery,
  },
  {
    id: "fyers",
    label: "Fyers",
    brokeragePerOrder: 20,
    brokerageEqMaxPct: 0.0003,
    brokerageFutMaxPct: 0.0003,
    ...statutory,
    ...delivery,
  },
  // Groww: ₹20/0.1% on delivery → not zero-brokerage.
  {
    id: "groww",
    label: "Groww",
    brokeragePerOrder: 20,
    brokerageEqMaxPct: 0.001,
    brokerageFutMaxPct: 0.001,
    ...statutory,
    ...delivery,
    zeroBrokerageDelivery: false,
  },
  {
    id: "zero",
    label: "No charges (manual)",
    brokeragePerOrder: 0,
    brokerageEqMaxPct: 0,
    brokerageFutMaxPct: 0,
    ...statutory,
    sttOptionSellPct: 0,
    sttOptionExercisePct: 0,
    sttFutureSellPct: 0,
    sttEquityIntradaySellPct: 0,
    sttEquityDeliveryPct: 0,
    cttFuturePct: 0,
    cttOptionPct: 0,
    exchangeTxn: zeroExchangeTxn,
    exchangeOptionPct: 0,
    exchangeFuturePct: 0,
    exchangeEquityPct: 0,
    exchangeCommodityPct: 0,
    exchangeCurrencyPct: 0,
    sebiPerCrore: 0,
    sebiPerCroreAgri: 0,
    gstPct: 0,
    stampOptionBuyPct: 0,
    stampFutureBuyPct: 0,
    stampEquityIntradayBuyPct: 0,
    stampEquityDeliveryBuyPct: 0,
    stampCurrencyBuyPct: 0,
    dpChargePerScrip: 0,
    zeroBrokerageDelivery: false,
  },
];

export function getChargeProfile(id: string): ChargeProfile {
  return CHARGE_PROFILES.find((p) => p.id === id) ?? CHARGE_PROFILES[0]!;
}

export const BROKERS = CHARGE_PROFILES.filter((p) => p.id !== "zero").map((p) => ({
  id: p.id,
  label: p.label,
}));
