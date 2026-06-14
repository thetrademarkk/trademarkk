/**
 * CSV builders for the tax & reporting pack. Pure string output — the caller
 * triggers the download. Two flavours:
 *   - buildTaxCsv     → plain RFC-4180 CSV (UTF-8, no BOM)
 *   - toExcelCsv      → wraps any CSV with a UTF-8 BOM + a `sep=,` hint so
 *                       Excel opens it with correct columns and ₹/Unicode.
 *
 * Money is emitted in rupees with two-decimal (paise) precision — the same
 * units stored on TradeRow. We never round money away here.
 */

import { capitalGainsTerm } from "@/lib/stats/horizon";
import { fyLabel } from "./fy";
import {
  CG_LTCG_RATE_PCT,
  CG_RATE_EFFECTIVE_FROM,
  CG_STCG_RATE_PCT,
  classifyTaxBucket,
  fyTaxSummary,
  tradeTurnover,
  type TaxBucketKind,
  type TaxTrade,
} from "./turnover";

/** Human label for a trade's income head, with STCG/LTCG term for capital gains. */
function ledgerCategory(t: TaxTrade): string {
  const kind: TaxBucketKind = classifyTaxBucket(t);
  if (kind === "speculative") return "Speculative";
  if (kind === "non-speculative-business") return "Non-speculative business";
  // Capital gains — annotate the holding term.
  if (!t.closed_at) return "Capital gains";
  return capitalGainsTerm(t.opened_at, t.closed_at) === "long"
    ? "Capital gains (LTCG)"
    : "Capital gains (STCG)";
}

/** RFC-4180 escape: quote a field that holds a comma, quote or newline. */
export function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function row(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}

const money = (paiseRupees: number) => (Math.round(paiseRupees * 100) / 100).toFixed(2);

/**
 * The full tax workbook for one financial year as a single CSV with labelled
 * sections (summary, speculative split, F&O turnover, charges, realised P&L by
 * instrument, then the trade ledger). Blank lines separate sections so it stays
 * readable in a spreadsheet.
 */
export function buildTaxCsv(
  startYear: number,
  trades: TaxTrade[],
  charges: {
    brokerage: number;
    stt: number;
    exchange: number;
    sebi: number;
    gst: number;
    stampDuty: number;
    dpCharge: number;
    actualTotal: number;
    estimated: boolean;
  }
): string {
  const s = fyTaxSummary(trades);
  const lines: string[] = [];

  lines.push(row(["TradeMarkk — Tax & reporting", `FY ${fyLabel(startYear)}`]));
  lines.push(row(["Informational only — not tax advice. Verify with a CA.", ""]));
  lines.push("");

  lines.push(row(["Summary", ""]));
  lines.push(row(["Closed trades", s.trades]));
  lines.push(row(["Gross P&L (INR)", money(s.grossPnl)]));
  lines.push(row(["Charges (INR)", money(s.charges)]));
  lines.push(row(["Net realised P&L (INR)", money(s.netPnl)]));
  lines.push(row(["Charge drag (% of gross)", (s.chargeDragPct * 100).toFixed(2)]));
  lines.push("");

  lines.push(row(["Income classification (three-way)", ""]));
  lines.push(row(["Head of income", "Trades", "Gross P&L", "Charges", "Net P&L"]));
  const { speculative, nonSpeculativeBusiness, capitalGains, cg } = s.buckets;
  lines.push(
    row([
      "Speculative business (intraday equity)",
      speculative.trades,
      money(speculative.grossPnl),
      money(speculative.charges),
      money(speculative.netPnl),
    ])
  );
  lines.push(
    row([
      "Non-speculative business (F&O / commodity / currency)",
      nonSpeculativeBusiness.trades,
      money(nonSpeculativeBusiness.grossPnl),
      money(nonSpeculativeBusiness.charges),
      money(nonSpeculativeBusiness.netPnl),
    ])
  );
  lines.push(
    row([
      "Capital gains (delivery equity)",
      capitalGains.trades,
      money(capitalGains.grossPnl),
      money(capitalGains.charges),
      money(capitalGains.netPnl),
    ])
  );
  lines.push("");

  // Capital-gains STCG/LTCG statement (delivery equity only).
  lines.push(row(["Capital gains — STCG / LTCG (delivery equity)", ""]));
  lines.push(row(["Term", "Trades", "Gross P&L", "Net P&L (realised)"]));
  lines.push(
    row([
      "STCG (held ≤ 12 months)",
      cg.shortTerm.trades,
      money(cg.shortTerm.grossPnl),
      money(cg.shortTerm.netPnl),
    ])
  );
  lines.push(
    row([
      "LTCG (held > 12 months)",
      cg.longTerm.trades,
      money(cg.longTerm.grossPnl),
      money(cg.longTerm.netPnl),
    ])
  );
  lines.push(row([`LTCG yearly exemption (INR)`, money(cg.ltcgExemption)]));
  lines.push(row(["LTCG net after exemption (INR)", money(cg.ltcgTaxableAfterExemption)]));
  lines.push(
    row([
      `Statutory rate labels (informational, ${CG_RATE_EFFECTIVE_FROM})`,
      `STCG ${CG_STCG_RATE_PCT}% · LTCG ${CG_LTCG_RATE_PCT}% on listed equity`,
    ])
  );
  lines.push(row(["This is a classification + realised statement, not a tax computation.", ""]));
  lines.push("");

  lines.push(row(["F&O / commodity / currency turnover statement", ""]));
  lines.push(row(["Derivative trades", s.turnover.trades]));
  lines.push(
    row(["Turnover — absolute-profit convention (INR)", money(s.turnover.absoluteProfitTurnover)])
  );
  lines.push(row(["  Total profit (INR)", money(s.turnover.totalProfit)]));
  lines.push(row(["  Total loss (INR)", money(s.turnover.totalLoss)]));
  lines.push(row(["Net realised P&L (INR)", money(s.turnover.netRealised)]));
  lines.push(row(["Notional / contract turnover (alt) (INR)", money(s.turnover.notionalTurnover)]));
  lines.push(row(["Sell-side turnover (alt) (INR)", money(s.turnover.sellTurnover)]));
  lines.push("");

  lines.push(
    row(["Charges breakdown", charges.estimated ? "components estimated from charge profile" : ""])
  );
  lines.push(row(["Brokerage (INR)", money(charges.brokerage)]));
  lines.push(row(["STT / CTT (INR)", money(charges.stt)]));
  lines.push(row(["Exchange txn (INR)", money(charges.exchange)]));
  lines.push(row(["SEBI fee (INR)", money(charges.sebi)]));
  lines.push(row(["GST (INR)", money(charges.gst)]));
  lines.push(row(["Stamp duty (INR)", money(charges.stampDuty)]));
  lines.push(row(["DP charges (INR)", money(charges.dpCharge)]));
  lines.push(row(["Total charges (actual) (INR)", money(charges.actualTotal)]));
  lines.push("");

  lines.push(row(["Realised P&L by instrument", ""]));
  lines.push(
    row([
      "Symbol",
      "Segment",
      "Trades",
      "Qty",
      "Buy value",
      "Sell value",
      "Gross P&L",
      "Charges",
      "Net P&L",
    ])
  );
  for (const r of s.byInstrument) {
    lines.push(
      row([
        r.symbol,
        r.segment,
        r.trades,
        r.qty,
        money(r.buyValue),
        money(r.sellValue),
        money(r.grossPnl),
        money(r.charges),
        money(r.netPnl),
      ])
    );
  }
  lines.push("");

  lines.push(row(["Trade ledger", ""]));
  lines.push(
    row([
      "Open date",
      "Close date",
      "Symbol",
      "Segment",
      "Direction",
      "Category",
      "Qty",
      "Avg entry",
      "Avg exit",
      "Buy value",
      "Sell value",
      "Gross P&L",
      "Charges",
      "Net P&L",
    ])
  );
  for (const t of trades) {
    const tt = tradeTurnover(t);
    lines.push(
      row([
        t.opened_at.slice(0, 10),
        t.closed_at ? t.closed_at.slice(0, 10) : "",
        t.symbol,
        t.segment,
        t.direction,
        ledgerCategory(t),
        t.qty,
        money(t.avg_entry),
        t.avg_exit == null ? "" : money(t.avg_exit),
        money(tt.buy),
        money(tt.sell),
        money(t.gross_pnl),
        money(t.charges),
        money(t.net_pnl),
      ])
    );
  }

  return lines.join("\r\n");
}

/** Wrap CSV text for Excel: UTF-8 BOM + `sep=,` hint line so ₹ and columns parse. */
export function toExcelCsv(csv: string): string {
  return `﻿sep=,\r\n${csv}`;
}
