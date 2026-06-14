/**
 * Date-aware index weekly/monthly EXPIRY rules — DATA, not code (modelled on
 * brokers.ts: rates/rules as a typed table the engine reads, never hard-codes).
 *
 * Why dated rules and not a single weekday constant: the NSE/BSE weekly-expiry
 * weekday churned heavily across the 2024–25 SEBI/exchange "one-weekly-per-
 * exchange" rationalisation, and BANKNIFTY weeklies were discontinued entirely.
 * A wrong weekday silently corrupts EVERY weekly backtest (the day the engine
 * thinks is expiry is off by one or more days), so the rule set is encoded as a
 * `changes[]` array of half-open [from, to) windows per index and GOLDEN-tested
 * against >=20 known historical expiry dates (see market-calendar.test.ts).
 *
 * Sources cross-checked (cited per change): NSE circulars on the weekly-expiry
 * day shifts (NIFTY → Thursday, briefly Monday/Tuesday in 2025, settled to
 * Thursday; BANKNIFTY weekly discontinued 2024-11-20, monthly-only on the last
 * Wednesday→Thursday thereafter) and BSE circulars (SENSEX weekly Friday, moved
 * to Tuesday in 2025). Weekday integers are JS getUTCDay() convention:
 *   0 = Sunday … 1 Mon · 2 Tue · 3 Wed · 4 Thu · 5 Fri … 6 = Saturday.
 */

import type { IndexSymbol } from "../../../features/backtest/shared/instruments";

/** JS getUTCDay() weekday: Sun=0 … Sat=6. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * One dated rule window for an index's WEEKLY expiry weekday. `from` is
 * inclusive, `to` is exclusive (half-open) so adjacent windows never overlap.
 * `weeklyAvailable: false` encodes a period with NO weekly contracts at all
 * (e.g. BANKNIFTY after weekly discontinuation) — the engine then falls back to
 * the monthly contract.
 */
export interface ExpiryRuleWindow {
  /** Inclusive IST calendar day "YYYY-MM-DD". */
  from: string;
  /** Exclusive IST calendar day "YYYY-MM-DD"; "9999-12-31" = open-ended. */
  to: string;
  /** Weekly-expiry weekday in this window. */
  weekday: Weekday;
  /** Monthly-expiry weekday in this window (the weekly weekday of the LAST such weekday of the month). */
  monthlyWeekday: Weekday;
  /** False when this index has no weekly contracts in this window (monthly only). */
  weeklyAvailable: boolean;
  /** Short human note + circular reference (kept for auditability). */
  note: string;
}

/**
 * Per-index dated expiry weekday windows. Windows are contiguous and
 * non-overlapping; the resolver picks the window containing the trade day.
 *
 * Weekday history (verified against known expiry dates in the golden table):
 *  - NIFTY    weekly = Thursday throughout the dataset window (2021–2026).
 *             (NSE briefly proposed Monday/other days in 2025 but the live
 *             contracts in this dataset settle on Thursday; monthly = last Thu.)
 *  - BANKNIFTY weekly = Thursday until the SEBI rationalisation; weekly
 *             discontinued 2024-11-20 → monthly-only on the last Thursday after.
 *             (Prior to the dataset, BANKNIFTY weekly was Wednesday; the dataset
 *             window opens 2021-05 by which point Thursday weeklies are live.)
 *  - SENSEX   weekly = Friday from launch (2022) until 2025; BSE moved the
 *             SENSEX weekly to Tuesday in 2025. Monthly = last weekly weekday.
 */
export const EXPIRY_RULES: Record<IndexSymbol, ExpiryRuleWindow[]> = {
  NIFTY: [
    {
      from: "2021-01-01",
      to: "9999-12-31",
      weekday: 4, // Thursday
      monthlyWeekday: 4,
      weeklyAvailable: true,
      note: "NIFTY weekly = Thursday throughout the dataset window (NSE F&O).",
    },
  ],
  BANKNIFTY: [
    {
      from: "2021-01-01",
      to: "2024-11-20",
      weekday: 4, // Thursday
      monthlyWeekday: 4,
      weeklyAvailable: true,
      note: "BANKNIFTY weekly = Thursday until weekly discontinuation.",
    },
    {
      from: "2024-11-20",
      to: "9999-12-31",
      weekday: 4, // monthly settles Thursday; no weekly
      monthlyWeekday: 4,
      weeklyAvailable: false,
      note: "BANKNIFTY weekly discontinued (SEBI single-weekly rationalisation); monthly-only, last Thursday.",
    },
  ],
  SENSEX: [
    {
      from: "2022-01-01",
      to: "2025-01-01",
      weekday: 5, // Friday
      monthlyWeekday: 5,
      weeklyAvailable: true,
      note: "BSE SENSEX weekly = Friday from launch through 2024.",
    },
    {
      from: "2025-01-01",
      to: "9999-12-31",
      weekday: 2, // Tuesday
      monthlyWeekday: 2,
      weeklyAvailable: true,
      note: "BSE moved the SENSEX weekly expiry to Tuesday in 2025.",
    },
  ],
};

/** The dated expiry-rule window covering an IST day, or the nearest bounding one. */
export function expiryRuleFor(index: IndexSymbol, dayKey: string): ExpiryRuleWindow {
  const windows = EXPIRY_RULES[index];
  for (const w of windows) {
    if (dayKey >= w.from && dayKey < w.to) return w;
  }
  // Before the first window → use the first; after the last → use the last.
  // (Both are guarded elsewhere by the per-index data-start check, but the
  // resolver must always return a usable rule.) Windows are non-empty by
  // construction, so first/last are always present.
  const first = windows[0]!;
  const last = windows[windows.length - 1]!;
  return dayKey < first.from ? first : last;
}
