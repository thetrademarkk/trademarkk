/**
 * CSV export of the trade-by-trade blotter (AlgoTest parity). Pure string
 * builder — the UI wraps the output in a Blob download. One row per trading-day
 * cycle, with the honesty columns (substituted, flags) included so the export
 * carries the same coverage truth as the on-screen table.
 *
 * Money is paise-correct (2dp). Values are CSV-escaped so a strategy name or
 * flag list with a comma/quote never breaks a column.
 */

import type { RunResult } from "@/features/backtest/shared/run-result";

const HEADERS = [
  "day",
  "entry_ts",
  "exit_ts",
  "legs",
  "gross",
  "charges",
  "net",
  "substituted",
  "flags",
] as const;

function esc(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function isoIst(ts: number): string {
  // IST minute-boundary epoch-ms → "YYYY-MM-DD HH:mm" IST.
  if (!ts) return "";
  const d = new Date(ts + 5.5 * 3600_000);
  return d.toISOString().slice(0, 16).replace("T", " ");
}

/** Build the CSV text for a run's blotter. */
export function blotterToCsv(run: RunResult): string {
  const lines: string[] = [HEADERS.join(",")];
  for (const row of run.blotter) {
    const legs = row.legs
      .map((l) => `${l.side} ${l.qty} ${l.optionType}@${Math.round(l.resolution.served)}`)
      .join(" | ");
    lines.push(
      [
        row.day,
        isoIst(row.entryTs),
        isoIst(row.exitTs),
        esc(legs),
        row.gross.toFixed(2),
        row.charges.toFixed(2),
        row.net.toFixed(2),
        row.substituted ? "yes" : "no",
        esc(row.flags.join(" ")),
      ].join(",")
    );
  }
  return lines.join("\n");
}

/** A safe filename for the CSV download. */
export function blotterCsvFilename(run: RunResult): string {
  const slug = run.config.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `backtest-${slug || "run"}-${run.runId.slice(0, 8)}.csv`;
}
