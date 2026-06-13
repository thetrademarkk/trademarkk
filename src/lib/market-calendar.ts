/**
 * Indian market calendar — 2026 NSE/BSE equity + MCX commodity trading holidays.
 *
 * Two consumers:
 *  1. The backtester, so it can skip non-trading days (weekends for NSE/BSE, and
 *     any listed holiday) instead of generating signals on days the market is shut.
 *  2. The app UI, so it can surface a friendly festive greeting on a holiday.
 *
 * All helpers are PURE and IST-based. Dates are compared on their IST calendar
 * day (Asia/Kolkata, UTC+5:30) — never on `Date.now()` — so tests stay
 * deterministic by passing dates in explicitly. Accepts either a `"YYYY-MM-DD"`
 * string (interpreted as an IST calendar day) or a `Date` (projected into IST).
 *
 * Holiday dates were cross-checked against at least two public sources each
 * (NSE/BSE: Zerodha, ClearTax, Groww; MCX: Upstox, Groww, Jainam) plus exchange
 * circulars surfaced via news for the unusual Jan-15 civic-election closure.
 * Where two sources disagreed (mostly MCX partial morning/evening sessions vs.
 * a full closure), the date is included but marked `tentative: true`.
 *
 * TODO: surface getFestiveGreeting() in the journal dashboard banner and have
 * the backtester call isTradingDay()/nextTradingDay() when stepping its date
 * cursor.
 */

export type Exchange = "NSE" | "BSE" | "MCX";

export interface MarketHoliday {
  /** IST calendar day, "YYYY-MM-DD". */
  date: string;
  /** Human-readable holiday name. */
  name: string;
  /** Exchanges closed (fully) on this date. */
  exchanges: Exchange[];
  /**
   * True when public sources disagreed on this date — typically an MCX date
   * that some lists treat as a full closure and others as a partial
   * (morning-only / evening-only) session. Treated as a holiday here, but
   * flagged so callers can choose to be lenient.
   */
  tentative?: boolean;
}

/**
 * 2026 holiday table. NSE and BSE share the equity-segment holiday list, so
 * dates closed for the cash market carry both. MCX has its own list; commodity
 * partial-session days (where sources disagreed on full vs. morning/evening
 * closure) are marked tentative.
 *
 * NSE/BSE: 16 holidays — all three sources (Zerodha, ClearTax, Groww) agree.
 * MCX full-day closures align with the NSE/BSE majors; the festival dates that
 * MCX runs as partial sessions are included as tentative for MCX only.
 */
export const MARKET_HOLIDAYS_2026: readonly MarketHoliday[] = [
  // Jan 15 was initially only a settlement holiday; exchanges later declared a
  // FULL trading holiday (incl. commodities) for the Maharashtra civic polls.
  {
    date: "2026-01-15",
    name: "Maharashtra Municipal Corporation Elections",
    exchanges: ["NSE", "BSE", "MCX"],
  },
  { date: "2026-01-26", name: "Republic Day", exchanges: ["NSE", "BSE", "MCX"] },
  // MCX runs an evening session on Holi; treated as a holiday but flagged.
  { date: "2026-03-03", name: "Holi", exchanges: ["NSE", "BSE", "MCX"], tentative: true },
  // Sources split on MCX: Calendarlabs full-day, Jainam/Groww morning-only.
  {
    date: "2026-03-26",
    name: "Shri Ram Navami",
    exchanges: ["NSE", "BSE", "MCX"],
    tentative: true,
  },
  {
    date: "2026-03-31",
    name: "Shri Mahavir Jayanti",
    exchanges: ["NSE", "BSE", "MCX"],
    tentative: true,
  },
  { date: "2026-04-03", name: "Good Friday", exchanges: ["NSE", "BSE", "MCX"] },
  {
    date: "2026-04-14",
    name: "Dr. Baba Saheb Ambedkar Jayanti",
    exchanges: ["NSE", "BSE", "MCX"],
    tentative: true,
  },
  {
    date: "2026-05-01",
    name: "Maharashtra Day",
    exchanges: ["NSE", "BSE", "MCX"],
    tentative: true,
  },
  { date: "2026-05-28", name: "Bakri Eid", exchanges: ["NSE", "BSE", "MCX"], tentative: true },
  { date: "2026-06-26", name: "Muharram", exchanges: ["NSE", "BSE", "MCX"], tentative: true },
  {
    date: "2026-09-14",
    name: "Ganesh Chaturthi",
    exchanges: ["NSE", "BSE", "MCX"],
    tentative: true,
  },
  { date: "2026-10-02", name: "Mahatma Gandhi Jayanti", exchanges: ["NSE", "BSE", "MCX"] },
  { date: "2026-10-20", name: "Dussehra", exchanges: ["NSE", "BSE", "MCX"], tentative: true },
  {
    date: "2026-11-10",
    name: "Diwali-Balipratipada",
    exchanges: ["NSE", "BSE", "MCX"],
    tentative: true,
  },
  {
    date: "2026-11-24",
    name: "Prakash Gurpurb Sri Guru Nanak Dev",
    exchanges: ["NSE", "BSE", "MCX"],
    tentative: true,
  },
  { date: "2026-12-25", name: "Christmas", exchanges: ["NSE", "BSE", "MCX"] },
] as const;

const HOLIDAY_BY_DATE: ReadonlyMap<string, MarketHoliday> = new Map(
  MARKET_HOLIDAYS_2026.map((h) => [h.date, h])
);

/**
 * Normalize a date input to its IST calendar day, "YYYY-MM-DD".
 *
 * A `"YYYY-MM-DD"` string is taken as-is (already an IST calendar day). A
 * `Date` is projected into Asia/Kolkata (UTC+5:30) before extracting the day,
 * so e.g. a UTC instant late on the previous day still resolves to the correct
 * IST date.
 */
export function toIstDateKey(date: string | Date): string {
  if (typeof date === "string") {
    // Trust an explicit YYYY-MM-DD calendar day; otherwise parse via Date.
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    date = new Date(date);
  }
  // Shift the UTC instant by +5:30 then read the date in UTC terms.
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Day of week for an IST calendar day. 0 = Sunday, 6 = Saturday. */
function istWeekday(dateKey: string): number {
  // Midday UTC keeps us safely inside the same IST calendar day.
  return new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
}

/** True if the IST calendar day is a Saturday or Sunday. */
export function isWeekend(date: string | Date): boolean {
  const wd = istWeekday(toIstDateKey(date));
  return wd === 0 || wd === 6;
}

/**
 * True if the given date is a listed trading holiday for `exchange`.
 * Weekends are NOT holidays here — use isTradingDay() for the combined check.
 */
export function isMarketHoliday(date: string | Date, exchange: Exchange): boolean {
  const h = HOLIDAY_BY_DATE.get(toIstDateKey(date));
  return !!h && h.exchanges.includes(exchange);
}

/**
 * True if `exchange` trades on the given date: not a weekend (for every
 * exchange) and not a listed holiday.
 */
export function isTradingDay(date: string | Date, exchange: Exchange): boolean {
  if (isWeekend(date)) return false;
  return !isMarketHoliday(date, exchange);
}

/** The holiday name for a date/exchange, or null if it is not a holiday. */
export function holidayName(date: string | Date, exchange: Exchange): string | null {
  const h = HOLIDAY_BY_DATE.get(toIstDateKey(date));
  return h && h.exchanges.includes(exchange) ? h.name : null;
}

/**
 * The next trading day strictly AFTER the given date for `exchange`, as an IST
 * calendar day key ("YYYY-MM-DD"). Skips weekends and holidays.
 */
export function nextTradingDay(date: string | Date, exchange: Exchange): string {
  let key = toIstDateKey(date);
  // Bounded loop: at most a couple of weeks of consecutive closures.
  for (let i = 0; i < 30; i++) {
    key = addOneDay(key);
    if (isTradingDay(key, exchange)) return key;
  }
  return key;
}

/** Add one calendar day to a "YYYY-MM-DD" key (IST-stable via midday UTC). */
function addOneDay(dateKey: string): string {
  const next = new Date(`${dateKey}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return toIstDateKey(next);
}

/**
 * A friendly festive greeting for a holiday, or null on a non-holiday. Uses the
 * NSE/BSE-or-MCX holiday name so it fires on any market-wide festive closure.
 *
 * @example getFestiveGreeting("2026-01-26")
 *   // "Happy Republic Day — markets are closed today 🇮🇳"
 */
export function getFestiveGreeting(date: string | Date): string | null {
  const h = HOLIDAY_BY_DATE.get(toIstDateKey(date));
  if (!h) return null;
  return `Happy ${h.name} — markets are closed today 🇮🇳`;
}
