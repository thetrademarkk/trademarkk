import { detectMapping, rowsToFills, type ColumnMapping, type RawFill } from "./csv";
import { parseContractName, parseDateOnly, parseTimestamp } from "./instrument-parse";
import type { Product } from "./types";

/**
 * Broker tradebook auto-detection + per-broker column mappers. All parsing is
 * client-side; fills normalize into the existing `RawFill` shape so dedupe
 * stays idempotent. Header layouts researched June 2026 (broker report
 * exports + import docs of Quicko/ClearTax/TradesViz/MProfit); every field
 * accepts aliases since brokers rename columns between report versions, and
 * unrecognized files fall back to the manual column mapper.
 *
 * Zerodha — Console → Reports → Tradebook:
 *   symbol, isin, trade_date, exchange, segment, series, trade_type, auction,
 *   quantity, price, trade_id, order_id, order_execution_time [, expiry_date]
 * Upstox — Reports → Trade report → Export to CSV:
 *   Date, Time, Exchange, Segment, Scrip Name, Side/Trade Type, Quantity,
 *   Price, Trade Num, Order Num
 * Angel One — trade.angelone.in → Reports → Tradebook:
 *   Trade Date, Trade Time, Exchange, Segment, Symbol Name, ISIN,
 *   Transaction Type, Quantity, Trade Price, Order No, Trade No, Product Type
 *   [, Expiry Date, Strike Price, Option Type]
 * Dhan — web.dhan.co → Statements → Trade History:
 *   Date, Time, Exchange, Segment, Security Name, ISIN, Buy/Sell, Quantity,
 *   Trade Price, Order No, Trade No [, Expiry Date, Strike Price, Option Type]
 * Fyers — Tradebook → export:
 *   Client ID, Symbol (NSE:SBIN-EQ / NSE:NIFTY24JUN24500CE),
 *   Trade Date and Time, Exchange, Segment, Transaction Type, Product,
 *   Qty/Traded Qty, Traded Price, Order No, Trade No, Trade Value
 * Groww — Profile → Reports → Order history (stocks & F&O):
 *   Contract name/Stock name, Type (BUY/SELL), Quantity, Average price,
 *   Order status (only EXECUTED rows import), Execution date and time, Exchange
 *
 * Product column (SEG-03): Fyers ("Product") and Angel One ("Product Type")
 * expose the broker order's product code; Dhan exposes "Product"/"Product Type"
 * in fuller exports. We map CNC→CNC, MIS/INTRADAY→MIS, NRML/NORMAL/CARRYFORWARD
 * →NRML, and MARGIN/CO/BO→NRML (a carry/cover/bracket position). Zerodha's
 * Console tradebook and Upstox's/Groww's trade reports carry NO product column,
 * so those imports leave product null and buildTrade infers it from the holding
 * pattern (matching the v4 backfill). Commodity (MCX) and currency (CDS)
 * segments are classified from the symbol by parseContractName.
 */

type Row = Record<string, string>;

export interface BrokerSpec {
  id: "zerodha" | "upstox" | "angelone" | "dhan" | "fyers" | "groww";
  name: string;
  /** Shown in the import dialog, e.g. "Upstox tradebook". */
  label: string;
  /** `h` is the lowercased, trimmed header row. */
  match: (h: string[]) => boolean;
  toFills: (rows: Row[], headers: string[]) => RawFill[];
}

interface BrokerColumns {
  symbol: string[];
  side: string[];
  qty: string[];
  price: string[];
  date: string[];
  time?: string[];
  expiry?: string[];
  strike?: string[];
  optionType?: string[];
  /** Broker product / order-type column (Fyers "Product", Angel One "Product Type"). */
  product?: string[];
  /** When present, only rows whose status is in OK_STATUSES import. */
  status?: string[];
}

/**
 * Maps a broker product/order-type code to our Product enum (SEG-03):
 *   CNC / DELIVERY              → CNC   (equity delivery)
 *   MIS / INTRADAY              → MIS   (intraday)
 *   NRML / NORMAL / CF / CARRY  → NRML  (carry-forward)
 *   MARGIN / CO / BO            → NRML  (margin / cover / bracket → carry basis)
 * Anything unrecognised (or a blank cell) → null, so buildTrade infers product
 * from the holding pattern rather than guessing wrong.
 */
export function mapProduct(raw: string | undefined): Product | null {
  const v = (raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s_-]/g, "");
  if (!v) return null;
  if (v === "CNC" || v.startsWith("DELIV")) return "CNC";
  if (v === "MIS" || v.startsWith("INTRA")) return "MIS";
  if (v === "BTST") return "BTST";
  if (v === "STBT") return "STBT";
  if (
    v === "NRML" ||
    v === "NORMAL" ||
    v === "CF" ||
    v.startsWith("CARRY") ||
    v === "MARGIN" ||
    v === "CO" ||
    v === "BO" ||
    v === "COVER" ||
    v === "BRACKET"
  )
    return "NRML";
  return null;
}

const OK_STATUSES = new Set([
  "executed",
  "complete",
  "completed",
  "traded",
  "filled",
  "success",
  "successful",
]);

const resolveHeader = (headers: string[], candidates: string[]) => {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const c of candidates) {
    const i = lower.indexOf(c);
    if (i >= 0) return headers[i];
  }
  return undefined;
};

const parseNum = (raw: string | undefined) => {
  const n = Number((raw ?? "").replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function makeFills(rows: Row[], headers: string[], cols: BrokerColumns): RawFill[] {
  const get = (cands?: string[]) => (cands ? resolveHeader(headers, cands) : undefined);
  const cSym = get(cols.symbol);
  const cSide = get(cols.side);
  const cQty = get(cols.qty);
  const cPrice = get(cols.price);
  const cDate = get(cols.date);
  const cTime = get(cols.time);
  const cExpiry = get(cols.expiry);
  const cStrike = get(cols.strike);
  const cOt = get(cols.optionType);
  const cProduct = get(cols.product);
  const cStatus = get(cols.status);
  if (!cSym || !cSide || !cQty || !cPrice || !cDate) return [];

  const fills: RawFill[] = [];
  for (const r of rows) {
    if (cStatus) {
      const st = (r[cStatus] ?? "").trim().toLowerCase();
      if (st && !OK_STATUSES.has(st)) continue;
    }
    const rawSym = (r[cSym] ?? "").trim();
    const sideRaw = (r[cSide] ?? "").trim().toLowerCase();
    const qty = Math.abs(parseNum(r[cQty]));
    const price = parseNum(r[cPrice]);
    const time = parseTimestamp(r[cDate], cTime ? r[cTime] : undefined);
    if (!rawSym || !sideRaw || !qty || !price || !time) continue;

    const inst = parseContractName(rawSym);
    let { segment, strike, optionType } = inst;
    const expiry = (cExpiry ? parseDateOnly(r[cExpiry] ?? "") : null) ?? inst.expiry;
    const colStrike = cStrike ? parseNum(r[cStrike]) : 0;
    if (colStrike) {
      // Explicit strike/option-type columns (Angel One, Dhan F&O reports). The
      // symbol already classified COMM/CDS — keep that segment for commodity/
      // currency options; only plain equity F&O rows become OPT.
      if (segment !== "COMM" && segment !== "CDS") segment = "OPT";
      strike = colStrike;
      const ot = (cOt ? (r[cOt] ?? "") : "").trim().toUpperCase();
      optionType = ot.startsWith("C") ? "CE" : ot.startsWith("P") ? "PE" : optionType;
    } else if (segment === "EQ" && expiry) {
      segment = "FUT"; // dated contract without a strike → futures
    }
    fills.push({
      symbol: inst.symbol,
      side: sideRaw.startsWith("b") ? "buy" : "sell",
      qty,
      price,
      time,
      expiry,
      segment,
      strike,
      optionType,
      product: mapProduct(cProduct ? r[cProduct] : undefined),
    });
  }
  return fills.sort((a, b) => (a.time < b.time ? -1 : 1));
}

const has = (h: string[], ...names: string[]) => names.every((n) => h.includes(n));
const hasAny = (h: string[], ...names: string[]) => names.some((n) => h.includes(n));

export const BROKER_SPECS: BrokerSpec[] = [
  {
    id: "fyers",
    name: "Fyers",
    label: "Fyers tradebook",
    match: (h) =>
      has(h, "symbol") &&
      hasAny(h, "trade date and time", "client id", "traded qty", "traded price"),
    toFills: (rows, headers) =>
      makeFills(rows, headers, {
        symbol: ["symbol"],
        side: ["transaction type", "side", "trade type", "buy/sell"],
        qty: ["qty", "traded qty", "quantity"],
        price: ["traded price", "trade price", "price"],
        date: ["trade date and time", "trade time", "trade date", "date"],
        time: ["time"],
        product: ["product", "product type", "order type"],
      }),
  },
  {
    id: "groww",
    name: "Groww",
    label: "Groww order history",
    match: (h) =>
      hasAny(h, "contract name", "stock name") && hasAny(h, "type", "buy/sell", "transaction type"),
    toFills: (rows, headers) =>
      makeFills(rows, headers, {
        symbol: ["contract name", "stock name", "symbol"],
        side: ["type", "buy/sell", "transaction type"],
        qty: ["quantity", "qty"],
        price: ["average price", "avg price", "average fill price", "price"],
        date: [
          "execution date and time",
          "order execution time",
          "order date and time",
          "executed at",
          "order time",
          "date",
        ],
        status: ["order status", "status"],
      }),
  },
  {
    id: "angelone",
    name: "Angel One",
    label: "Angel One tradebook",
    match: (h) =>
      has(h, "symbol name") || (has(h, "scrip name", "strike price") && !h.includes("buy/sell")),
    toFills: (rows, headers) =>
      makeFills(rows, headers, {
        symbol: ["symbol name", "scrip name", "symbol"],
        side: ["transaction type", "trade type", "buy/sell"],
        qty: ["quantity", "qty"],
        price: ["trade price", "price", "avg price"],
        date: ["trade date", "date", "trade date/time"],
        time: ["trade time", "time"],
        expiry: ["expiry date", "expiry"],
        strike: ["strike price", "strike"],
        optionType: ["option type", "opt type"],
        product: ["product type", "product", "order type"],
      }),
  },
  {
    id: "dhan",
    name: "Dhan",
    label: "Dhan trade history",
    match: (h) =>
      hasAny(h, "buy/sell", "b/s") &&
      (hasAny(h, "security name", "name of security") ||
        (has(h, "name") && hasAny(h, "trade no", "trade number"))),
    toFills: (rows, headers) =>
      makeFills(rows, headers, {
        symbol: ["security name", "name of security", "name", "symbol", "scrip name"],
        side: ["buy/sell", "b/s", "transaction type"],
        qty: ["quantity", "qty"],
        price: ["trade price", "price", "avg price", "rate"],
        date: ["date", "trade date", "exchange time"],
        time: ["time", "trade time"],
        expiry: ["expiry date", "expiry"],
        strike: ["strike price", "strike"],
        optionType: ["option type"],
        product: ["product", "product type", "order type"],
      }),
  },
  {
    id: "upstox",
    name: "Upstox",
    label: "Upstox tradebook",
    match: (h) =>
      has(h, "scrip name") && hasAny(h, "side", "trade type", "buy/sell", "transaction type"),
    toFills: (rows, headers) =>
      makeFills(rows, headers, {
        symbol: ["scrip name", "symbol", "instrument"],
        side: ["side", "trade type", "transaction type", "buy/sell"],
        qty: ["quantity", "qty"],
        price: ["price", "trade price", "avg price"],
        date: ["date", "trade date"],
        time: ["time", "trade time"],
        expiry: ["expiry", "expiry date"],
        strike: ["strike price"],
        optionType: ["option type"],
      }),
  },
  {
    id: "zerodha",
    name: "Zerodha",
    label: "Zerodha Console tradebook",
    match: (h) => has(h, "trade_type", "order_execution_time", "symbol", "quantity", "price"),
    // Keeps the original generic path (raw contract symbol in fills) so trade
    // ids — and therefore re-import dedupe — stay identical for existing users.
    toFills: (rows, headers) => rowsToFills(rows, detectMapping(headers) as ColumnMapping),
  },
];

/** Identifies the broker from the CSV header row (null → manual mapping). */
export function detectBroker(headers: string[]): BrokerSpec | null {
  const lower = headers.map((h) => h.toLowerCase().trim());
  return BROKER_SPECS.find((b) => b.match(lower)) ?? null;
}
