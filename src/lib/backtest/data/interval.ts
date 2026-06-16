/**
 * interval.ts — the arbitrary-timeframe token parser that GATES the resampler
 * (docs/backtesting/13-strike-and-timeframe-ux.md §"Timeframe" and
 * 07-data-layer §2). The builder lets a user type ANY minute interval
 * (2, 3, 7, 11, 13, 17, 30, …), or an hour token (1h..Nh = N·60m), or 1d / 1w.
 *
 * This module is PURE and dependency-free: it turns a free-form token into a
 * normalized {minutes, label, valid, …} descriptor. It NEVER resamples — that
 * is resample.ts — but it decides which tokens are even offerable and whether a
 * minute interval divides the 375-minute IST session evenly (a clean divisor)
 * or leaves a ragged trailing candle (warn-but-allow, per §13 step 3).
 *
 * Session reference (06-engine-semantics §1.1): the regular session is
 * 09:15–15:30 IST = 375 one-minute bars. "1d" collapses a whole session into a
 * single bar, so 1d == 375 minutes. "1w" is a 5-trading-day roll-up; it has no
 * single fixed minute count, so it is modelled as a distinct `unit:"week"` token
 * the resampler groups by ISO-week rather than by a minute bucket.
 */

/** Minutes in one regular IST session (09:15–15:30 inclusive at 1m). */
export const SESSION_MINUTES = 375;

/** Minimum offerable interval (minutes). Sub-1m is rejected — data is 1m. */
export const MIN_INTERVAL_MIN = 1;

/** Maximum offerable interval expressed in minutes (1d == one session). */
export const MAX_INTERVAL_MIN = SESSION_MINUTES;

/** The grouping unit a parsed interval rolls up by. */
export type IntervalUnit = "minute" | "day" | "week";

/**
 * A normalized, fully-described interval token. `valid:false` carries a
 * `reason` so the UI can show an inline error instead of silently degrading.
 */
export interface ParsedInterval {
  /** True when the token is a legal, offerable interval. */
  valid: boolean;
  /**
   * Bucket size in MINUTES for minute/day units (1d → 375). For `unit:"week"`
   * this is null — a week has no fixed minute count (holidays shorten it).
   */
  minutes: number | null;
  /** The roll-up grouping unit. */
  unit: IntervalUnit;
  /** Canonical short label for chips/state, e.g. "1m", "7m", "1h", "1d", "1w". */
  label: string;
  /**
   * True only for minute intervals that divide the 375-min session evenly
   * (1,3,5,15,25,75,125,375,…). Non-divisors (2,7,11,…) leave a ragged final
   * candle — still allowed, but the UI warns. Always false for day/week.
   */
  dividesSession: boolean;
  /** Set only when `valid:false`. */
  reason?: string;
  /** Set when valid:true but a ragged trailing bucket will occur (non-divisor). */
  warning?: string;
}

const RAGGED_WARNING =
  "This interval does not divide the trading session evenly — the last candle of " +
  "each day will be shorter. Entries/exits snap to your candle; stop-loss & target " +
  "are always checked at 1-minute precision.";

function invalid(label: string, reason: string): ParsedInterval {
  return { valid: false, minutes: null, unit: "minute", label, dividesSession: false, reason };
}

/** True when `min` divides the 375-minute session with no remainder. */
export function dividesSession(min: number): boolean {
  return Number.isInteger(min) && min > 0 && SESSION_MINUTES % min === 0;
}

/**
 * Parse a free-form interval token into a normalized descriptor.
 *
 * Accepted forms (case-insensitive, surrounding whitespace ignored):
 *   - "<N>m"  / "<N>"   minute interval, N a positive integer (1..375)
 *   - "<N>h"            hour interval = N·60 minutes (must stay ≤ 375 → N ≤ 6)
 *   - "1d" / "d"        one whole session (375 minutes)
 *   - "1w" / "w"        one trading week (unit:"week", grouped by ISO week)
 *
 * Rejected:
 *   - sub-1m (0, fractional, negative)
 *   - non-integer minute/hour counts (e.g. "2.5m")
 *   - intervals coarser than 1d in minute/hour form (e.g. "400m", "7h")
 *   - "Nd"/"Nw" with N≠1 (a multi-day candle is not a v1 concept)
 *   - garbage / empty
 *
 * Non-session-divisor minute intervals (2, 7, 11, 13, 17, 30, …) are VALID but
 * carry a `warning` (ragged trailing candle), per §13.
 */
export function parseInterval(token: string): ParsedInterval {
  if (typeof token !== "string") return invalid(String(token), "Interval must be a string token.");
  const raw = token.trim().toLowerCase();
  if (raw === "") return invalid(token, "Enter an interval (e.g. 5m, 1h, 1d).");

  // Match: optional integer count + optional unit suffix. We deliberately do
  // NOT accept decimals, signs, or extra characters.
  const m = /^(\d+)?(m|min|h|hr|hour|d|day|w|wk|week)?$/.exec(raw);
  if (!m) return invalid(token, `Unrecognised interval "${token}".`);

  const countStr = m[1];
  let suffix = m[2] ?? "";

  // Normalise multi-letter suffixes to a single canonical letter.
  if (suffix === "min") suffix = "m";
  else if (suffix === "hr" || suffix === "hour") suffix = "h";
  else if (suffix === "day") suffix = "d";
  else if (suffix === "wk" || suffix === "week") suffix = "w";

  // Bare number with no suffix → minutes (the AlgoTest-style default).
  if (countStr !== undefined && suffix === "") suffix = "m";

  // ── Week ────────────────────────────────────────────────────────────────
  if (suffix === "w") {
    const n = countStr === undefined ? 1 : Number(countStr);
    if (n !== 1) return invalid(token, "Only 1w is supported (one trading week).");
    return { valid: true, minutes: null, unit: "week", label: "1w", dividesSession: false };
  }

  // ── Day ─────────────────────────────────────────────────────────────────
  if (suffix === "d") {
    const n = countStr === undefined ? 1 : Number(countStr);
    if (n !== 1) return invalid(token, "Only 1d is supported (one trading session).");
    return {
      valid: true,
      minutes: SESSION_MINUTES,
      unit: "day",
      label: "1d",
      dividesSession: false, // a whole session is the bucket; ragged logic N/A
    };
  }

  // From here a numeric count is required (m / h).
  if (countStr === undefined) {
    return invalid(token, `Interval "${token}" needs a number (e.g. 5m, 1h).`);
  }
  const n = Number(countStr);
  if (!Number.isInteger(n) || n <= 0) {
    return invalid(token, "Interval must be a whole number ≥ 1.");
  }

  // ── Hour ──────────────────────────────────────────────────────────────────
  if (suffix === "h") {
    const minutes = n * 60;
    if (minutes > MAX_INTERVAL_MIN) {
      return invalid(token, "Interval cannot exceed 1d (the session is 6h 15m).");
    }
    const divides = dividesSession(minutes);
    return {
      valid: true,
      minutes,
      unit: "minute",
      label: `${n}h`,
      dividesSession: divides,
      ...(divides ? {} : { warning: RAGGED_WARNING }),
    };
  }

  // ── Minute ────────────────────────────────────────────────────────────────
  // suffix === "m"
  if (n < MIN_INTERVAL_MIN) return invalid(token, "Interval cannot be smaller than 1m.");
  if (n > MAX_INTERVAL_MIN) {
    return invalid(token, "Interval cannot exceed 1d (375 one-minute bars).");
  }
  const divides = dividesSession(n);
  return {
    valid: true,
    minutes: n,
    unit: "minute",
    label: `${n}m`,
    dividesSession: divides,
    ...(divides ? {} : { warning: RAGGED_WARNING }),
  };
}

/** Convenience guard: is this token a legal, offerable interval? */
export function isParsableInterval(token: string): boolean {
  return parseInterval(token).valid;
}
