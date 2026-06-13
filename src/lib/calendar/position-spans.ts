/**
 * Position-hold calendar spans — pure, no I/O (SEG-06).
 *
 * The month heatmap colours days by *realised* P&L, which it keys on the close
 * date. That misrepresents a multi-day position: a swing/positional trade ties
 * up capital across several days but only shows up on the day it closed. This
 * module maps each trade to the calendar days it was *held* across, so the
 * heatmap can draw a hold indicator on every day a position was live — while
 * P&L stays exactly where it was (the close day), so nothing is double-counted.
 *
 * Days are keyed by IST calendar date (YYYY-MM-DD), matching the holding-horizon
 * classifier — the timezone Indian brokers settle on. A still-open trade spans
 * from its open day through `now`. Intraday trades occupy a single day and are
 * deliberately NOT counted as spans (there is nothing multi-day to indicate).
 *
 * No market data, no money math here — this is purely a visual hold indicator;
 * the existing dailyPnl map remains the single source of truth for P&L.
 */
import { istDateKey } from "@/lib/tax/fy";
import { classifyHorizon, type HorizonTradeLike } from "@/lib/stats/horizon";

/** Add `n` days to a YYYY-MM-DD key, returning a new YYYY-MM-DD key (UTC-safe). */
function addDays(dateKey: string, n: number): string {
  const t = Date.parse(`${dateKey}T00:00:00Z`);
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

/** Inclusive list of YYYY-MM-DD keys from `start` to `end` (clamped, capped). */
function dateRange(start: string, end: string): string[] {
  if (end < start) return [start];
  const out: string[] = [];
  let cur = start;
  // Guard against a pathological range blowing up the grid (e.g. a bad import
  // with a decades-apart open/close). A held position rarely spans >2 years.
  for (let i = 0; i < 800 && cur <= end; i++) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export interface DayCoverage {
  /** Closed multi-day positions whose hold span covers this day. */
  held: number;
  /** Still-open positions whose hold span (open → now) covers this day. */
  open: number;
}

/**
 * Per-IST-day coverage of multi-day holding spans.
 *
 * Rules:
 *  - intraday trades (same IST day, or product MIS) are skipped — single-day,
 *    nothing to span;
 *  - a closed swing/positional trade marks every IST day from its open day
 *    through its close day inclusive as `held`;
 *  - a still-open trade marks every IST day from its open day through `now`
 *    inclusive as `open` (it's quietly carrying risk right now);
 *  - P&L is untouched — coverage is a visual hold indicator only.
 *
 * Returns a Map keyed by YYYY-MM-DD; days with no coverage are absent.
 */
export function spanCoverage(
  trades: HorizonTradeLike[],
  now: Date = new Date()
): Map<string, DayCoverage> {
  const map = new Map<string, DayCoverage>();
  const bump = (key: string, kind: "held" | "open") => {
    const cur = map.get(key) ?? { held: 0, open: 0 };
    cur[kind] += 1;
    map.set(key, cur);
  };
  const nowKey = istDateKey(now.toISOString());

  for (const t of trades) {
    const openKey = istDateKey(t.opened_at);

    if (!t.closed_at || t.status === "open") {
      // Open position: a hold span from its open day through today.
      const end = nowKey >= openKey ? nowKey : openKey;
      for (const k of dateRange(openKey, end)) bump(k, "open");
      continue;
    }

    // Closed trade: only multi-day (swing/positional) holds get a span. An
    // intraday round-trip is a single day — no span to draw.
    const horizon = classifyHorizon(t);
    if (horizon === "intraday" || horizon == null) continue;
    const closeKey = istDateKey(t.closed_at);
    if (closeKey === openKey) continue; // defensive — multi-day implies distinct days
    for (const k of dateRange(openKey, closeKey)) bump(k, "held");
  }

  return map;
}

export interface SpanMonthSummary {
  /** Distinct days in the month touched by a closed multi-day hold span. */
  heldDays: number;
  /** Distinct days in the month touched by a still-open position. */
  openDays: number;
}

/**
 * Roll coverage up to a single month (0-based `month`) for a heatmap caption.
 * Counts distinct days within the month carrying each kind of span.
 */
export function spanMonthSummary(
  coverage: Map<string, DayCoverage>,
  year: number,
  month: number
): SpanMonthSummary {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  let heldDays = 0;
  let openDays = 0;
  for (const [key, cov] of coverage) {
    if (!key.startsWith(prefix)) continue;
    if (cov.held > 0) heldDays++;
    if (cov.open > 0) openDays++;
  }
  return { heldDays, openDays };
}
