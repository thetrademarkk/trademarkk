/**
 * Indian broker charge profiles — DATA, not code. Update here (or per-account
 * overrides in Settings) without touching the engine.
 *
 * Statutory rates verified June 2026 against zerodha.com/charges (kept current)
 * and the Budget 2026 STT revision (effective 1 Apr 2026):
 *   STT: options 0.15% sell-side premium · futures 0.05% sell · eq intraday 0.025% sell
 *        · eq delivery 0.1% BOTH sides
 *   CTT (commodities, MCX): non-agri futures 0.01% sell · options 0.05% premium sell
 *        · agri commodities exempt. Currency derivatives (CDS): NO STT/CTT.
 *   NSE txn: options 0.03553% premium · futures 0.00183% · equity 0.00307%
 *   SEBI ₹10/crore · GST 18% on (brokerage + txn + SEBI) · stamp (buy): opt/eq-intraday
 *        0.003%, fut 0.002%, eq-delivery 0.015%
 *   DP charge: ~₹15.34 (incl. GST) per scrip on the SELL of a delivery (CNC) holding.
 * Percentages are fractions (0.0015 = 0.15%).
 */
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
  /** Exchange transaction charges (NSE) — options on premium. */
  exchangeOptionPct: number;
  exchangeFuturePct: number;
  exchangeEquityPct: number;
  /**
   * Exchange transaction charges for commodity (MCX) & currency (CDS). Default
   * to the equity rate as a conservative placeholder; brokers may override.
   */
  exchangeCommodityPct: number;
  exchangeCurrencyPct: number;
  /** SEBI charges per crore of turnover. */
  sebiPerCrore: number;
  /** GST on (brokerage + exchange + SEBI). */
  gstPct: number;
  /** Stamp duty — BUY side. */
  stampOptionBuyPct: number;
  stampFutureBuyPct: number;
  stampEquityIntradayBuyPct: number;
  /** Stamp duty — equity delivery (CNC) BUY side (0.015%). */
  stampEquityDeliveryBuyPct: number;
  /** Depository (DP) charge per scrip on a delivery sell — flat ₹ incl. GST. */
  dpChargePerScrip: number;
  /**
   * Zero-brokerage-on-delivery broker (Zerodha/Dhan/Fyers etc.): the exit order
   * of an equity CNC trade is free. When true the engine halves the round-trip
   * equity brokerage for CNC (entry charged, exit free).
   */
  zeroBrokerageDelivery: boolean;
}

// Statutory charges are identical across brokers (set by govt/exchanges).
const statutory = {
  sttOptionSellPct: 0.0015, // 0.15% on premium (sell) — Budget 2026
  sttFutureSellPct: 0.0005, // 0.05% (sell) — Budget 2026
  sttEquityIntradaySellPct: 0.00025, // 0.025% (sell)
  sttEquityDeliveryPct: 0.001, // 0.1% on BOTH buy + sell turnover (delivery)
  cttFuturePct: 0.0001, // 0.01% commodity non-agri futures (sell)
  cttOptionPct: 0.0005, // 0.05% commodity options premium (sell)
  exchangeOptionPct: 0.0003553, // NSE 0.03553% on premium
  exchangeFuturePct: 0.0000183, // NSE 0.00183%
  exchangeEquityPct: 0.0000307, // NSE 0.00307%
  exchangeCommodityPct: 0.0000266, // MCX ~0.00266% (non-agri futures), placeholder
  exchangeCurrencyPct: 0.0000009, // NSE CDS ~0.00009%, placeholder
  sebiPerCrore: 10,
  gstPct: 0.18,
  stampOptionBuyPct: 0.00003, // 0.003% (buy)
  stampFutureBuyPct: 0.00002, // 0.002% (buy)
  stampEquityIntradayBuyPct: 0.00003, // 0.003% (buy)
  stampEquityDeliveryBuyPct: 0.00015, // 0.015% (buy) — delivery
};

// Most modern discount brokers charge ZERO brokerage on equity delivery and a
// flat ~₹15.34 (incl. GST) DP charge per scrip on the delivery sell.
const delivery = { dpChargePerScrip: 15.34, zeroBrokerageDelivery: true };

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
    sttFutureSellPct: 0,
    sttEquityIntradaySellPct: 0,
    sttEquityDeliveryPct: 0,
    cttFuturePct: 0,
    cttOptionPct: 0,
    exchangeOptionPct: 0,
    exchangeFuturePct: 0,
    exchangeEquityPct: 0,
    exchangeCommodityPct: 0,
    exchangeCurrencyPct: 0,
    sebiPerCrore: 0,
    gstPct: 0,
    stampOptionBuyPct: 0,
    stampFutureBuyPct: 0,
    stampEquityIntradayBuyPct: 0,
    stampEquityDeliveryBuyPct: 0,
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
