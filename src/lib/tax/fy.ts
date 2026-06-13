/**
 * Indian financial-year helpers — pure, no I/O.
 *
 * An Indian financial year runs 1 Apr → 31 Mar (e.g. FY 2025-26 = 1 Apr 2025
 * through 31 Mar 2026). All grouping is done on the *realisation* date — the
 * date a trade was closed — interpreted in IST (UTC+5:30), because that is the
 * timezone Indian brokers and the tax department settle on. ISO timestamps are
 * stored in UTC, so a trade closed at 2026-03-31T20:00:00Z is 2026-04-01 IST
 * and lands in the *next* financial year.
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** Calendar date (YYYY-MM-DD) of an ISO instant, in IST. */
export function istDateKey(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 10);
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** True when both instants fall on the same IST calendar date. */
export function sameIstDate(a: string, b: string): boolean {
  return istDateKey(a) === istDateKey(b);
}

/**
 * The Indian financial year (start calendar year) that an IST date belongs to.
 * Jan/Feb/Mar belong to the FY that started the *previous* April.
 */
export function fyStartYearFromIstDate(dateKey: string): number {
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7)); // 1..12
  return month >= 4 ? year : year - 1;
}

/** FY start-year of an ISO instant (IST). */
export function fyStartYear(iso: string): number {
  return fyStartYearFromIstDate(istDateKey(iso));
}

/** "2025-26" label for a FY start year. */
export function fyLabel(startYear: number): string {
  const end = (startYear + 1) % 100;
  return `${startYear}-${String(end).padStart(2, "0")}`;
}

/** ISO date bounds (inclusive) of a FY in IST calendar terms. */
export function fyRange(startYear: number): { from: string; to: string } {
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
}

/** The FY start-year that the current instant falls in (IST). */
export function currentFyStartYear(now: Date = new Date()): number {
  return fyStartYear(now.toISOString());
}

export interface FyGroup<T> {
  /** FY start year, e.g. 2025 for FY 2025-26. */
  startYear: number;
  /** Display label, e.g. "2025-26". */
  label: string;
  /** Trades realised in this FY (by IST close date), newest grouping first. */
  trades: T[];
}

/**
 * Group closed trades by the financial year of their close date (IST).
 * Trades without a close date are dropped (they are not realised). Returns
 * groups sorted by FY descending (most recent first).
 */
export function groupByFy<T extends { closed_at: string | null; status?: string }>(
  trades: T[]
): FyGroup<T>[] {
  const byYear = new Map<number, T[]>();
  for (const t of trades) {
    if (!t.closed_at) continue;
    const y = fyStartYear(t.closed_at);
    const arr = byYear.get(y);
    if (arr) arr.push(t);
    else byYear.set(y, [t]);
  }
  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([startYear, ts]) => ({ startYear, label: fyLabel(startYear), trades: ts }));
}

/**
 * The full list of FY start-years to *offer* in a picker: every year from the
 * earliest realised trade through the current FY, descending — so a year with
 * zero closed trades is still selectable (and flagged) rather than vanishing.
 */
export function availableFyYears(
  trades: { closed_at: string | null }[],
  now: Date = new Date()
): number[] {
  const current = currentFyStartYear(now);
  let earliest = current;
  for (const t of trades) {
    if (!t.closed_at) continue;
    earliest = Math.min(earliest, fyStartYear(t.closed_at));
  }
  const years: number[] = [];
  for (let y = current; y >= earliest; y--) years.push(y);
  return years;
}
