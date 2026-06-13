/**
 * Indian tax & turnover computation — pure, client-side, paise-precise.
 *
 * All money is carried in rupees with two-decimal (paise) precision, exactly as
 * stored on TradeRow (gross_pnl / charges / net_pnl). Nothing is rounded away
 * during computation; round only at display.
 *
 * Disclaimer: these figures are informational and follow widely-used ICAI
 * guidance conventions. They are NOT tax advice — verify with a CA.
 */

import { computeCharges, type Product, type Segment } from "@/lib/charges/charges";
import { getChargeProfile } from "@/config/brokers";
import { sameIstDate } from "./fy";

/** The trade shape this module needs (a subset of TradeRow). */
export interface TaxTrade {
  id: string;
  account_id: string;
  symbol: string;
  segment: Segment;
  product?: Product | null;
  direction: "long" | "short";
  qty: number;
  avg_entry: number;
  avg_exit: number | null;
  opened_at: string;
  closed_at: string | null;
  gross_pnl: number;
  charges: number;
  net_pnl: number;
}

/** Two cents of precision, kept consistent with the rest of the app. */
const r2 = (n: number) => Math.round(n * 100) / 100;

export type TaxCategory = "speculative" | "non-speculative";

/**
 * Indian income-tax classification of a single trade:
 *  - Intraday equity (same-day buy + sell) → SPECULATIVE business income.
 *  - Delivery equity (held overnight) and ALL F&O (futures/options) →
 *    NON-SPECULATIVE business income.
 * A trade with no close date is treated as not-yet-realised; we still classify
 * it for completeness using its segment, defaulting EQ to delivery.
 */
export function classifyTrade(t: TaxTrade): TaxCategory {
  if (t.segment !== "EQ") return "non-speculative";
  // Equity: speculative only when the round trip opens and closes the same IST day.
  if (t.closed_at && sameIstDate(t.opened_at, t.closed_at)) return "speculative";
  return "non-speculative";
}

export const isFno = (t: TaxTrade) => t.segment === "FUT" || t.segment === "OPT";

/** Buy/sell turnover (premium turnover for options) of one round trip. */
export function tradeTurnover(t: TaxTrade): {
  buy: number;
  sell: number;
  notional: number;
} {
  const exit = t.avg_exit ?? t.avg_entry;
  const buyPrice = t.direction === "long" ? t.avg_entry : exit;
  const sellPrice = t.direction === "long" ? exit : t.avg_entry;
  const buy = r2(buyPrice * t.qty);
  const sell = r2(sellPrice * t.qty);
  return { buy, sell, notional: r2(buy + sell) };
}

export interface TurnoverStatement {
  /** Trade count contributing to the statement. */
  trades: number;
  /**
   * Tax turnover under the absolute-profit convention (ICAI Guidance Note):
   * the sum of the *absolute* settlement values — i.e. abs(net P&L) per trade
   * summed. This is the figure used to test the audit / 44AD thresholds.
   */
  absoluteProfitTurnover: number;
  /** Sum of positive settlements (favourable differences). */
  totalProfit: number;
  /** Sum of |negative settlements| (unfavourable differences). */
  totalLoss: number;
  /** Net realised P&L (gross of P&L, i.e. sum of net_pnl). */
  netRealised: number;
  /**
   * Alternate convention: total notional/contract turnover = buy + sell
   * turnover summed across trades (premium turnover for options). Shown as a
   * secondary line because some practitioners and brokers report this instead.
   */
  notionalTurnover: number;
  /** Sell-side turnover only (another commonly-quoted figure). */
  sellTurnover: number;
}

/**
 * F&O turnover statement over a set of trades. Uses NET realised P&L per trade
 * as the "settlement" — the favourable/unfavourable difference — which is the
 * conservative, after-cost basis most CAs use for the journal's own trades.
 */
export function fnoTurnover(trades: TaxTrade[]): TurnoverStatement {
  const fno = trades.filter(isFno);
  let totalProfit = 0;
  let totalLoss = 0;
  let netRealised = 0;
  let notional = 0;
  let sell = 0;
  for (const t of fno) {
    const settle = t.net_pnl;
    netRealised += settle;
    if (settle >= 0) totalProfit += settle;
    else totalLoss += -settle;
    const tt = tradeTurnover(t);
    notional += tt.notional;
    sell += tt.sell;
  }
  return {
    trades: fno.length,
    absoluteProfitTurnover: r2(totalProfit + totalLoss),
    totalProfit: r2(totalProfit),
    totalLoss: r2(totalLoss),
    netRealised: r2(netRealised),
    notionalTurnover: r2(notional),
    sellTurnover: r2(sell),
  };
}

export interface CategorySplit {
  category: TaxCategory;
  trades: number;
  grossPnl: number;
  charges: number;
  netPnl: number;
  /** Tax turnover (absolute-profit convention) for this category. */
  turnover: number;
}

/**
 * Speculative vs non-speculative split. Returns both buckets always (a bucket
 * with zero trades is still present, so the UI can show a clean "none" row).
 */
export function speculativeSplit(trades: TaxTrade[]): {
  speculative: CategorySplit;
  nonSpeculative: CategorySplit;
} {
  const blank = (category: TaxCategory): CategorySplit => ({
    category,
    trades: 0,
    grossPnl: 0,
    charges: 0,
    netPnl: 0,
    turnover: 0,
  });
  const acc = { speculative: blank("speculative"), nonSpeculative: blank("non-speculative") };
  for (const t of trades) {
    const bucket = classifyTrade(t) === "speculative" ? acc.speculative : acc.nonSpeculative;
    bucket.trades += 1;
    bucket.grossPnl += t.gross_pnl;
    bucket.charges += t.charges;
    bucket.netPnl += t.net_pnl;
    bucket.turnover += Math.abs(t.net_pnl);
  }
  for (const b of [acc.speculative, acc.nonSpeculative]) {
    b.grossPnl = r2(b.grossPnl);
    b.charges = r2(b.charges);
    b.netPnl = r2(b.netPnl);
    b.turnover = r2(b.turnover);
  }
  return acc;
}

export interface ChargesBreakdown {
  brokerage: number;
  stt: number;
  exchange: number;
  sebi: number;
  gst: number;
  stampDuty: number;
  /** Depository (DP) charges on equity-delivery sells, scaled to the aggregate. */
  dpCharge: number;
  /** Sum of the derived components above. */
  derivedTotal: number;
  /** The authoritative aggregate actually stored on the trades. */
  actualTotal: number;
  /**
   * True when the component split is *estimated* from the charge profile rather
   * than read from stored per-component data (we only store an aggregate). When
   * estimated and derivedTotal materially differs from actualTotal, the UI
   * scales components to the actual total and flags them as estimates.
   */
  estimated: boolean;
}

/**
 * Charges breakdown across trades. We only store an aggregate `charges` per
 * trade, so we *re-derive* the statutory components (STT, stamp, SEBI, exchange,
 * GST, brokerage) from each trade's price/qty/segment and its account charge
 * profile via the existing engine. The result is labelled `estimated: true`
 * and the components are scaled so they sum to the honest stored aggregate —
 * we never present a fabricated precise split that contradicts what was paid.
 */
export function chargesBreakdown(
  trades: TaxTrade[],
  profileForAccount: (accountId: string) => string
): ChargesBreakdown {
  let brokerage = 0;
  let stt = 0;
  let exchange = 0;
  let sebi = 0;
  let gst = 0;
  let stampDuty = 0;
  let dpCharge = 0;
  let actualTotal = 0;

  for (const t of trades) {
    actualTotal += t.charges;
    const profile = getChargeProfile(profileForAccount(t.account_id));
    const exit = t.avg_exit ?? t.avg_entry;
    const c = computeCharges(profile, {
      segment: t.segment,
      product: t.product ?? null,
      qty: t.qty,
      entryPrice: t.avg_entry,
      exitPrice: exit,
      direction: t.direction,
    });
    brokerage += c.brokerage;
    stt += c.stt;
    exchange += c.exchange;
    sebi += c.sebi;
    gst += c.gst;
    stampDuty += c.stampDuty;
    dpCharge += c.dpCharge;
  }

  const derivedTotal = brokerage + stt + exchange + sebi + gst + stampDuty + dpCharge;

  // Scale derived components to the honest stored aggregate so the breakdown
  // sums to what was actually paid (manual-charge overrides, broker rounding).
  const scale = derivedTotal > 0 ? actualTotal / derivedTotal : 0;
  return {
    brokerage: r2(brokerage * scale),
    stt: r2(stt * scale),
    exchange: r2(exchange * scale),
    sebi: r2(sebi * scale),
    gst: r2(gst * scale),
    stampDuty: r2(stampDuty * scale),
    dpCharge: r2(dpCharge * scale),
    derivedTotal: r2(derivedTotal),
    actualTotal: r2(actualTotal),
    estimated: true,
  };
}

export interface InstrumentPnl {
  symbol: string;
  segment: Segment;
  trades: number;
  qty: number;
  buyValue: number;
  sellValue: number;
  grossPnl: number;
  charges: number;
  netPnl: number;
}

/**
 * Realised-P&L statement grouped by instrument (symbol + segment), with cost
 * basis (buy value) and proceeds (sell value). Sorted by net P&L descending.
 */
export function realisedPnlByInstrument(trades: TaxTrade[]): InstrumentPnl[] {
  const map = new Map<string, InstrumentPnl>();
  for (const t of trades) {
    const key = `${t.symbol}|${t.segment}`;
    const tt = tradeTurnover(t);
    let row = map.get(key);
    if (!row) {
      row = {
        symbol: t.symbol,
        segment: t.segment,
        trades: 0,
        qty: 0,
        buyValue: 0,
        sellValue: 0,
        grossPnl: 0,
        charges: 0,
        netPnl: 0,
      };
      map.set(key, row);
    }
    row.trades += 1;
    row.qty += t.qty;
    row.buyValue += tt.buy;
    row.sellValue += tt.sell;
    row.grossPnl += t.gross_pnl;
    row.charges += t.charges;
    row.netPnl += t.net_pnl;
  }
  return [...map.values()]
    .map((r) => ({
      ...r,
      buyValue: r2(r.buyValue),
      sellValue: r2(r.sellValue),
      grossPnl: r2(r.grossPnl),
      charges: r2(r.charges),
      netPnl: r2(r.netPnl),
    }))
    .sort((a, b) => b.netPnl - a.netPnl);
}

export interface FyTaxSummary {
  trades: number;
  grossPnl: number;
  charges: number;
  netPnl: number;
  /** Charges as a fraction of |gross P&L| (drag). 0 when gross is 0. */
  chargeDragPct: number;
  turnover: TurnoverStatement;
  split: ReturnType<typeof speculativeSplit>;
  byInstrument: InstrumentPnl[];
}

/** One-shot summary for a single FY's trades. */
export function fyTaxSummary(trades: TaxTrade[]): FyTaxSummary {
  let gross = 0;
  let charges = 0;
  let net = 0;
  for (const t of trades) {
    gross += t.gross_pnl;
    charges += t.charges;
    net += t.net_pnl;
  }
  const drag = Math.abs(gross) > 0 ? charges / Math.abs(gross) : 0;
  return {
    trades: trades.length,
    grossPnl: r2(gross),
    charges: r2(charges),
    netPnl: r2(net),
    chargeDragPct: drag,
    turnover: fnoTurnover(trades),
    split: speculativeSplit(trades),
    byInstrument: realisedPnlByInstrument(trades),
  };
}
