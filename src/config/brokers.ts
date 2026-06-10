/**
 * Indian broker charge profiles — DATA, not code. Rates change with budgets/circulars;
 * update here (or per-account overrides in Settings) without touching the engine.
 * Percentages are fractions (0.001 = 0.1%). Rates indicative as of FY 2025-26 — verify.
 */
export interface ChargeProfile {
  id: string;
  label: string;
  /** Flat brokerage per executed order (intraday/FnO discount brokers). */
  brokeragePerOrder: number;
  /** Max brokerage as % of turnover per order (e.g. 0.0003 = 0.03% for Zerodha intraday). */
  brokerageMaxPct: number;
  /** STT: options — on premium, SELL side. */
  sttOptionSellPct: number;
  /** STT: futures — on turnover, SELL side. */
  sttFutureSellPct: number;
  /** STT: equity intraday — SELL side. */
  sttEquityIntradaySellPct: number;
  /** Exchange transaction charges (NSE) — options on premium. */
  exchangeOptionPct: number;
  exchangeFuturePct: number;
  exchangeEquityPct: number;
  /** SEBI charges per crore of turnover. */
  sebiPerCrore: number;
  /** GST on (brokerage + exchange + SEBI). */
  gstPct: number;
  /** Stamp duty — BUY side. */
  stampOptionBuyPct: number;
  stampFutureBuyPct: number;
  stampEquityIntradayBuyPct: number;
}

const baseStatutory = {
  sttOptionSellPct: 0.001, // 0.1% on premium (sell)
  sttFutureSellPct: 0.0002, // 0.02% (sell)
  sttEquityIntradaySellPct: 0.00025, // 0.025% (sell)
  exchangeOptionPct: 0.0003503, // NSE 0.03503% on premium
  exchangeFuturePct: 0.0000173, // NSE 0.00173%
  exchangeEquityPct: 0.0000297, // NSE 0.00297%
  sebiPerCrore: 10,
  gstPct: 0.18,
  stampOptionBuyPct: 0.00003, // 0.003% (buy)
  stampFutureBuyPct: 0.00002, // 0.002% (buy)
  stampEquityIntradayBuyPct: 0.00003, // 0.003% (buy)
};

export const CHARGE_PROFILES: ChargeProfile[] = [
  { id: "zerodha", label: "Zerodha", brokeragePerOrder: 20, brokerageMaxPct: 0.0003, ...baseStatutory },
  { id: "upstox", label: "Upstox", brokeragePerOrder: 20, brokerageMaxPct: 0.0005, ...baseStatutory },
  { id: "angelone", label: "Angel One", brokeragePerOrder: 20, brokerageMaxPct: 0.0003, ...baseStatutory },
  { id: "dhan", label: "Dhan", brokeragePerOrder: 20, brokerageMaxPct: 0.0003, ...baseStatutory },
  { id: "fyers", label: "Fyers", brokeragePerOrder: 20, brokerageMaxPct: 0.0003, ...baseStatutory },
  { id: "groww", label: "Groww", brokeragePerOrder: 20, brokerageMaxPct: 0.0005, ...baseStatutory },
  { id: "zero", label: "No charges (manual)", brokeragePerOrder: 0, brokerageMaxPct: 0, ...baseStatutory, sttOptionSellPct: 0, sttFutureSellPct: 0, sttEquityIntradaySellPct: 0, exchangeOptionPct: 0, exchangeFuturePct: 0, exchangeEquityPct: 0, sebiPerCrore: 0, gstPct: 0, stampOptionBuyPct: 0, stampFutureBuyPct: 0, stampEquityIntradayBuyPct: 0 },
];

export function getChargeProfile(id: string): ChargeProfile {
  return CHARGE_PROFILES.find((p) => p.id === id) ?? CHARGE_PROFILES[0]!;
}

export const BROKERS = CHARGE_PROFILES.filter((p) => p.id !== "zero").map((p) => ({
  id: p.id,
  label: p.label,
}));
