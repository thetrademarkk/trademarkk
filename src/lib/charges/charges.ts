import type { ChargeProfile } from "@/config/brokers";

export type Segment = "EQ" | "FUT" | "OPT";

export interface TradeForCharges {
  segment: Segment;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  /** 'long' buys first then sells; 'short' sells first then buys. Charges are symmetric. */
  direction: "long" | "short";
  /** Number of executed orders (default 2: one entry, one exit). */
  orders?: number;
}

export interface ChargeBreakdown {
  brokerage: number;
  stt: number;
  exchange: number;
  sebi: number;
  gst: number;
  stampDuty: number;
  total: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Computes Indian market charges for a round-trip intraday/FnO trade.
 * For options, "turnover" means premium turnover (price × qty).
 */
export function computeCharges(profile: ChargeProfile, t: TradeForCharges): ChargeBreakdown {
  const buyPrice = t.direction === "long" ? t.entryPrice : t.exitPrice;
  const sellPrice = t.direction === "long" ? t.exitPrice : t.entryPrice;
  const buyTurnover = buyPrice * t.qty;
  const sellTurnover = sellPrice * t.qty;
  const totalTurnover = buyTurnover + sellTurnover;
  const orders = t.orders ?? 2;

  // Options: flat per order. Equity/futures: % of turnover capped at the flat rate.
  const perOrderTurnover = totalTurnover / orders;
  const brokerage =
    t.segment !== "OPT" && profile.brokerageMaxPct > 0
      ? Math.min(profile.brokeragePerOrder, perOrderTurnover * profile.brokerageMaxPct) * orders
      : profile.brokeragePerOrder * orders;

  let stt = 0;
  let exchange = 0;
  let stampDuty = 0;
  if (t.segment === "OPT") {
    stt = sellTurnover * profile.sttOptionSellPct;
    exchange = totalTurnover * profile.exchangeOptionPct;
    stampDuty = buyTurnover * profile.stampOptionBuyPct;
  } else if (t.segment === "FUT") {
    stt = sellTurnover * profile.sttFutureSellPct;
    exchange = totalTurnover * profile.exchangeFuturePct;
    stampDuty = buyTurnover * profile.stampFutureBuyPct;
  } else {
    stt = sellTurnover * profile.sttEquityIntradaySellPct;
    exchange = totalTurnover * profile.exchangeEquityPct;
    stampDuty = buyTurnover * profile.stampEquityIntradayBuyPct;
  }

  const sebi = (totalTurnover / 1_00_00_000) * profile.sebiPerCrore;
  const gst = (brokerage + exchange + sebi) * profile.gstPct;
  const total = brokerage + stt + exchange + sebi + gst + stampDuty;

  return {
    brokerage: r2(brokerage),
    stt: r2(stt),
    exchange: r2(exchange),
    sebi: r2(sebi),
    gst: r2(gst),
    stampDuty: r2(stampDuty),
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
