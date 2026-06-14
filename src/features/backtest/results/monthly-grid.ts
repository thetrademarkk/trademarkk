/**
 * Monthly-returns heatmap bucketing — the honesty rule here is: a month with NO
 * traded data is `null` (rendered hatched/empty), NEVER a faked ₹0. A real ₹0
 * month (traded, broke even) is distinct from a no-data month and stays 0.
 *
 * Input is the RunResult.monthlyReturns array (only months that actually traded
 * appear there) plus the config date range (so we know which months were IN
 * SCOPE but produced no data → hatched). We build a dense year × 12 grid over
 * the span; any in-span month absent from monthlyReturns is `null`.
 *
 * Pure & deterministic — unit-tested for the hatched-not-zero invariant.
 */

import type { MonthlyReturn } from "@/features/backtest/shared/run-result";

export const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export interface MonthCell {
  /** "YYYY-MM". */
  month: string;
  /** 1..12. */
  monthIndex: number;
  /** Net P&L for the month, or null when the month is in-span but had NO data. */
  pnl: number | null;
}

export interface YearRow {
  year: number;
  /** 12 cells, Jan..Dec; out-of-span months are null too (also hatched). */
  cells: MonthCell[];
  /** How many of the 12 months actually carried data (for "5/12 covered"). */
  covered: number;
}

export interface MonthlyGrid {
  rows: YearRow[];
  /** Largest absolute monthly pnl across covered cells — for the colour scale. */
  maxAbs: number;
}

function ym(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex).padStart(2, "0")}`;
}

/**
 * Build the dense monthly grid. `rangeStart`/`rangeEnd` are "YYYY-MM-DD"; we span
 * whole years between them. A month is `null` (hatched) unless it appears in
 * `monthly` — including in-span months that simply never traded.
 */
export function buildMonthlyGrid(
  monthly: MonthlyReturn[],
  rangeStart: string,
  rangeEnd: string
): MonthlyGrid {
  const byMonth = new Map<string, number>();
  for (const m of monthly) byMonth.set(m.month, m.pnl);

  const startYear = Number(rangeStart.slice(0, 4));
  const endYear = Number(rangeEnd.slice(0, 4));
  const startMonth = Number(rangeStart.slice(5, 7));
  const endMonth = Number(rangeEnd.slice(5, 7));

  let maxAbs = 0;
  const rows: YearRow[] = [];

  for (let year = startYear; year <= endYear; year++) {
    const cells: MonthCell[] = [];
    let covered = 0;
    for (let mi = 1; mi <= 12; mi++) {
      const key = ym(year, mi);
      // Out of the [start, end] month window → not in scope → hatched (null).
      const inSpan = (year > startYear || mi >= startMonth) && (year < endYear || mi <= endMonth);
      let pnl: number | null = null;
      if (inSpan && byMonth.has(key)) {
        pnl = byMonth.get(key)!;
        covered++;
        const abs = Math.abs(pnl);
        if (abs > maxAbs) maxAbs = abs;
      }
      cells.push({ month: key, monthIndex: mi, pnl });
    }
    rows.push({ year, cells, covered });
  }

  return { rows, maxAbs };
}

/**
 * Diverging colour intensity for a covered cell, 0..1 magnitude. Returns null for
 * a no-data cell so the UI knows to hatch it (NOT to paint a 0-magnitude tile).
 */
export function cellMagnitude(cell: MonthCell, maxAbs: number): number | null {
  if (cell.pnl === null) return null;
  if (maxAbs <= 0) return 0;
  return Math.min(1, Math.abs(cell.pnl) / maxAbs);
}
