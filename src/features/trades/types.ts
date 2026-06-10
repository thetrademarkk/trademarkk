export interface TradeRow {
  id: string;
  account_id: string;
  symbol: string;
  exchange: string;
  segment: "EQ" | "FUT" | "OPT";
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
  segment?: "EQ" | "FUT" | "OPT";
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
  return t.symbol;
}
