import { computeCharges, computeGrossPnl } from "@/lib/charges/charges";
import { getChargeProfile, type ChargeProfile } from "@/config/brokers";
import type { TradeRow } from "./types";

export interface RawFill {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  time: string; // ISO
  expiry?: string | null;
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
  const opt = symbol.match(/^(.+?)(\d{4,6})(CE|PE)$/);
  if (opt) {
    const base = opt[1]!.replace(/\d{2}[A-Z]{3}$|\d{2}[A-Z]\d{2}$|\d{5}$/, "").replace(/\d+$/, "");
    return {
      symbol: base || opt[1]!,
      segment: "OPT" as const,
      strike: Number(opt[2]),
      optionType: opt[3] as "CE" | "PE",
    };
  }
  if (/FUT$/.test(symbol) || (expiry && !opt)) {
    return { symbol: symbol.replace(/\d.*FUT$/, "").replace(/FUT$/, ""), segment: "FUT" as const, strike: null, optionType: null };
  }
  return { symbol, segment: "EQ" as const, strike: null, optionType: null };
}

export function rowsToFills(rows: Record<string, string>[], map: ColumnMapping): RawFill[] {
  const fills: RawFill[] = [];
  for (const r of rows) {
    const side = (r[map.side] ?? "").toLowerCase();
    const qty = Math.abs(Number(r[map.qty]));
    const price = Number(r[map.price]);
    const rawTime = r[map.time] ?? "";
    const time = new Date(rawTime).toString() !== "Invalid Date" ? new Date(rawTime).toISOString() : null;
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
    const key = `${f.symbol}::${f.expiry ?? ""}`;
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
  const inst = guessInstrument(first.symbol, first.expiry ?? null);
  const closed = exits.length > 0;
  const x = closed ? wavg(exits) : null;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  let gross = 0;
  let charges = 0;
  if (closed && x) {
    gross = computeGrossPnl({ direction, qty: e.qty, entryPrice: e.price, exitPrice: x.price });
    charges = computeCharges(profile, {
      segment: inst.segment,
      qty: e.qty,
      entryPrice: e.price,
      exitPrice: x.price,
      direction,
      orders: entries.length + exits.length,
    }).total;
  }
  const openedAt = first.time;
  const closedAt = closed ? exits[exits.length - 1]!.time : null;
  const ts = new Date().toISOString();

  return {
    id: stableId([first.symbol, openedAt, e.qty, round2(e.price), x ? round2(x.price) : "open"]),
    account_id: accountId,
    symbol: inst.symbol,
    exchange: "NSE",
    segment: inst.segment,
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
