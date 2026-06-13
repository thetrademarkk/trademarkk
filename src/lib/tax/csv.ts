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

import { fyLabel } from "./fy";
import { classifyTrade, fyTaxSummary, tradeTurnover, type TaxTrade } from "./turnover";

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

  lines.push(row(["Speculative vs non-speculative split", ""]));
  lines.push(
    row(["Category", "Trades", "Gross P&L", "Charges", "Net P&L", "Turnover (abs profit)"])
  );
  for (const b of [s.split.speculative, s.split.nonSpeculative]) {
    lines.push(
      row([
        b.category === "speculative"
          ? "Speculative (intraday equity)"
          : "Non-speculative (F&O + delivery)",
        b.trades,
        money(b.grossPnl),
        money(b.charges),
        money(b.netPnl),
        money(b.turnover),
      ])
    );
  }
  lines.push("");

  lines.push(row(["F&O turnover statement", ""]));
  lines.push(row(["F&O trades", s.turnover.trades]));
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
        classifyTrade(t) === "speculative" ? "Speculative" : "Non-speculative",
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
