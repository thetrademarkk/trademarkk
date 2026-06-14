import { computeCharges, computeGrossPnl, resolveExchange } from "@/lib/charges/charges";
import { getChargeProfile, type ChargeProfile } from "@/config/brokers";
import { parseContractName } from "./instrument-parse";
import type { Product, Segment, TradeRow } from "./types";

export interface RawFill {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  time: string; // ISO
  expiry?: string | null;
  /** Pre-parsed instrument fields — set by broker-specific mappers only. */
  segment?: Segment | null;
  strike?: number | null;
  optionType?: "CE" | "PE" | null;
  /**
   * Product / holding intent from the broker's product column (SEG-03), when
   * the report exposes one. Null/absent → buildTrade infers it from the holding
   * pattern (same-day EQ = MIS, overnight EQ = CNC, derivatives = NRML), matching
   * the v4 migration backfill.
   */
  product?: Product | null;
}

export interface ColumnMapping {
  symbol: string;
  side: string;
  qty: string;
  price: string;
  time: string;
  expiry?: string;
}

/** Auto-detects known broker tradebook headers (Zerodha Console first). */
export function detectMapping(headers: string[]): Partial<ColumnMapping> {
  const h = headers.map((x) => x.toLowerCase().trim());
  const find = (...candidates: string[]) => {
    for (const c of candidates) {
      const i = h.indexOf(c);
      if (i >= 0) return headers[i];
    }
    return undefined;
  };
  return {
    symbol: find("symbol", "tradingsymbol", "instrument", "scrip"),
    side: find("trade_type", "buy/sell", "side", "transaction_type", "b/s"),
    qty: find("quantity", "qty", "filled quantity"),
    price: find("price", "avg. price", "trade price", "avg price"),
    time: find("order_execution_time", "trade_date", "date", "time", "executed at"),
    expiry: find("expiry_date", "expiry"),
  };
}

function stableId(parts: (string | number)[]): string {
  // djb2 — deterministic id so re-imports dedupe via INSERT OR IGNORE.
  let hash = 5381;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) + hash + s.charCodeAt(i)) >>> 0;
  return `imp${hash.toString(36)}${s.length.toString(36)}`;
}

function guessInstrument(symbol: string, expiry: string | null) {
  const p = parseContractName(symbol);
  // Dated contract that isn't an option (expiry column set) → futures.
  if (p.segment === "EQ" && expiry) {
    return {
      symbol: p.symbol.replace(/\d.*FUT$/, "").replace(/FUT$/, ""),
      segment: "FUT" as const,
      strike: null,
      optionType: null,
      agri: false,
    };
  }
  return {
    symbol: p.symbol,
    segment: p.segment,
    strike: p.strike,
    optionType: p.optionType,
    agri: p.agri,
  };
}

export function rowsToFills(rows: Record<string, string>[], map: ColumnMapping): RawFill[] {
  const fills: RawFill[] = [];
  for (const r of rows) {
    const side = (r[map.side] ?? "").toLowerCase();
    const qty = Math.abs(Number(r[map.qty]));
    const price = Number(r[map.price]);
    const rawTime = r[map.time] ?? "";
    const time =
      new Date(rawTime).toString() !== "Invalid Date" ? new Date(rawTime).toISOString() : null;
    const symbol = (r[map.symbol] ?? "").trim().toUpperCase();
    if (!symbol || !qty || !price || !time) continue;
    fills.push({
      symbol,
      side: side.startsWith("b") ? "buy" : "sell",
      qty,
      price,
      time,
      expiry: map.expiry ? r[map.expiry] || null : null,
    });
  }
  return fills.sort((a, b) => (a.time < b.time ? -1 : 1));
}

/** FIFO-pairs fills into round-trip trades (splits fills that cross zero). */
export function pairFillsToTrades(
  fills: RawFill[],
  accountId: string,
  chargeProfileId: string
): TradeRow[] {
  const profile = getChargeProfile(chargeProfileId);
  const groups = new Map<string, RawFill[]>();
  for (const f of fills) {
    // Pre-parsed instrument fields join the key so two contracts that share a
    // base symbol (different strikes/expiries) never merge into one trade.
    const key = `${f.symbol}::${f.expiry ?? ""}::${f.segment ?? ""}::${f.strike ?? ""}::${f.optionType ?? ""}`;
    const arr = groups.get(key);
    if (arr) arr.push(f);
    else groups.set(key, [f]);
  }

  const trades: TradeRow[] = [];
  for (const groupFills of groups.values()) {
    let position = 0;
    let entries: RawFill[] = [];
    let exits: RawFill[] = [];
    let direction: "long" | "short" = "long";

    const finalize = () => {
      if (entries.length === 0 || exits.length === 0) return;
      trades.push(buildTrade(entries, exits, direction, accountId, profile));
      entries = [];
      exits = [];
    };

    for (const f of groupFills) {
      let remaining = f.qty;
      while (remaining > 0) {
        if (position === 0) {
          direction = f.side === "buy" ? "long" : "short";
        }
        const isEntry = (direction === "long") === (f.side === "buy");
        if (isEntry) {
          entries.push({ ...f, qty: remaining });
          position += direction === "long" ? remaining : -remaining;
          remaining = 0;
        } else {
          const open = Math.abs(position);
          const closeQty = Math.min(open, remaining);
          exits.push({ ...f, qty: closeQty });
          position += direction === "long" ? -closeQty : closeQty;
          remaining -= closeQty;
          if (position === 0) finalize();
        }
      }
    }
    // Leftover open position → record as an open trade.
    if (entries.length > 0 && exits.length === 0 && position !== 0) {
      trades.push(buildTrade(entries, [], direction, accountId, profile));
    }
  }
  return trades.sort((a, b) => (a.opened_at < b.opened_at ? -1 : 1));
}

function buildTrade(
  entries: RawFill[],
  exits: RawFill[],
  direction: "long" | "short",
  accountId: string,
  profile: ChargeProfile
): TradeRow {
  const wavg = (fs: RawFill[]) => {
    const totalQty = fs.reduce((s, f) => s + f.qty, 0);
    return { qty: totalQty, price: fs.reduce((s, f) => s + f.price * f.qty, 0) / totalQty };
  };
  const e = wavg(entries);
  const first = entries[0]!;
  const inst = first.segment
    ? {
        symbol: first.symbol,
        segment: first.segment,
        strike: first.strike ?? null,
        optionType: first.optionType ?? null,
        // Agri (CTT-exempt) is symbol-derived even when the broker already
        // mapped the segment, so an MCX/NCDEX agri commodity is charged right.
        agri: first.segment === "COMM" && parseContractName(first.symbol).agri,
      }
    : guessInstrument(first.symbol, first.expiry ?? null);
  const closed = exits.length > 0;
  const x = closed ? wavg(exits) : null;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const openedAt = first.time;
  const closedAt = closed ? exits[exits.length - 1]!.time : null;

  // Product (SEG-03). Prefer the broker's parsed product column when present;
  // otherwise infer from the holding pattern, mirroring the v4 migration
  // backfill: same-day equity = MIS (intraday), overnight equity = CNC
  // (delivery), derivatives = NRML. An open equity trade has no close → MIS.
  const inferredProduct: TradeRow["product"] =
    inst.segment === "EQ"
      ? closedAt && closedAt.slice(0, 10) === openedAt.slice(0, 10)
        ? "MIS"
        : closedAt
          ? "CNC"
          : "MIS"
      : "NRML";
  const product: TradeRow["product"] = first.product ?? inferredProduct;

  // Exchange (SEG-CHG). New imports record the segment default (COMM → MCX,
  // CDS/EQ/FUT/OPT → NSE); a broker exchange column may override later. The
  // charge engine resolves it identically, so legacy rows stay byte-identical.
  const exchange = resolveExchange(inst.segment);
  let gross = 0;
  let charges = 0;
  if (closed && x) {
    gross = computeGrossPnl({ direction, qty: e.qty, entryPrice: e.price, exitPrice: x.price });
    charges = computeCharges(profile, {
      segment: inst.segment,
      product,
      exchange,
      qty: e.qty,
      entryPrice: e.price,
      exitPrice: x.price,
      direction,
      orders: entries.length + exits.length,
      // Commodity CTT (SEG-09): an option carries CTT on the sell premium,
      // an agri commodity is CTT-exempt. Both derived from the parsed symbol.
      commodityOption: inst.segment === "COMM" && inst.optionType != null,
      agriCommodity: inst.segment === "COMM" && inst.agri,
      isOption: inst.segment === "CDS" && inst.optionType != null,
    }).total;
  }
  const ts = new Date().toISOString();

  // Legacy id parts stay untouched (re-import dedupe for existing imports);
  // broker-mapped fills carry a base symbol, so the instrument joins the id.
  const idParts: (string | number)[] = [
    first.symbol,
    openedAt,
    e.qty,
    round2(e.price),
    x ? round2(x.price) : "open",
  ];
  if (first.segment)
    idParts.push(first.segment, first.strike ?? "", first.optionType ?? "", first.expiry ?? "");

  return {
    id: stableId(idParts),
    account_id: accountId,
    symbol: inst.symbol,
    exchange,
    segment: inst.segment,
    product,
    expiry: first.expiry ?? null,
    strike: inst.strike,
    option_type: inst.optionType,
    direction,
    status: closed ? "closed" : "open",
    qty: e.qty,
    avg_entry: round2(e.price),
    avg_exit: x ? round2(x.price) : null,
    planned_entry: null,
    planned_sl: null,
    planned_target: null,
    opened_at: openedAt,
    closed_at: closedAt,
    gross_pnl: round2(gross),
    charges: round2(charges),
    net_pnl: round2(gross - charges),
    r_multiple: null,
    playbook_id: null,
    confidence: null,
    notes: null,
    created_at: ts,
    updated_at: ts,
  };
}
