// SEG-09 — grouping the trades table by segment / product / holding-period,
// with per-group subtotals. Pure functions, no I/O: they run client-side on the
// already-fetched trades list, so grouping behaves identically across hosted /
// BYOD / local storage modes. Subtotals are paise-correct — net P&L is summed
// over the stored integer-paise `net_pnl` (closed trades only) and rounded only
// at display, never re-derived here.

import { classifyHorizon, HORIZON_LABEL, HORIZON_ORDER, type Horizon } from "@/lib/stats/horizon";
import type { Exchange } from "@/config/brokers";
import type { Product, Segment, TradeWithMeta } from "./types";

// ---------------------------------------------------------------------------
// Exchange — the stored `TradeRow.exchange` is broker free-text ("NSE_EQ",
// "NFO", "MCX-COMM", …). For filtering and display we normalise it to the same
// four-value union the charge engine uses, defaulting by segment exactly as
// `resolveExchange` does — but WITHOUT importing the charge engine into the UI
// filter layer. A trade whose exchange is blank/unknown falls back to the
// segment default (COMM → MCX, everything else → NSE), so it always lands in a
// real exchange bucket rather than a phantom "unknown" one.
// ---------------------------------------------------------------------------

export type ExchangeFilter = Exchange;

export const EXCHANGE_FILTERS: ExchangeFilter[] = ["NSE", "BSE", "MCX", "NCDEX"];

export const EXCHANGE_LABELS: Record<ExchangeFilter, string> = {
  NSE: "NSE",
  BSE: "BSE",
  MCX: "MCX",
  NCDEX: "NCDEX",
};

/**
 * Normalise a trade's stored exchange + segment to one of the four exchange
 * buckets. Mirrors `resolveExchange` (charges.ts) so the filter and the charge
 * engine agree, but kept dependency-free here. Exact union match → prefix match
 * for broker free-text → segment default.
 */
export function normalizeExchange(segment: Segment, exchange?: string | null): ExchangeFilter {
  if (exchange) {
    const up = String(exchange).trim().toUpperCase();
    if (up === "NSE" || up === "BSE" || up === "MCX" || up === "NCDEX") return up;
    if (up.startsWith("NCDEX")) return "NCDEX"; // before NSE/BSE — distinct prefix
    if (up.startsWith("NSE") || up.startsWith("NFO") || up.startsWith("CDS")) return "NSE";
    if (up.startsWith("BSE") || up.startsWith("BFO")) return "BSE";
    if (up.startsWith("MCX")) return "MCX";
  }
  return segment === "COMM" ? "MCX" : "NSE";
}

// ---------------------------------------------------------------------------
// Product — a legacy trade carries product = null and is treated as MIS by the
// charge engine, so for grouping/filtering we surface it under MIS too (the
// effective product). This keeps a pre-SEG-01 book from sprouting an "Unknown"
// group while staying truthful to how its charges were computed.
// ---------------------------------------------------------------------------

export const PRODUCT_ORDER: Product[] = ["MIS", "CNC", "NRML", "BTST", "STBT"];

export const PRODUCT_LABELS: Record<Product, string> = {
  MIS: "Intraday (MIS)",
  CNC: "Delivery (CNC)",
  NRML: "Carry-forward (NRML)",
  BTST: "BTST",
  STBT: "STBT",
};

/** Short product badge text for the table/cards (kept terse for 360px). */
export const PRODUCT_SHORT: Record<Product, string> = {
  MIS: "MIS",
  CNC: "CNC",
  NRML: "NRML",
  BTST: "BTST",
  STBT: "STBT",
};

/** The effective product used for grouping/filtering: null → MIS (charge parity). */
export function effectiveProduct(t: { product: Product | null }): Product {
  return t.product ?? "MIS";
}

export const SEGMENT_ORDER: Segment[] = ["EQ", "FUT", "OPT", "COMM", "CDS"];

export const SEGMENT_SHORT: Record<Segment, string> = {
  EQ: "EQ",
  FUT: "FUT",
  OPT: "OPT",
  COMM: "COMM",
  CDS: "CDS",
};

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/** The dimension the trades table can be grouped by (default = ungrouped). */
export type GroupBy = "none" | "segment" | "product" | "horizon";

export const GROUP_BY_LABELS: Record<GroupBy, string> = {
  none: "No grouping",
  segment: "Segment",
  product: "Product",
  horizon: "Holding period",
};

/** Per-group subtotals — paise-correct (net summed over stored integer paise). */
export interface GroupSubtotal {
  /** Trade count in the group (open + closed). */
  trades: number;
  /** Closed trades in the group (the win-rate / P&L denominator). */
  closed: number;
  /** Net P&L over the group's CLOSED trades, in the stored paise unit. */
  netPnl: number;
  /** Win rate over closed trades, in [0,1]; 0 when no closed trades. */
  winRate: number;
}

export interface TradeGroup {
  /** Stable key for the group (the dimension value, or "" for unclassified). */
  key: string;
  /** Human-readable group title (e.g. "Options", "Intraday"). */
  label: string;
  trades: TradeWithMeta[];
  subtotal: GroupSubtotal;
}

/** Subtotals over a set of trades — net P&L + win-rate count CLOSED trades only. */
export function subtotalFor(trades: TradeWithMeta[]): GroupSubtotal {
  let netPnl = 0;
  let closed = 0;
  let wins = 0;
  for (const t of trades) {
    if (t.status === "closed") {
      closed++;
      netPnl += t.net_pnl;
      if (t.net_pnl > 0) wins++;
    }
  }
  return {
    trades: trades.length,
    closed,
    netPnl,
    winRate: closed > 0 ? wins / closed : 0,
  };
}

/**
 * The group a single trade belongs to under a dimension, as `{ key, label }`.
 * Horizon is null for an open trade (no realised holding period) → it lands in
 * an explicit "Open" bucket so nothing silently disappears from a grouped view.
 */
function groupOf(t: TradeWithMeta, by: Exclude<GroupBy, "none">): { key: string; label: string } {
  if (by === "segment") {
    return { key: t.segment, label: SEGMENT_LABELS_LOCAL[t.segment] };
  }
  if (by === "product") {
    const p = effectiveProduct(t);
    return { key: p, label: PRODUCT_LABELS[p] };
  }
  // horizon
  const h = classifyHorizon(t);
  if (!h) return { key: "open", label: "Open (unrealised)" };
  return { key: h, label: HORIZON_LABEL[h] };
}

// Segment labels live in filter-predicate (SEGMENT_LABELS); duplicated here to
// keep grouping import-cycle-free with filter-predicate. Single source of truth
// is enforced by a test that asserts the two maps agree.
const SEGMENT_LABELS_LOCAL: Record<Segment, string> = {
  OPT: "Options",
  FUT: "Futures",
  EQ: "Equity",
  COMM: "Commodity",
  CDS: "Currency",
};

/** Fixed group ordering per dimension so a grouped table is stable + scannable. */
function orderIndex(by: Exclude<GroupBy, "none">, key: string): number {
  if (by === "segment") {
    const i = SEGMENT_ORDER.indexOf(key as Segment);
    return i === -1 ? 99 : i;
  }
  if (by === "product") {
    const i = PRODUCT_ORDER.indexOf(key as Product);
    return i === -1 ? 99 : i;
  }
  // horizon — intraday → swing → positional, then open
  if (key === "open") return 99;
  const i = HORIZON_ORDER.indexOf(key as Horizon);
  return i === -1 ? 98 : i;
}

/**
 * Partition trades into ordered groups under a dimension, each with paise-correct
 * subtotals. `by: "none"` (or an empty list) returns a single synthetic "all"
 * group so callers can render uniformly. Group order is fixed per dimension
 * (segment/product/horizon canonical order), not data-dependent.
 */
export function groupTrades(trades: TradeWithMeta[], by: GroupBy): TradeGroup[] {
  if (by === "none") {
    return [{ key: "all", label: "All trades", trades, subtotal: subtotalFor(trades) }];
  }
  const buckets = new Map<string, { label: string; trades: TradeWithMeta[] }>();
  for (const t of trades) {
    const { key, label } = groupOf(t, by);
    const b = buckets.get(key);
    if (b) b.trades.push(t);
    else buckets.set(key, { label, trades: [t] });
  }
  return [...buckets.entries()]
    .sort((a, b) => orderIndex(by, a[0]) - orderIndex(by, b[0]))
    .map(([key, { label, trades: ts }]) => ({
      key,
      label,
      trades: ts,
      subtotal: subtotalFor(ts),
    }));
}
