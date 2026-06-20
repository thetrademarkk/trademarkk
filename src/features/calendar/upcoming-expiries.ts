/**
 * Upcoming F&O / commodity expiries across NSE / BSE / MCX / NCDEX — the data
 * layer behind the journal calendar's "Upcoming expiries" view (a Dhan-style
 * cross-exchange expiry calendar).
 *
 * NSE/BSE/MCX dates are REAL listed-contract expiries snapshotted from the Groww
 * instrument master (see expiry-calendar.generated.ts) — so they already bake in
 * holidays and every expiry-day rule change. NCDEX has no Groww scrip, so its
 * active agri contracts (which expire on the 20th of the contract month) are
 * computed here. Everything is pure + deterministic given a `today` key, so the
 * view stays testable and the lib never reads the clock itself.
 */
import { GENERATED_EXPIRY_SERIES, EXPIRY_CALENDAR_AS_OF } from "./expiry-calendar.generated";

export type ExpiryExchange = "NSE" | "BSE" | "MCX" | "NCDEX";
export type ExpiryKind = "index" | "stock" | "commodity";
export type ExpiryInstrumentType = "all" | "options" | "futures";

export interface ExpirySeries {
  /** Normalised underlying, e.g. "NIFTY", "RELIANCE", "CRUDEOIL", "GUARSEED". */
  underlying: string;
  exchange: ExpiryExchange;
  kind: ExpiryKind;
  /** Upcoming expiry dates ("YYYY-MM-DD"), ascending — the union of options + futures. */
  expiries: readonly string[];
  /** Dates an OPTION (CE/PE) expires — for indices the weeklies make this broader than futures. */
  options: readonly string[];
  /** Dates a FUTURE expires. */
  futures: readonly string[];
}

export { EXPIRY_CALENDAR_AS_OF };

/** SEBI-active NCDEX agri contracts (see lot-sizes.ts for lot details). */
const NCDEX_AGRI = [
  "GUARSEED",
  "GUARGUM",
  "JEERAUNJHA",
  "DHANIYA",
  "TURMERIC",
  "CASTORSEED",
  "COCUDAKL",
  "BARLEY",
] as const;

/**
 * The 20th of each upcoming month (the NCDEX ag-futures expiry convention).
 * Approximate — no NCDEX holiday roll — and clearly labelled as such in the UI.
 */
function ncdexMonthlyExpiries(fromKey: string, months = 7): string[] {
  const y = Number(fromKey.slice(0, 4));
  const m = Number(fromKey.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < months; i++) {
    const offset = m - 1 + i;
    const yy = y + Math.floor(offset / 12);
    const mm = (offset % 12) + 1;
    const key = `${yy}-${String(mm).padStart(2, "0")}-20`;
    if (key >= fromKey) out.push(key);
  }
  return out;
}

export function ncdexSeries(fromKey: string): ExpirySeries[] {
  const dates = ncdexMonthlyExpiries(fromKey);
  // NCDEX agri trade both futures and (limited) options; the dates are the same
  // approximate monthly settlement, so both lists carry them.
  return NCDEX_AGRI.map((underlying) => ({
    underlying,
    exchange: "NCDEX" as const,
    kind: "commodity" as const,
    expiries: dates,
    options: dates,
    futures: dates,
  }));
}

/** All expiry series in scope: the Groww snapshot + computed NCDEX. */
export function allExpirySeries(fromKey: string): ExpirySeries[] {
  return [...GENERATED_EXPIRY_SERIES, ...ncdexSeries(fromKey)];
}

export interface ExpiryEvent {
  underlying: string;
  exchange: ExpiryExchange;
  kind: ExpiryKind;
}

export interface ExpiryDay {
  date: string;
  /** Calendar days from `today` (0 = expires today). */
  daysAway: number;
  events: ExpiryEvent[];
}

/** Calendar-day difference (b − a) between two "YYYY-MM-DD" keys. */
export function daysBetween(a: string, b: string): number {
  const ua = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const ub = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((ub - ua) / 86_400_000);
}

export interface UpcomingOpts {
  /** Today as "YYYY-MM-DD" (the caller passes it — the lib never reads the clock). */
  today: string;
  /** Restrict to these exchanges; omit/empty = all. */
  exchanges?: readonly ExpiryExchange[];
  /** Filter by instrument type (default "all" = options ∪ futures). */
  type?: ExpiryInstrumentType;
  /** Horizon in calendar days (default 120 ≈ 4 months). */
  maxDays?: number;
}

/**
 * Invert the per-underlying series into a date-grouped, ascending list of
 * upcoming expiry days (past dates dropped), each carrying every underlying that
 * expires on it — ready for the Dhan-style calendar/list UI.
 */
export function upcomingExpiryDays(opts: UpcomingOpts): ExpiryDay[] {
  const { today, exchanges, type = "all", maxDays = 120 } = opts;
  const filter = exchanges && exchanges.length ? new Set(exchanges) : null;
  const byDate = new Map<string, ExpiryEvent[]>();
  for (const s of allExpirySeries(today)) {
    if (filter && !filter.has(s.exchange)) continue;
    const dates = type === "options" ? s.options : type === "futures" ? s.futures : s.expiries;
    for (const d of dates) {
      if (d < today || daysBetween(today, d) > maxDays) continue;
      const arr = byDate.get(d);
      const event = { underlying: s.underlying, exchange: s.exchange, kind: s.kind };
      if (arr) arr.push(event);
      else byDate.set(d, [event]);
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, events]) => ({ date, daysAway: daysBetween(today, date), events }));
}
