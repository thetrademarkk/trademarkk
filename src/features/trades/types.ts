/**
 * Market segment. EQ = cash equity, FUT/OPT = NSE F&O, COMM = MCX commodity
 * (futures/options), CDS = currency derivatives. Widened in journal-DB v4.
 */
export type Segment = "EQ" | "FUT" | "OPT" | "COMM" | "CDS";

/**
 * Position product / holding intent, mirroring the broker's product column:
 *  - MIS  intraday (square-off same session)
 *  - CNC  delivery (equity, held overnight → delivery STT both sides + DP charge)
 *  - NRML carry-forward (derivatives held overnight)
 *  - BTST buy-today-sell-tomorrow / STBT sell-today-buy-tomorrow (delivery basis, no DP)
 * Legacy trades stored before v4 have product = null → treated as MIS for charges
 * (matching the pre-v4 single intraday-equity branch, so no P&L regression).
 */
export type Product = "MIS" | "CNC" | "NRML" | "BTST" | "STBT";

export interface TradeRow {
  id: string;
  account_id: string;
  symbol: string;
  exchange: string;
  segment: Segment;
  product: Product | null;
  expiry: string | null;
  strike: number | null;
  option_type: "CE" | "PE" | null;
  direction: "long" | "short";
  status: "open" | "closed";
  qty: number;
  avg_entry: number;
  avg_exit: number | null;
  planned_entry: number | null;
  planned_sl: number | null;
  planned_target: number | null;
  opened_at: string;
  closed_at: string | null;
  gross_pnl: number;
  charges: number;
  net_pnl: number;
  r_multiple: number | null;
  playbook_id: string | null;
  confidence: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  name: string;
  kind: "mistake" | "emotion" | "custom";
  color: string;
}

export interface TradeWithMeta extends TradeRow {
  tags: Tag[];
  playbook_name: string | null;
}

export interface FillRow {
  id: string;
  trade_id: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  fill_time: string;
}

/** A strategy leg of a multi-leg trade (straddle, spread…). */
export interface TradeLegRow {
  id: string;
  trade_id: string;
  leg_no: number;
  strike: number | null;
  option_type: "CE" | "PE" | null;
  direction: "long" | "short";
  qty: number;
  avg_entry: number;
  avg_exit: number | null;
}

export interface AccountRow {
  id: string;
  name: string;
  broker: string;
  starting_capital: number;
  charge_profile: string;
}

export interface PlaybookRow {
  id: string;
  name: string;
  description: string | null;
  criteria: string | null;
}

export interface AttachmentRow {
  id: string;
  trade_id: string | null;
  journal_date: string | null;
  data: string;
  caption: string | null;
}

export interface TradeFilters {
  search?: string;
  segment?: Segment;
  product?: Product;
  result?: "win" | "loss";
  direction?: "long" | "short";
  playbookId?: string;
  tagId?: string;
  from?: string | null;
  to?: string | null;
}

/** Human-readable contract name, e.g. "NIFTY 24500 CE (12 Jun)". */
export function describeInstrument(t: {
  symbol: string;
  segment: string;
  strike: number | null;
  option_type: string | null;
  expiry: string | null;
}): string {
  if (t.segment === "OPT" && t.strike) {
    const exp = t.expiry
      ? ` · ${new Date(t.expiry + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
      : "";
    return `${t.symbol} ${t.strike} ${t.option_type ?? ""}${exp}`;
  }
  if (t.segment === "FUT") return `${t.symbol} FUT`;
  if (t.segment === "COMM") return `${t.symbol} (MCX)`;
  if (t.segment === "CDS") return `${t.symbol} (CDS)`;
  return t.symbol;
}
