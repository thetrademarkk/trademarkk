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
import { classifyAgriCommodity } from "@/features/trades/instrument-parse";
import { getChargeProfile } from "@/config/brokers";
import { capitalGainsTerm, type CapitalGainsTerm } from "@/lib/stats/horizon";
import { sameIstDate } from "./fy";

/** The trade shape this module needs (a subset of TradeRow). */
export interface TaxTrade {
  id: string;
  account_id: string;
  symbol: string;
  segment: Segment;
  product?: Product | null;
  /** Exchange (SEG-CHG) — optional; resolveExchange falls back per segment. */
  exchange?: string | null;
  /** Set for an option leg — distinguishes a COMM/CDS option from a future. */
  option_type?: "CE" | "PE" | null;
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

/* ────────────────────────── Three-way classification (SEG-07) ──────────────────────────
 *
 * Indian traders have THREE distinct heads of income, not two:
 *   1. Speculative business income     — intraday equity (same-IST-day / MIS).
 *   2. Non-speculative business income — F&O (FUT/OPT) + commodity (COMM/MCX/NCDEX)
 *                                        + currency (CDS). All derivatives.
 *   3. Capital gains                   — DELIVERY equity (CNC, EQ held overnight),
 *                                        split STCG (held ≤ 12 months) / LTCG (> 12 months).
 *
 * This is a CLASSIFICATION + realised-gains statement, NOT a tax-liability
 * computation: we present the realised STCG / LTCG totals and the statutory
 * rate/exemption *labels* below, but never compute the user's final tax.
 */

export type TaxBucketKind = "speculative" | "non-speculative-business" | "capital-gains";

/** A delivery-equity round trip is intraday only when product=MIS or same IST day. */
function isIntradayEquity(t: TaxTrade): boolean {
  if (t.product === "MIS") return true;
  // CNC / BTST / STBT are delivery-basis by definition (overnight).
  if (t.product === "CNC" || t.product === "BTST" || t.product === "STBT") return false;
  // NRML is not an equity product, but guard anyway. Legacy null → fall back to
  // the timestamps: same IST day ⇒ intraday, otherwise delivery.
  return !!t.closed_at && sameIstDate(t.opened_at, t.closed_at);
}

/**
 * Three-way income-head classification of a single trade.
 *  - intraday equity                       → speculative
 *  - delivery equity (CNC / overnight EQ)  → capital-gains
 *  - F&O / commodity / currency            → non-speculative-business
 */
export function classifyTaxBucket(t: TaxTrade): TaxBucketKind {
  if (t.segment === "EQ") {
    return isIntradayEquity(t) ? "speculative" : "capital-gains";
  }
  // FUT/OPT/COMM/CDS — all non-speculative business income.
  return "non-speculative-business";
}

/* ── Capital-gains statutory reference (post-Budget-2024, in force 23 Jul 2024) ──
 *
 * For LISTED equity on which STT is paid (sec. 111A / 112A):
 *   - STCG (held ≤ 12 months): taxed at 20% (raised from 15% w.e.f. 23 Jul 2024).
 *   - LTCG (held  > 12 months): taxed at 12.5% (was 10%), with a yearly
 *     exemption of ₹1,25,000 (raised from ₹1,00,000) on aggregate LTCG.
 * These are DISPLAY labels only — we do NOT apply them to compute a liability.
 */
export const CG_STCG_RATE_PCT = 20;
export const CG_LTCG_RATE_PCT = 12.5;
/** Yearly LTCG exemption on listed equity (₹), post 23 Jul 2024 (was ₹1,00,000). */
export const CG_LTCG_EXEMPTION = 125000;
export const CG_LONG_TERM_MONTHS = 12;
/** Effective date of the revised rates/exemption, for the informational note. */
export const CG_RATE_EFFECTIVE_FROM = "23 Jul 2024";

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

export interface TaxBucket {
  kind: TaxBucketKind;
  trades: number;
  grossPnl: number;
  charges: number;
  netPnl: number;
}

/**
 * Realised STCG / LTCG totals for the delivery-equity capital-gains bucket.
 * "Realised gain" here is the after-cost NET P&L on each closed delivery-equity
 * round trip (gains and losses both flow in, so the figures net out as a CA
 * would aggregate them). STCG = held ≤ 12 months, LTCG = held > 12 months.
 */
export interface CapitalGainsSplit {
  /** Closed delivery-equity (CNC) trades feeding the split. */
  trades: number;
  shortTerm: { trades: number; grossPnl: number; netPnl: number };
  longTerm: { trades: number; grossPnl: number; netPnl: number };
  /** Yearly LTCG exemption applied for *display* (post 23 Jul 2024). */
  ltcgExemption: number;
  /** LTCG net P&L after the exemption, floored at 0 (informational only). */
  ltcgTaxableAfterExemption: number;
}

/**
 * Split realised DELIVERY-equity P&L into STCG (≤12m) and LTCG (>12m).
 * Open positions (no close date) are excluded — they are unrealised. Intraday
 * equity and all derivatives are excluded (they are not capital gains).
 */
export function capitalGainsSplit(trades: TaxTrade[]): CapitalGainsSplit {
  const short = { trades: 0, grossPnl: 0, netPnl: 0 };
  const long = { trades: 0, grossPnl: 0, netPnl: 0 };
  for (const t of trades) {
    if (!t.closed_at) continue; // unrealised — excluded
    if (classifyTaxBucket(t) !== "capital-gains") continue;
    const term: CapitalGainsTerm = capitalGainsTerm(t.opened_at, t.closed_at);
    const bucket = term === "long" ? long : short;
    bucket.trades += 1;
    bucket.grossPnl += t.gross_pnl;
    bucket.netPnl += t.net_pnl;
  }
  const ltcgNet = r2(long.netPnl);
  return {
    trades: short.trades + long.trades,
    shortTerm: { trades: short.trades, grossPnl: r2(short.grossPnl), netPnl: r2(short.netPnl) },
    longTerm: { trades: long.trades, grossPnl: r2(long.grossPnl), netPnl: ltcgNet },
    ltcgExemption: CG_LTCG_EXEMPTION,
    ltcgTaxableAfterExemption: r2(Math.max(0, ltcgNet - CG_LTCG_EXEMPTION)),
  };
}

/**
 * Full three-way split: speculative (intraday EQ), non-speculative business
 * (F&O + commodity + currency) and capital gains (delivery EQ). Each bucket is
 * always present (zero-trade buckets included so the UI shows a clean "none"
 * row). The capital-gains bucket is further broken into STCG/LTCG via
 * `capitalGainsSplit`.
 */
export function taxBucketSplit(trades: TaxTrade[]): {
  speculative: TaxBucket;
  nonSpeculativeBusiness: TaxBucket;
  capitalGains: TaxBucket;
  cg: CapitalGainsSplit;
} {
  const blank = (kind: TaxBucketKind): TaxBucket => ({
    kind,
    trades: 0,
    grossPnl: 0,
    charges: 0,
    netPnl: 0,
  });
  const acc = {
    speculative: blank("speculative"),
    nonSpeculativeBusiness: blank("non-speculative-business"),
    capitalGains: blank("capital-gains"),
  };
  for (const t of trades) {
    const kind = classifyTaxBucket(t);
    const bucket =
      kind === "speculative"
        ? acc.speculative
        : kind === "capital-gains"
          ? acc.capitalGains
          : acc.nonSpeculativeBusiness;
    bucket.trades += 1;
    bucket.grossPnl += t.gross_pnl;
    bucket.charges += t.charges;
    bucket.netPnl += t.net_pnl;
  }
  for (const b of [acc.speculative, acc.nonSpeculativeBusiness, acc.capitalGains]) {
    b.grossPnl = r2(b.grossPnl);
    b.charges = r2(b.charges);
    b.netPnl = r2(b.netPnl);
  }
  return { ...acc, cg: capitalGainsSplit(trades) };
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
      exchange: t.exchange ?? null,
      qty: t.qty,
      entryPrice: t.avg_entry,
      exitPrice: exit,
      direction: t.direction,
      commodityOption: t.segment === "COMM" && t.option_type != null,
      agriCommodity: t.segment === "COMM" && classifyAgriCommodity(t.symbol),
      isOption: t.segment === "CDS" && t.option_type != null,
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
  /** Legacy two-way speculative / non-speculative split (kept for back-compat). */
  split: ReturnType<typeof speculativeSplit>;
  /** Three-way split: speculative / non-speculative business / capital gains. */
  buckets: ReturnType<typeof taxBucketSplit>;
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
    buckets: taxBucketSplit(trades),
    byInstrument: realisedPnlByInstrument(trades),
  };
}
