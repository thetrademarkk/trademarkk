/**
 * Backtest market calendar — pure, data-driven, IST-based (Asia/Kolkata,
 * UTC+5:30, no DST). Modelled on the engine-semantics spec §9: holiday tables
 * and dated expiry rules ship in the bundle; NO external API at runtime.
 *
 * This is SEPARATE from src/lib/market-calendar.ts (which is a 2026-only
 * NSE/BSE/MCX holiday table powering the journal UI's festive greeting + the
 * journal calendar heatmap). The backtester needs a much wider, dated surface —
 * 2021–2027 holidays, per-index data-start gating, and date-aware weekly/monthly
 * expiry resolution with holiday roll-back — so it lives under src/lib/backtest.
 *
 * All functions are PURE and accept an explicit "YYYY-MM-DD" IST calendar day,
 * so unit tests are deterministic. A wrong expiry weekday silently corrupts
 * every weekly backtest, so expiry resolution is golden-tested against >=20
 * known historical expiry dates (market-calendar.test.ts).
 */

import type { IndexSymbol } from "../../../features/backtest/shared/instruments";
import { ALL_HOLIDAYS, DATA_START } from "./calendar.data";
import { expiryRuleFor, type Weekday } from "./expiry-rules";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Session bounds as minute-of-day (09:15 open … 15:30 close). */
export const SESSION = { openMin: 555, closeMin: 930 } as const;

function assertDayKey(day: string): void {
  if (!DATE_RE.test(day)) {
    throw new Error(`calendar: expected "YYYY-MM-DD" IST day, got "${day}"`);
  }
}

/**
 * JS weekday (Sun=0 … Sat=6) for an IST calendar day. Anchored at midday UTC,
 * which is always inside the same IST calendar day, so it is DST/timezone-safe.
 */
export function weekdayOf(day: string): Weekday {
  assertDayKey(day);
  return new Date(`${day}T12:00:00.000Z`).getUTCDay() as Weekday;
}

/** Saturday or Sunday. */
export function isWeekend(day: string): boolean {
  const wd = weekdayOf(day);
  return wd === 0 || wd === 6;
}

/** A listed full-day NSE/BSE holiday (weekends excluded — use isTradingDay). */
export function isHoliday(day: string): boolean {
  assertDayKey(day);
  return ALL_HOLIDAYS.has(day);
}

/**
 * True if NSE/BSE trade on this IST day for `index`: not before the per-index
 * data start, not a weekend, and not a listed holiday.
 */
export function isTradingDay(day: string, index: IndexSymbol): boolean {
  assertDayKey(day);
  if (day < DATA_START[index]) return false;
  if (isWeekend(day)) return false;
  return !isHoliday(day);
}

/** Add `n` calendar days to a day key (IST-stable via midday UTC). */
export function addDays(day: string, n: number): string {
  assertDayKey(day);
  const d = new Date(`${day}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The previous trading day strictly before `day` (skips weekends + holidays). */
export function prevTradingDay(day: string, index: IndexSymbol): string {
  let cur = day;
  for (let i = 0; i < 30; i++) {
    cur = addDays(cur, -1);
    if (isTradingDay(cur, index)) return cur;
  }
  return cur;
}

/** The next trading day strictly after `day` (skips weekends + holidays). */
export function nextTradingDay(day: string, index: IndexSymbol): string {
  let cur = day;
  for (let i = 0; i < 30; i++) {
    cur = addDays(cur, 1);
    if (isTradingDay(cur, index)) return cur;
  }
  return cur;
}

/**
 * Every trading day in [from, to] inclusive for `index`, ascending. This is the
 * engine's iteration spine. Bounded to avoid pathological ranges.
 */
export function tradingDays(from: string, to: string, index: IndexSymbol): string[] {
  assertDayKey(from);
  assertDayKey(to);
  const out: string[] = [];
  let cur = from;
  // Cap at ~8 calendar years of days; the engine also caps trading days.
  for (let i = 0; i < 3000 && cur <= to; i++) {
    if (isTradingDay(cur, index)) out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/**
 * Roll a candidate expiry day back to the previous trading day if it lands on a
 * weekend/holiday — the NSE/BSE convention (expiry moves to the prior session).
 */
export function rollBackToTradingDay(day: string, index: IndexSymbol): string {
  let cur = day;
  for (let i = 0; i < 30; i++) {
    if (isTradingDay(cur, index)) return cur;
    cur = addDays(cur, -1);
  }
  return cur;
}

/** The first day with weekday `wd` that is >= `day`. */
function onOrAfterWeekday(day: string, wd: Weekday): string {
  let cur = day;
  for (let i = 0; i < 7; i++) {
    if (weekdayOf(cur) === wd) return cur;
    cur = addDays(cur, 1);
  }
  return cur;
}

/** Last day of the month (calendar) for the month containing `day`. */
function lastOfMonth(day: string): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  // Day 0 of next month = last day of this month.
  const d = new Date(Date.UTC(y, m, 0, 12, 0, 0));
  return d.toISOString().slice(0, 10);
}

/**
 * The WEEKLY expiry day for the week containing `day` (the rule weekday in that
 * week), rolled back over holidays. Uses the dated rule window so the 2024–25
 * weekday churn resolves correctly.
 */
export function weeklyExpiryOnOrAfter(index: IndexSymbol, day: string): string {
  const rule = expiryRuleFor(index, day);
  const raw = onOrAfterWeekday(day, rule.weekday);
  return rollBackToTradingDay(raw, index);
}

/**
 * The MONTHLY expiry day for the month containing `day`: the LAST occurrence of
 * the rule's monthly weekday in that calendar month, rolled back over holidays.
 */
export function monthlyExpiry(index: IndexSymbol, day: string): string {
  const rule = expiryRuleFor(index, day);
  const eom = lastOfMonth(day);
  // Walk back from end-of-month to the last matching weekday.
  let cur = eom;
  for (let i = 0; i < 7; i++) {
    if (weekdayOf(cur) === rule.monthlyWeekday) break;
    cur = addDays(cur, -1);
  }
  return rollBackToTradingDay(cur, index);
}

export type ExpiryKind = "WEEKLY" | "NEXT_WEEKLY" | "MONTHLY";

/**
 * Resolve the contract expiry to trade for trading day `day`.
 *  - WEEKLY      → nearest weekly expiry on or after `day` (the current week's;
 *                  if the index has no weekly in this window, the monthly).
 *  - NEXT_WEEKLY → the weekly after the nearest one.
 *  - MONTHLY     → the monthly expiry of the month containing `day` (rolls to
 *                  the next month's monthly once this month's has passed).
 * All results are rolled back over holidays. Honours the dated weekday rules and
 * the BANKNIFTY weekly discontinuation (weeklyAvailable === false → monthly).
 */
export function expiryFor(index: IndexSymbol, day: string, kind: ExpiryKind): string {
  assertDayKey(day);
  const rule = expiryRuleFor(index, day);

  if (kind === "MONTHLY" || !rule.weeklyAvailable) {
    let m = monthlyExpiry(index, day);
    // If this month's monthly already passed, roll to next month's.
    if (m < day) m = monthlyExpiry(index, addDays(lastOfMonth(day), 1));
    return m;
  }

  let weekly = weeklyExpiryOnOrAfter(index, day);
  // If the current week's expiry already passed (e.g. day is the Friday after a
  // Thursday expiry that rolled), advance to next week.
  if (weekly < day) weekly = weeklyExpiryOnOrAfter(index, nextTradingDay(weekly, index));

  if (kind === "NEXT_WEEKLY") {
    // Jump one week forward from the resolved weekly, then resolve again.
    return weeklyExpiryOnOrAfter(index, addDays(weekly, 1));
  }
  return weekly;
}

/**
 * Count of TRADING days from `day` (inclusive of `day` as day 0) up to and
 * including the resolved expiry — for the `daysFromExpiry` entry filter. 0 means
 * `day` IS the expiry day. Returns -1 if expiry is before `day` (shouldn't
 * happen for WEEKLY/MONTHLY but guarded).
 */
export function tradingDaysToExpiry(index: IndexSymbol, day: string, kind: ExpiryKind): number {
  const expiry = expiryFor(index, day, kind);
  if (expiry < day) return -1;
  if (expiry === day) return 0;
  let count = 0;
  let cur = day;
  for (let i = 0; i < 60 && cur < expiry; i++) {
    cur = nextTradingDay(cur, index);
    count++;
  }
  return count;
}
