import { avgR, netPnl, profitFactor, winRate, type TradeLike } from "@/lib/stats/stats";
import { formatINR, formatPct } from "@/lib/utils";
import { rLabel, type ShareCardData } from "@/lib/share-card/model";

/**
 * Builds the share-as-image card data for a weekly/monthly report. ₹ amounts
 * appear ONLY when `includePnl` is true — otherwise the hero is the win rate
 * and every stat stays ratio-based (counts, %, PF, R).
 */

export interface ReportShareInput {
  kind: "week" | "month";
  /** Period heading, e.g. "Week of 9 Jun" or "June 2026". */
  label: string;
  /** Period bounds as YYYY-MM-DD calendar dates. */
  from: string;
  to: string;
  /** Closed trades inside the period. */
  trades: TradeLike[];
}

function dayLabel(dateKey: string, withYear: boolean): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

/** Count green/red days by net daily P&L (sign only — never a ₹ amount). */
function dayCounts(trades: TradeLike[]): { green: number; red: number } {
  const byDay = new Map<string, number>();
  for (const t of trades) {
    const day = (t.closed_at ?? t.opened_at).slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + t.net_pnl);
  }
  let green = 0;
  let red = 0;
  for (const pnl of byDay.values()) {
    if (pnl > 0) green++;
    else if (pnl < 0) red++;
  }
  return { green, red };
}

export function buildReportShareCard(
  input: ReportShareInput,
  opts: { includePnl: boolean }
): ShareCardData {
  const trades = input.trades;
  const n = trades.length;
  const net = netPnl(trades);
  const rate = winRate(trades);
  const pf = profitFactor(trades);
  const pfText = Number.isFinite(pf) ? pf.toFixed(2) : "∞";
  const avg = avgR(trades);
  // net = gross − charges everywhere in the journal, so charges recompose exactly.
  const charges = trades.reduce((s, t) => s + (t.gross_pnl - t.net_pnl), 0);

  let hero: string;
  let heroKind: string;
  let heroTone: ShareCardData["heroTone"];
  let subline: string | null = null;

  if (n === 0) {
    hero = "NO TRADES";
    heroKind = "quiet";
    heroTone = "accent";
  } else if (opts.includePnl) {
    hero = formatINR(net, { decimals: true, signed: true });
    heroKind = "pnl";
    heroTone = net >= 0 ? "profit" : "loss";
    subline =
      `${n} trade${n === 1 ? "" : "s"} · ${formatPct(rate, 0)} wins · PF ${pfText}` +
      ` · Charges ${formatINR(charges, { decimals: true })}`;
  } else {
    hero = `${formatPct(rate, 0)} WIN RATE`;
    heroKind = "winrate";
    heroTone = rate >= 0.5 ? "profit" : "loss";
    subline = `${n} trade${n === 1 ? "" : "s"} · PF ${pfText}${avg != null ? ` · ${rLabel(avg)} avg` : ""}`;
  }

  const { green, red } = dayCounts(trades);

  return {
    title: input.label,
    badges: [{ label: input.kind === "week" ? "WEEKLY REVIEW" : "MONTHLY REVIEW", tone: "accent" }],
    hero,
    heroKind,
    heroTone,
    subline,
    stats: [
      { label: "Trades", value: String(n) },
      { label: "Win rate", value: n > 0 ? formatPct(rate, 0) : "—" },
      { label: "Profit factor", value: n > 0 ? pfText : "—" },
      { label: "Avg R", value: avg != null ? rLabel(avg) : "—" },
    ],
    footnote:
      green > 0 || red > 0
        ? `${green} green day${green === 1 ? "" : "s"} · ${red} red day${red === 1 ? "" : "s"}`
        : null,
    dateLabel: `${dayLabel(input.from, false)} – ${dayLabel(input.to, true)}`,
    fileName: `trademark-${input.kind}-review-${input.from}.png`,
  };
}
