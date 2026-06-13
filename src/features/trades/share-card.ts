import { formatHoldTime, formatINR, formatNumber } from "@/lib/utils";
import { rLabel, slugify, type ShareCardBadge, type ShareCardData } from "@/lib/share-card/model";
import { describeInstrument } from "./types";

/**
 * Builds the share-as-image card data for a single trade. ₹ amounts appear
 * ONLY when `includePnl` is true (the same opt-in rule as community trade
 * cards) — otherwise the hero falls back to the R multiple or WIN/LOSS.
 */

/** The slice of a trade the share card needs (structural match of TradeWithMeta). */
export interface ShareableTrade {
  symbol: string;
  segment: "EQ" | "FUT" | "OPT";
  strike: number | null;
  option_type: "CE" | "PE" | null;
  expiry: string | null;
  direction: "long" | "short";
  status: "open" | "closed";
  qty: number;
  avg_entry: number;
  avg_exit: number | null;
  opened_at: string;
  closed_at: string | null;
  gross_pnl: number;
  charges: number;
  net_pnl: number;
  r_multiple: number | null;
  playbook_name?: string | null;
  /** Strategy legs on a multi-leg trade (straddle/spread); 0/1 = single leg. */
  legCount?: number;
}

export function buildTradeShareCard(
  trade: ShareableTrade,
  opts: { includePnl: boolean }
): ShareCardData {
  const open = trade.status === "open";
  const win = trade.net_pnl >= 0;

  let hero: string;
  let heroKind: string;
  let heroTone: ShareCardData["heroTone"];
  let subline: string | null = null;

  if (open) {
    hero = "OPEN";
    heroKind = "open";
    heroTone = "warning";
  } else if (opts.includePnl) {
    hero = formatINR(trade.net_pnl, { decimals: true, signed: true });
    heroKind = "pnl";
    heroTone = win ? "profit" : "loss";
    subline =
      `Gross ${formatINR(trade.gross_pnl, { decimals: true, signed: true })}` +
      ` · Charges ${formatINR(trade.charges, { decimals: true })}` +
      (trade.r_multiple != null ? ` · ${rLabel(trade.r_multiple)}` : "");
  } else if (trade.r_multiple != null) {
    hero = rLabel(trade.r_multiple);
    heroKind = "r";
    heroTone = trade.r_multiple >= 0 ? "profit" : "loss";
  } else {
    hero = win ? "WIN" : "LOSS";
    heroKind = "result";
    heroTone = win ? "profit" : "loss";
  }

  const badges: ShareCardBadge[] = [
    {
      label: trade.direction === "long" ? "LONG" : "SHORT",
      tone: trade.direction === "long" ? "profit" : "loss",
    },
  ];
  if (open) badges.push({ label: "OPEN", tone: "warning" });
  if ((trade.legCount ?? 0) > 1) badges.push({ label: `${trade.legCount} LEGS`, tone: "accent" });

  return {
    title: describeInstrument(trade),
    badges,
    hero,
    heroKind,
    heroTone,
    subline,
    stats: [
      { label: "Entry", value: trade.avg_entry.toFixed(2) },
      { label: "Exit", value: trade.avg_exit != null ? trade.avg_exit.toFixed(2) : "—" },
      { label: "Qty", value: formatNumber(trade.qty, 0) },
      { label: "Hold", value: formatHoldTime(trade.opened_at, trade.closed_at) },
    ],
    footnote: trade.playbook_name ? `Setup · ${trade.playbook_name}` : null,
    dateLabel: new Date(trade.opened_at).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    fileName: `trademarkk-${slugify([trade.symbol, trade.strike, trade.option_type])}-${trade.opened_at.slice(0, 10)}.png`,
  };
}
