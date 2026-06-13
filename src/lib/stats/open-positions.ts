/**
 * Open-position analytics — pure, no I/O. A trade with no close date is still
 * held: it ties up capital and ages. This module summarises the still-open
 * trades for the trader-type-adaptive dashboard (SEG-06) — how many positions
 * are open, how long each has been held (in IST calendar days) and the current
 * cost-basis exposure they represent.
 *
 * Everything here is paise-correct (exposure is qty × avg entry, kept in the
 * stored money units — no rounding), runs identically across hosted / BYOD /
 * local modes and uses NO market data: "exposure" is the *cost basis* of the
 * open positions, never a mark-to-market value (we have no live prices).
 */
import { istCalendarDaysOpen } from "./horizon";
import type { TradeLike } from "./stats";

/** The minimal shape an open-position summary needs from a trade. */
export type OpenTradeLike = TradeLike & {
  qty?: number;
  avg_entry?: number;
  product?: string | null;
};

export interface OpenPosition {
  id: string;
  symbol: string;
  segment: string;
  direction: string;
  /** IST calendar days the position has been held, as of `now`. */
  daysHeld: number;
  /** Cost-basis exposure = qty × avg entry (paise-correct, never marked). */
  exposure: number;
}

/** Is this trade still open (no realised close)? */
export function isOpen(t: { status: string; closed_at: string | null }): boolean {
  return t.status === "open" || !t.closed_at;
}

/**
 * The open positions across a trade list, longest-held-first, each with its IST
 * days-held and cost-basis exposure. `now` is injectable so the calc is
 * deterministic in tests.
 */
export function openPositions(trades: OpenTradeLike[], now: Date = new Date()): OpenPosition[] {
  return trades
    .filter(isOpen)
    .map((t) => ({
      id: t.id,
      symbol: t.symbol,
      segment: t.segment,
      direction: t.direction,
      daysHeld: istCalendarDaysOpen(t.opened_at, now),
      // Cost basis only — we never invent a current price.
      exposure: Math.abs((t.qty ?? 0) * (t.avg_entry ?? 0)),
    }))
    .sort((a, b) => b.daysHeld - a.daysHeld);
}

export interface OpenPositionsSummary {
  /** Number of still-open trades. */
  count: number;
  /** Total cost-basis exposure across the open positions (paise-correct). */
  totalExposure: number;
  /** Longest IST days-held among the open positions (0 when none). */
  maxDaysHeld: number;
  /** Average IST days-held across the open positions (0 when none). */
  avgDaysHeld: number;
  /** Open positions held over a week — the ones quietly accruing carry risk. */
  overWeek: number;
}

/** A roll-up of the open positions for the dashboard "Open positions" card. */
export function openPositionsSummary(
  trades: OpenTradeLike[],
  now: Date = new Date()
): OpenPositionsSummary {
  const open = openPositions(trades, now);
  if (open.length === 0) {
    return { count: 0, totalExposure: 0, maxDaysHeld: 0, avgDaysHeld: 0, overWeek: 0 };
  }
  const totalExposure = open.reduce((s, p) => s + p.exposure, 0);
  const totalDays = open.reduce((s, p) => s + p.daysHeld, 0);
  return {
    count: open.length,
    totalExposure,
    maxDaysHeld: open.reduce((m, p) => Math.max(m, p.daysHeld), 0),
    // Average rounded to a whole day — partial days aren't meaningful here.
    avgDaysHeld: Math.round(totalDays / open.length),
    overWeek: open.filter((p) => p.daysHeld > 7).length,
  };
}
