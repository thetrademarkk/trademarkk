/**
 * Pure, deterministic derivation of recurring MARKET-SESSION / EVENT threads
 * (rank-18) — no I/O, no live market-data feed, no `Date.now()` baked in.
 *
 * "Event threads" here are calendar-derivable, recurring focal points for the
 * community — NOT live news (we have no news feed). Concretely we resolve, for
 * a given IST instant:
 *
 *   • a daily "Market Open" pre-market thread on every trading day, and
 *   • a weekly "Expiry Day" thread when today is an index-derivative expiry.
 *
 * Everything is derived from the Indian holiday calendar + the clock the CALLER
 * passes in, so it is fully unit-testable (inject `now`; never read the clock
 * here). Holidays and weekends yield NO market-session events.
 *
 * Extensibility: events are produced by an ordered REGISTRY of resolvers
 * (`EVENT_RESOLVERS`). An admin-curated, manually-seedable event source can be
 * added later by appending one resolver — without rewriting the engine or the
 * materialization layer (which keys purely on `eventType` + `eventDate`).
 *
 * NO external market-data / earnings / news feed is used or implied: an
 * earnings-style "events" feed would need a paid data source we deliberately do
 * NOT integrate. If such a surface is ever wanted it should be a separate,
 * admin-seedable event-type resolver — never a fabricated live feed.
 */

/** IST is UTC+5:30 — Indian exchanges and the trading calendar settle on it. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** Calendar date (YYYY-MM-DD) of an instant, in IST. */
export function istDateKey(now: Date): string {
  const t = now.getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * IST weekday for a YYYY-MM-DD date key: 0 = Sunday … 6 = Saturday. Computed
 * from the date string at noon UTC (well clear of any timezone boundary) so it
 * is offset-stable regardless of the host machine's timezone.
 */
export function istWeekday(dateKey: string): number {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

/** True on Saturday (6) or Sunday (0). */
export function isWeekend(dateKey: string): boolean {
  const d = istWeekday(dateKey);
  return d === 0 || d === 6;
}

/**
 * NSE/BSE full-day trading holidays (no equity/F&O session) — curated, derivable
 * from the published exchange calendar, NOT a live feed. Covers the FYs around
 * the current product window (2025 + 2026). When today is past the curated
 * range we DON'T fabricate holidays — the calendar simply treats every weekday
 * as a trading day (the worst case is one stray pre-market thread on an
 * uncovered holiday, which a maintainer can prune; we never invent activity).
 *
 * Stored as a Set of YYYY-MM-DD keys for O(1) lookup. Keep sorted by date for
 * readability. Source: NSE trading-holiday circulars.
 */
export const TRADING_HOLIDAYS: ReadonlySet<string> = new Set<string>([
  // ── 2025 ──
  "2025-02-26", // Mahashivratri
  "2025-03-14", // Holi
  "2025-03-31", // Id-Ul-Fitr (Ramzan Id)
  "2025-04-10", // Mahavir Jayanti
  "2025-04-14", // Dr. Ambedkar Jayanti
  "2025-04-18", // Good Friday
  "2025-05-01", // Maharashtra Day
  "2025-08-15", // Independence Day
  "2025-08-27", // Ganesh Chaturthi
  "2025-10-02", // Mahatma Gandhi Jayanti / Dussehra
  "2025-10-21", // Diwali Laxmi Pujan (special muhurat session aside)
  "2025-10-22", // Balipratipada
  "2025-11-05", // Prakash Gurpurb Sri Guru Nanak Dev
  "2025-12-25", // Christmas
  // ── 2026 ──
  "2026-01-26", // Republic Day
  "2026-02-15", // Mahashivratri (obs)
  "2026-03-04", // Holi
  "2026-03-21", // Id-Ul-Fitr (Ramzan Id)
  "2026-03-31", // Mahavir Jayanti / year-end
  "2026-04-03", // Good Friday
  "2026-04-14", // Dr. Ambedkar Jayanti
  "2026-05-01", // Maharashtra Day
  "2026-08-15", // Independence Day (Saturday — also weekend)
  "2026-09-14", // Ganesh Chaturthi
  "2026-10-02", // Mahatma Gandhi Jayanti
  "2026-11-09", // Diwali region holidays window
  "2026-11-10",
  "2026-12-25", // Christmas
]);

/** True when `dateKey` is a curated full-day exchange holiday. */
export function isTradingHoliday(dateKey: string): boolean {
  return TRADING_HOLIDAYS.has(dateKey);
}

/**
 * A trading day = a weekday that is not a curated holiday. Deterministic given
 * the date key; the holiday list is curated (no live feed).
 */
export function isTradingDay(dateKey: string): boolean {
  return !isWeekend(dateKey) && !isTradingHoliday(dateKey);
}

/* ── Index-derivative expiry derivation ─────────────────────────────────────
 *
 * We model the *current-regime* recurring index expiries. The exchanges have
 * shuffled weekly-expiry weekdays over time and SEBI has moved to fewer weekly
 * contracts; rather than hard-code a brittle per-week schedule, we anchor on the
 * one expiry that has been stable and is unambiguously "expiry day" community-
 * wide: the WEEKLY expiry weekday for the headline indices, holiday-shifted to
 * the previous trading day when the nominal weekday is a holiday.
 *
 * This is intentionally conservative and easy to maintain: it derives a single
 * "is today an index expiry" boolean per index from the weekday + holiday
 * calendar. It is NOT a contract-master and does not claim per-strike accuracy —
 * it only powers a community discussion thread, with an honest label.
 */

/** Nominal weekly-expiry weekday per headline index (IST). 1=Mon … 5=Fri. */
const WEEKLY_EXPIRY_WEEKDAY: Record<string, number> = {
  // NIFTY weekly options expire on Thursday (current regime).
  NIFTY: 4,
  // SENSEX weekly options expire on Tuesday (current regime).
  SENSEX: 2,
};

/** The indices we surface an expiry thread for. */
export const EXPIRY_INDICES = ["NIFTY", "SENSEX"] as const;
export type ExpiryIndex = (typeof EXPIRY_INDICES)[number];

/**
 * The previous trading day strictly before `dateKey` (skips weekends + curated
 * holidays). Bounded scan (≤ 10 days) so a long holiday cluster can't loop.
 */
export function previousTradingDay(dateKey: string): string {
  let d = dateKey;
  for (let i = 0; i < 10; i++) {
    d = addDays(d, -1);
    if (isTradingDay(d)) return d;
  }
  return d;
}

/** Adds `delta` calendar days to a YYYY-MM-DD key (UTC-noon arithmetic). */
export function addDays(dateKey: string, delta: number): string {
  const base = new Date(`${dateKey}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + delta);
  return base.toISOString().slice(0, 10);
}

/**
 * The set of indices whose weekly expiry falls on `dateKey`. An expiry whose
 * nominal weekday is a holiday shifts to the PREVIOUS trading day (the exchange
 * convention), so a holiday-Thursday makes Wednesday the NIFTY expiry. A date
 * that is itself a holiday/weekend is never an expiry day.
 *
 * Deterministic from the weekday + holiday calendar only.
 */
export function expiriesOn(dateKey: string): ExpiryIndex[] {
  if (!isTradingDay(dateKey)) return [];
  const out: ExpiryIndex[] = [];
  for (const index of EXPIRY_INDICES) {
    const nominalWeekday = WEEKLY_EXPIRY_WEEKDAY[index]!;
    // The nominal expiry date THIS week for that weekday.
    const today = istWeekday(dateKey);
    // Offset from `dateKey` to this week's nominal expiry weekday.
    const nominalDate = addDays(dateKey, nominalWeekday - today);
    // Holiday-shift: if the nominal expiry weekday is a holiday/weekend, expiry
    // moves to the previous trading day. `dateKey` is an expiry iff it equals
    // the (possibly shifted) effective expiry date for this week.
    const effective = isTradingDay(nominalDate) ? nominalDate : previousTradingDay(nominalDate);
    if (effective === dateKey) out.push(index);
  }
  return out;
}

/** True when `dateKey` is an index-derivative expiry for at least one index. */
export function isExpiryDay(dateKey: string): boolean {
  return expiriesOn(dateKey).length > 0;
}

/* ── Event model + extensible resolver registry ─────────────────────────────── */

/**
 * The kind of a recurring event thread. The string value is the STABLE natural
 * key persisted in `event_threads.event_type` (with `event_date`) — never
 * rename an existing value (it would orphan materialized threads). Add new kinds
 * by APPENDING here + a resolver below.
 */
export type EventType = "market-open" | "expiry-day";

/** A resolved active event for a given IST date — the materialization input. */
export interface ActiveEvent {
  /** Stable event-type key (half of the natural key). */
  type: EventType;
  /** IST date key YYYY-MM-DD (the other half of the natural key). */
  date: string;
  /** Human title for the auto-created thread post. */
  title: string;
  /** Short body the house account opens the thread with. */
  body: string;
  /** Tags applied to the thread post (lowercase, dash grammar). */
  tags: string[];
  /** A short, human time-box label for the UI strip, e.g. "Expiry Day · 13 Jun". */
  badge: string;
  /** Sort weight — lower sorts first in the UI strip (expiry above open). */
  order: number;
}

/** A resolver maps an IST date to zero or more active events. Pure + ordered. */
type EventResolver = (dateKey: string) => ActiveEvent[];

/** "13 Jun" style short date for badges, derived from the YYYY-MM-DD key. */
export function shortDate(dateKey: string): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Joins index names for a label: ["NIFTY"] → "NIFTY"; both → "NIFTY & SENSEX". */
function joinIndices(indices: readonly string[]): string {
  if (indices.length <= 1) return indices[0] ?? "";
  return `${indices.slice(0, -1).join(", ")} & ${indices[indices.length - 1]}`;
}

/**
 * The ordered resolver registry. Each resolver is pure and independent; the
 * engine concatenates their outputs and sorts by `order`. To add an
 * admin-curated event type later, append a resolver that reads a seeded source —
 * the materialization layer needs no change (it keys on type+date).
 */
export const EVENT_RESOLVERS: ReadonlyArray<EventResolver> = [
  // ── Expiry Day (weekly index-derivative expiry) ──
  (dateKey) => {
    const indices = expiriesOn(dateKey);
    if (indices.length === 0) return [];
    const names = joinIndices(indices);
    return [
      {
        type: "expiry-day",
        date: dateKey,
        title: `Expiry Day — ${names} (${shortDate(dateKey)})`,
        body:
          `Today is a weekly index-derivative expiry (${names}). Share how you're ` +
          `playing the session — adjustments, theta plays, what you're watching into ` +
          `the close. Educational discussion only, not tips or calls.`,
        tags: ["expiry", "options"],
        badge: `Expiry Day · ${shortDate(dateKey)}`,
        order: 0,
      },
    ];
  },
  // ── Market Open (daily pre-market thread on every trading day) ──
  (dateKey) => {
    if (!isTradingDay(dateKey)) return [];
    return [
      {
        type: "market-open",
        date: dateKey,
        title: `Market Open — ${shortDate(dateKey)}`,
        body:
          `Pre-market thread for ${shortDate(dateKey)}. Drop your levels, bias and ` +
          `the setups you're stalking today. Keep it educational — no tips or calls.`,
        tags: ["market-open"],
        badge: `Market Open · ${shortDate(dateKey)}`,
        order: 1,
      },
    ];
  },
];

/**
 * Resolves every active recurring event for the given instant (IST). Returns []
 * on a holiday/weekend (no market session → no thread). Deterministic: depends
 * only on the injected `now` and the curated calendar. Sorted by `order` then
 * type so the UI ordering is stable.
 */
export function resolveActiveEvents(now: Date): ActiveEvent[] {
  const dateKey = istDateKey(now);
  if (!dateKey) return [];
  const events = EVENT_RESOLVERS.flatMap((resolve) => resolve(dateKey));
  return events.sort((a, b) => a.order - b.order || a.type.localeCompare(b.type));
}

/**
 * Whether markets are CLOSED on the given instant (weekend or curated holiday) —
 * powers the graceful "Markets closed today" empty state. Note this is the
 * inverse of a trading DAY, independent of the intraday clock (the surface is a
 * day-level focal point, not a live session ticker).
 */
export function isMarketClosed(now: Date): boolean {
  const dateKey = istDateKey(now);
  return !dateKey || !isTradingDay(dateKey);
}

/** The natural materialization key for an event: "type:date". Stable + unique. */
export function eventKey(type: EventType, date: string): string {
  return `${type}:${date}`;
}
