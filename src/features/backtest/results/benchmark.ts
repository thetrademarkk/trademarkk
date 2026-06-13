/**
 * Default NIFTY (index) BUY-&-HOLD benchmark for the hero chart overlay.
 *
 * The honest framing: a backtest's equity is in RUPEES of strategy P&L, so the
 * benchmark must be comparable. We take the run's own index spot over the same
 * days (from the fixture snapshot the run executed against — the same source the
 * engine read, no new data), buy 1 unit of the index at the FIRST day's first
 * bar, and mark it to each subsequent day's last bar. The benchmark series is
 * "index points gained per unit held", scaled by the strategy's total
 * contracts so both lines live on a comparable rupee axis.
 *
 * Pure & deterministic. Returns null when there is no usable index data (so the
 * overlay is simply hidden rather than faked).
 */

import type { FixtureSnapshot } from "@/lib/backtest/engine/adapters/fixture-source";
import type { RunResult } from "@/features/backtest/shared/run-result";

export interface BenchmarkPoint {
  ts: number;
  /** Buy-&-hold P&L in rupees (index move × held contracts), from 0 at entry. */
  value: number;
}

function dayKey(ts: number): string {
  return new Date(ts + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/**
 * Build the buy-&-hold benchmark aligned to the run's equity-curve days. The hold
 * size = the strategy's total long-equivalent contracts on day one (Σ lots ×
 * lot size over enabled legs) so the benchmark is on the same notional footing.
 */
export function buildBenchmark(run: RunResult, snapshot: FixtureSnapshot): BenchmarkPoint[] | null {
  if (snapshot.symbol !== run.config.market.symbol) return null;
  const days = [...snapshot.days].sort((a, b) => a.day.localeCompare(b.day));
  if (days.length === 0) return null;

  const firstWithIndex = days.find((d) => d.index.length > 0);
  if (!firstWithIndex) return null;
  const entryPrice = firstWithIndex.index[0]!.o;

  // Held units: one index unit per enabled lot — a plain long-exposure benchmark
  // on the same notional footing as the strategy (we never short the benchmark).
  const held = Math.max(
    1,
    run.config.legs.filter((l) => l.enabled).reduce((s, l) => s + l.lots, 0)
  );

  // Map the run's equity-curve day keys → that day's last index close.
  const closeByDay = new Map<string, number>();
  for (const d of days) {
    if (d.index.length > 0) closeByDay.set(d.day, d.index[d.index.length - 1]!.c);
  }

  const out: BenchmarkPoint[] = [];
  for (const pt of run.equityCurve) {
    const dk = dayKey(pt.ts);
    const close = closeByDay.get(dk);
    if (close === undefined) continue;
    out.push({ ts: pt.ts, value: Math.round((close - entryPrice) * held * 100) / 100 });
  }
  return out.length >= 2 ? out : null;
}
