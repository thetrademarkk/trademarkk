/**
 * SEG-10 — contract lot-size reference data for Indian derivatives.
 *
 * The SINGLE SOURCE OF TRUTH for how many underlying units one *lot* of a
 * derivative contract represents. Used by the trade-entry form so a trader can
 * log a derivative in LOTS (the way a broker order is placed) and have the
 * actual quantity in units (lots × lotSize) flow unchanged into the
 * paise-correct charge engine + P&L. EQUITY (cash) has no lots — it is always
 * traded in plain units, so it is intentionally absent here.
 *
 * IMPORTANT — these are DEFAULTS, not gospel. Exchange lot sizes change over
 * time (the exchange revises them periodically, especially for stock F&O and
 * after index reconstitutions). Every entry carries an `asOf` date; the entry
 * UX always lets the user OVERRIDE the lot size or enter the raw unit quantity
 * directly. An unrecognised symbol simply has no default — it never blocks a
 * trade. Lot sizes are a presentation/entry convenience: the stored schema is
 * unchanged (units are persisted as today), so a lot-entered quantity is
 * byte-identical to typing the equivalent unit quantity.
 *
 * Pure data + pure helpers — no I/O, runs identically across hosted/BYOD/local.
 */

import type { Segment } from "@/features/trades/types";
import type { Exchange } from "@/config/brokers";

/** A reference lot-size entry for one derivative contract base. */
export interface LotSizeEntry {
  /**
   * The normalised contract base / underlying symbol (uppercase, no expiry or
   * strike), e.g. "NIFTY", "RELIANCE", "CRUDEOIL", "USDINR".
   */
  symbol: string;
  /** Which derivative segment this lot applies to. EQ never has lots. */
  segment: Extract<Segment, "FUT" | "OPT" | "COMM" | "CDS">;
  /** The exchange this contract trades on (its lot size is exchange-specific). */
  exchange: Exchange;
  /** Units of the underlying per ONE lot. */
  lotSize: number;
  /** Minimum price tick (₹), where a well-known convention exists. Informational. */
  tickSize?: number;
  /** ISO yyyy-mm-dd the lot size was last verified — lot sizes DO change. */
  asOf: string;
}

// The "as-of" date stamped on the reference set. Lot sizes are revised by the
// exchanges periodically — this is when the table below was last reconciled.
export const LOT_SIZE_AS_OF = "2026-06-01";

/**
 * Index F&O lot sizes (NSE index derivatives + BSE SENSEX/BANKEX). One lot of a
 * NIFTY option/future is `lotSize` index units. Reconciled June 2026.
 */
const INDEX_LOTS: LotSizeEntry[] = [
  { symbol: "NIFTY", segment: "OPT", exchange: "NSE", lotSize: 65, asOf: LOT_SIZE_AS_OF },
  { symbol: "BANKNIFTY", segment: "OPT", exchange: "NSE", lotSize: 35, asOf: LOT_SIZE_AS_OF },
  { symbol: "FINNIFTY", segment: "OPT", exchange: "NSE", lotSize: 65, asOf: LOT_SIZE_AS_OF },
  { symbol: "MIDCPNIFTY", segment: "OPT", exchange: "NSE", lotSize: 140, asOf: LOT_SIZE_AS_OF },
  { symbol: "NIFTYNXT50", segment: "OPT", exchange: "NSE", lotSize: 25, asOf: LOT_SIZE_AS_OF },
  { symbol: "SENSEX", segment: "OPT", exchange: "BSE", lotSize: 20, asOf: LOT_SIZE_AS_OF },
  { symbol: "BANKEX", segment: "OPT", exchange: "BSE", lotSize: 30, asOf: LOT_SIZE_AS_OF },
  { symbol: "SENSEX50", segment: "OPT", exchange: "BSE", lotSize: 60, asOf: LOT_SIZE_AS_OF },
];

/**
 * A representative subset of common stock-F&O underlyings (the most-traded NSE
 * single-stock derivatives) with their lot sizes. NOT exhaustive — the NSE F&O
 * list runs to ~180 stocks and lot sizes are revised regularly. These are
 * sensible defaults the user can always override. As-of June 2026.
 */
const STOCK_LOTS: LotSizeEntry[] = [
  { symbol: "RELIANCE", segment: "OPT", exchange: "NSE", lotSize: 500, asOf: LOT_SIZE_AS_OF },
  { symbol: "HDFCBANK", segment: "OPT", exchange: "NSE", lotSize: 550, asOf: LOT_SIZE_AS_OF },
  { symbol: "ICICIBANK", segment: "OPT", exchange: "NSE", lotSize: 700, asOf: LOT_SIZE_AS_OF },
  { symbol: "SBIN", segment: "OPT", exchange: "NSE", lotSize: 750, asOf: LOT_SIZE_AS_OF },
  { symbol: "INFY", segment: "OPT", exchange: "NSE", lotSize: 400, asOf: LOT_SIZE_AS_OF },
  { symbol: "TCS", segment: "OPT", exchange: "NSE", lotSize: 175, asOf: LOT_SIZE_AS_OF },
  { symbol: "ITC", segment: "OPT", exchange: "NSE", lotSize: 1600, asOf: LOT_SIZE_AS_OF },
  { symbol: "AXISBANK", segment: "OPT", exchange: "NSE", lotSize: 625, asOf: LOT_SIZE_AS_OF },
  { symbol: "KOTAKBANK", segment: "OPT", exchange: "NSE", lotSize: 400, asOf: LOT_SIZE_AS_OF },
  { symbol: "TATAMOTORS", segment: "OPT", exchange: "NSE", lotSize: 550, asOf: LOT_SIZE_AS_OF },
  { symbol: "TATASTEEL", segment: "OPT", exchange: "NSE", lotSize: 5500, asOf: LOT_SIZE_AS_OF },
  { symbol: "WIPRO", segment: "OPT", exchange: "NSE", lotSize: 3000, asOf: LOT_SIZE_AS_OF },
  { symbol: "HINDUNILVR", segment: "OPT", exchange: "NSE", lotSize: 300, asOf: LOT_SIZE_AS_OF },
  { symbol: "BHARTIARTL", segment: "OPT", exchange: "NSE", lotSize: 475, asOf: LOT_SIZE_AS_OF },
  { symbol: "LT", segment: "OPT", exchange: "NSE", lotSize: 175, asOf: LOT_SIZE_AS_OF },
  { symbol: "MARUTI", segment: "OPT", exchange: "NSE", lotSize: 50, asOf: LOT_SIZE_AS_OF },
  { symbol: "BAJFINANCE", segment: "OPT", exchange: "NSE", lotSize: 750, asOf: LOT_SIZE_AS_OF },
  { symbol: "HCLTECH", segment: "OPT", exchange: "NSE", lotSize: 350, asOf: LOT_SIZE_AS_OF },
  { symbol: "SUNPHARMA", segment: "OPT", exchange: "NSE", lotSize: 350, asOf: LOT_SIZE_AS_OF },
  { symbol: "ADANIENT", segment: "OPT", exchange: "NSE", lotSize: 300, asOf: LOT_SIZE_AS_OF },
];

/**
 * MCX commodity lot sizes + tick sizes. One lot of GOLD is 100 grams, CRUDEOIL
 * is 100 barrels, etc. Mini/micro variants (GOLDM, SILVERM, CRUDEOILM) carry
 * their own (smaller) lots. As-of June 2026.
 */
const COMMODITY_LOTS: LotSizeEntry[] = [
  {
    symbol: "GOLD",
    segment: "COMM",
    exchange: "MCX",
    lotSize: 100,
    tickSize: 1,
    asOf: LOT_SIZE_AS_OF,
  }, // 100 g
  {
    symbol: "GOLDM",
    segment: "COMM",
    exchange: "MCX",
    lotSize: 10,
    tickSize: 1,
    asOf: LOT_SIZE_AS_OF,
  }, // 10 g
  {
    symbol: "GOLDGUINEA",
    segment: "COMM",
    exchange: "MCX",
    lotSize: 8,
    tickSize: 1,
    asOf: LOT_SIZE_AS_OF,
  },
  {
    symbol: "GOLDPETAL",
    segment: "COMM",
    exchange: "MCX",
    lotSize: 1,
    tickSize: 1,
    asOf: LOT_SIZE_AS_OF,
  },
  {
    symbol: "SILVER",
    segment: "COMM",
    exchange: "MCX",
    lotSize: 30,
    tickSize: 1,
    asOf: LOT_SIZE_AS_OF,
  }, // 30 kg
  {
    symbol: "SILVERM",
    segment: "COMM",
    exchange: "MCX",
    lotSize: 5,
    tickSize: 1,
    asOf: LOT_SIZE_AS_OF,
  }, // 5 kg
  {
    symbol: "SILVERMIC",
    segment: "COMM",
    exchange: "MCX",
    lotSize: 1,
    tickSize: 1,
    asOf: LOT_SIZE_AS_OF,
  }, // 1 kg
  {
    symbol: "CRUDEOIL",
    segment: "COMM",
    exchange: "MCX",
    lotSize: 100,
    tickSize: 1,
    asOf: LOT_SIZE_AS_OF,
  }, // 100 bbl
  {
    symbol: "CRUDEOILM",
    segment: "COMM",
    exchange: "MCX",
    lotSize: 10,
    tickSize: 1,
    asOf: LOT_SIZE_AS_OF,
  }, // 10 bbl
  {
    symbol: "NATURALGAS",
    segment: "COMM",
    exchange: "MCX",
    lotSize: 1250,
    tickSize: 0.1,
    asOf: LOT_SIZE_AS_OF,
  },
  {
    symbol: "NATURALGASMINI",
    segment: "COMM",
    exchange: "MCX",
    lotSize: 250,
    tickSize: 0.1,
    asOf: LOT_SIZE_AS_OF,
  },
  {
    symbol: "COPPER",
    segment: "COMM",
    exchange: "MCX",
    lotSize: 2500,
    tickSize: 0.05,
    asOf: LOT_SIZE_AS_OF,
  }, // 2.5 MT
  {
    symbol: "ZINC",
    segment: "COMM",
    exchange: "MCX",
    lotSize: 5000,
    tickSize: 0.05,
    asOf: LOT_SIZE_AS_OF,
  }, // 5 MT
  {
    symbol: "ALUMINIUM",
    segment: "COMM",
    exchange: "MCX",
    lotSize: 5000,
    tickSize: 0.05,
    asOf: LOT_SIZE_AS_OF,
  },
  {
    symbol: "LEAD",
    segment: "COMM",
    exchange: "MCX",
    lotSize: 5000,
    tickSize: 0.05,
    asOf: LOT_SIZE_AS_OF,
  },
  {
    symbol: "NICKEL",
    segment: "COMM",
    exchange: "MCX",
    lotSize: 1500,
    tickSize: 0.1,
    asOf: LOT_SIZE_AS_OF,
  },
  {
    symbol: "COTTON",
    segment: "COMM",
    exchange: "MCX",
    lotSize: 25,
    tickSize: 10,
    asOf: LOT_SIZE_AS_OF,
  }, // 25 bales
  {
    symbol: "MENTHAOIL",
    segment: "COMM",
    exchange: "MCX",
    lotSize: 360,
    tickSize: 0.1,
    asOf: LOT_SIZE_AS_OF,
  },
];

/**
 * NSE currency derivatives (CDS) lot sizes. The three USD/EUR/GBP-INR pairs are
 * 1000 units of the base currency; JPYINR is quoted per 100 JPY so its lot is
 * 100000 units (1000 × 100). As-of June 2026.
 */
const CURRENCY_LOTS: LotSizeEntry[] = [
  {
    symbol: "USDINR",
    segment: "CDS",
    exchange: "NSE",
    lotSize: 1000,
    tickSize: 0.0025,
    asOf: LOT_SIZE_AS_OF,
  },
  {
    symbol: "EURINR",
    segment: "CDS",
    exchange: "NSE",
    lotSize: 1000,
    tickSize: 0.0025,
    asOf: LOT_SIZE_AS_OF,
  },
  {
    symbol: "GBPINR",
    segment: "CDS",
    exchange: "NSE",
    lotSize: 1000,
    tickSize: 0.0025,
    asOf: LOT_SIZE_AS_OF,
  },
  {
    symbol: "JPYINR",
    segment: "CDS",
    exchange: "NSE",
    lotSize: 100000,
    tickSize: 0.0025,
    asOf: LOT_SIZE_AS_OF,
  },
];

/** The full reference set (single source of truth). */
export const LOT_SIZE_REFERENCE: readonly LotSizeEntry[] = [
  ...INDEX_LOTS,
  ...STOCK_LOTS,
  ...COMMODITY_LOTS,
  ...CURRENCY_LOTS,
];

/**
 * Index lookup keyed by normalised symbol → entry. A symbol that lists in more
 * than one segment (a stock with both futures and options) shares its lot size,
 * so we key on symbol alone; the first matching entry wins. FUT and OPT of the
 * same underlying always have the same lot size, so the OPT entries above also
 * answer FUT lookups.
 */
const BY_SYMBOL: Map<string, LotSizeEntry> = (() => {
  const m = new Map<string, LotSizeEntry>();
  for (const e of LOT_SIZE_REFERENCE) {
    if (!m.has(e.symbol)) m.set(e.symbol, e);
  }
  return m;
})();

/**
 * Normalise a raw symbol to its contract base for a lot lookup: uppercase, drop
 * an exchange prefix (NSE:/MCX:/…), and strip any trailing contract details
 * (expiry/strike/FUT/CE/PE) that begin at the first digit. Mirrors the
 * `commodityBase` normalisation in instrument-parse so "CRUDEOIL25JUNFUT",
 * "MCX:CRUDEOIL" and "CRUDEOIL" all resolve to "CRUDEOIL".
 */
export function lotSymbolBase(symbol: string): string {
  return (symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/^(?:NSE|BSE|NFO|BFO|MCX|NCDEX|NCO|CDS|BCD):/, "")
    .replace(/\d.*$/, "")
    .replace(/[^A-Z]+$/, ""); // drop a trailing -EQ / CE / PE left after the digit strip
}

/**
 * Look up the default lot size for a symbol in a given segment. Returns the
 * reference {@link LotSizeEntry} or `null` when the symbol/segment isn't
 * recognised (an unknown symbol must NEVER block a trade — the caller falls
 * back to manual unit entry). EQ is never lot-traded → always null.
 *
 * FUT and OPT of the same underlying share a lot size, so a FUT lookup answers
 * from the (OPT-keyed) index entry. COMM/CDS match their own entries.
 */
export function lookupLotSize(symbol: string, segment: Segment): LotSizeEntry | null {
  if (segment === "EQ") return null;
  const base = lotSymbolBase(symbol);
  if (!base) return null;
  const entry = BY_SYMBOL.get(base);
  if (!entry) return null;
  // The entry's `segment` is the canonical listing (OPT for index/stock). A FUT
  // trade on the same underlying uses the identical lot size, so accept it.
  if (segment === "FUT" || segment === "OPT") {
    return entry.segment === "FUT" || entry.segment === "OPT" ? entry : null;
  }
  return entry.segment === segment ? entry : null;
}

/**
 * Convenience: the default lot size NUMBER for a symbol+segment, or `null` when
 * unknown. Thin wrapper over {@link lookupLotSize} for callers that only need
 * the multiplier.
 */
export function defaultLotSize(symbol: string, segment: Segment): number | null {
  return lookupLotSize(symbol, segment)?.lotSize ?? null;
}

/**
 * Whether a segment is lot-traded at all (every derivative is; EQ is not).
 * Drives whether the entry form offers the lots↔units helper.
 */
export function segmentUsesLots(segment: Segment): boolean {
  return segment !== "EQ";
}

/**
 * Convert lots → units given a lot size. Quantity is always a whole number of
 * units; we round defensively (the form constrains lots to whole numbers, but a
 * restored draft could carry anything). A non-positive or non-finite lot size
 * means "no usable lot size" → returns null so the caller keeps the raw qty.
 */
export function lotsToUnits(lots: number, lotSize: number): number | null {
  if (!Number.isFinite(lots) || !Number.isFinite(lotSize) || lotSize <= 0) return null;
  return Math.round(lots * lotSize);
}

/**
 * Convert units → lots given a lot size, for DISPLAY only. Returns a possibly
 * fractional number of lots (a hand-typed odd unit count needn't be a whole
 * number of lots) — callers format it. Null when the lot size is unusable.
 */
export function unitsToLots(units: number, lotSize: number): number | null {
  if (!Number.isFinite(units) || !Number.isFinite(lotSize) || lotSize <= 0) return null;
  return units / lotSize;
}

/**
 * Whole-number lot count for a unit quantity IFF it divides evenly, else null.
 * Used to surface "N lots" beside the qty only when the quantity is an exact
 * multiple of the (default) lot size — we never imply a misleading fractional
 * lot in a badge.
 */
export function exactLotCount(units: number, lotSize: number): number | null {
  if (!Number.isFinite(units) || !Number.isFinite(lotSize) || lotSize <= 0) return null;
  if (!Number.isInteger(units)) return null;
  return units % lotSize === 0 ? units / lotSize : null;
}
