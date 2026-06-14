/**
 * The RUN-vs-HONEST-LOCKED seam (BT-10, item 4). Given a preset and the set of
 * trading days the currently-available DATA SOURCE actually has, decide whether
 * the preset can RUN today or must show the honest "unlocks when the dataset
 * goes live" state — NEVER a fabricated result.
 *
 * THIS IS THE BT-08 SEAM. Today the only committed data source is the golden
 * NIFTY 2024-07-24..25 slice (loaded by `loadGoldenSnapshot`). When BT-08 swaps
 * the engine's DataSource to the HF-backed source, the ONLY change is the set of
 * `(symbol, day)` pairs passed into `decidePresetRun` — every preset that was
 * "locked" flips to "run" with ZERO preset-code change, because runnability is
 * computed from data availability, not hard-coded per preset.
 *
 * Pure + framework-free so the decision is unit-tested directly.
 */

import type { IndexSymbol } from "../shared/instruments";
import type { Preset, PresetMeta } from "./types";

/** The data the available source can serve, expressed as available trading days. */
export interface LocalDataAvailability {
  /** Per-symbol set of YYYY-MM-DD trading days the source has option data for. */
  daysBySymbol: Partial<Record<IndexSymbol, ReadonlySet<string>>>;
}

export type PresetRunDecision =
  | {
      kind: "run";
      /** The subset of the preset's window the source can actually serve. */
      availableDays: string[];
      /** True when only PART of the requested window has data (honest partial). */
      partial: boolean;
    }
  | {
      kind: "locked";
      /** Honest, descriptive reason — NEVER implies a result exists. */
      reason: string;
    };

/** Build a {@link LocalDataAvailability} from a list of (symbol, days) entries. */
export function availabilityFrom(
  entries: { symbol: IndexSymbol; days: readonly string[] }[]
): LocalDataAvailability {
  const daysBySymbol: Partial<Record<IndexSymbol, Set<string>>> = {};
  for (const { symbol, days } of entries) {
    const set = (daysBySymbol[symbol] ??= new Set<string>());
    for (const d of days) set.add(d);
  }
  return { daysBySymbol };
}

/**
 * Days within [start, end] (inclusive, ISO string compare) that the source has.
 * The preset's `coverageExpiries` are the WEEKS it touches; the engine resolves
 * exact trading days, so here we simply intersect the source's available days
 * with the preset's date window — which is exactly the range the StrategyDef
 * carries (spanOf(coverageExpiries)).
 */
function availableDaysInWindow(
  avail: LocalDataAvailability,
  symbol: IndexSymbol,
  start: string,
  end: string
): string[] {
  const set = avail.daysBySymbol[symbol];
  if (!set || set.size === 0) return [];
  const out: string[] = [];
  for (const d of set) {
    if (d >= start && d <= end) out.push(d);
  }
  return out.sort();
}

/**
 * Decide whether a preset can RUN against the available data, or is honestly
 * LOCKED. The window is the preset StrategyDef's date range — derived from its
 * `coverageExpiries` so this never needs to read the StrategyDef.
 */
export function decidePresetRun(
  preset: Preset | PresetMeta,
  avail: LocalDataAvailability
): PresetRunDecision {
  const meta: PresetMeta = "meta" in preset ? preset.meta : preset;
  const sorted = [...meta.coverageExpiries].sort();
  const start = sorted[0] ?? "";
  const end = sorted[sorted.length - 1] ?? "";

  const days = availableDaysInWindow(avail, meta.index, start, end);
  if (days.length === 0) {
    return {
      kind: "locked",
      reason:
        "Full historical results unlock when the market dataset goes live. This educational example is run-ready — the same definition will execute unchanged once the data layer is connected.",
    };
  }

  // The preset's window may be longer than the days the source can serve today.
  // We can only know whether it's "partial" relative to the requested span: if
  // the source has at least one day inside the window it runs; partial is true
  // unless the source spans the whole window (we treat a single committed slice
  // as partial, since the window covers many weeks).
  const partial = days.length < expectedTradingDaysApprox(start, end);
  return { kind: "run", availableDays: days, partial };
}

/** A coarse expected-trading-day count for a window (≈ 5/7 of calendar days). */
function expectedTradingDaysApprox(start: string, end: string): number {
  if (!start || !end) return 1;
  const ms = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(ms) || ms < 0) return 1;
  const calendarDays = Math.round(ms / 86_400_000) + 1;
  return Math.max(1, Math.round((calendarDays * 5) / 7));
}

/** True if a preset can run on the given availability (convenience). */
export function isPresetRunnable(
  preset: Preset | PresetMeta,
  avail: LocalDataAvailability
): boolean {
  return decidePresetRun(preset, avail).kind === "run";
}
