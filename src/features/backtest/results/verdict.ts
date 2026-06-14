/**
 * The NEUTRAL verdict headline (D10) — a DESCRIPTIVE template string, never an
 * LLM call and never evaluative. It states what happened ("Net P&L ₹X across N
 * trades over the period at Y% coverage"), it never judges whether the strategy
 * is "good" or "bad". This is the trust posture: we report, the user decides.
 *
 * Pure & deterministic: given a RunResult it returns the exact same string every
 * time, so it is unit-testable to the character (R24 / D10).
 *
 * Money is rupees (paise-correct via formatINR). Coverage is a 0..1 fraction
 * surfaced as a whole percent.
 */

import { formatINR } from "@/lib/utils";
import type { RunResult } from "@/features/backtest/shared/run-result";

/** A human date span "02 Jan 2024 – 31 May 2026" from the config date range. */
export function formatSpan(start: string, end: string): string {
  const fmt = (d: string) =>
    new Date(d + "T12:00:00").toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}

/**
 * The neutral, descriptive verdict sentence. It is built ONLY from facts already
 * in the RunResult — never an opinion. Structure:
 *
 *   "Net P&L {±₹X} across {N} trade-days from {span}, at {Y}% data coverage."
 *
 * When the sample is below the meaningful threshold we PREPEND a neutral caveat
 * (still descriptive, not a verdict): "Small sample ({N} trade-days). " — so the
 * reader weights it accordingly. We never say "good", "bad", "profitable
 * strategy", etc.
 */
export function buildVerdictHeadline(run: RunResult): string {
  const trades = run.blotter.length;
  const pnl = formatINR(run.stats.netPnl, { signed: true, decimals: true });
  const span = formatSpan(run.config.market.dateRange.start, run.config.market.dateRange.end);
  const covPct = Math.round(run.coverage.overall * 100);
  const tradeWord = trades === 1 ? "trade-day" : "trade-days";

  const core = `Net P&L ${pnl} across ${trades} ${tradeWord} from ${span}, at ${covPct}% data coverage.`;

  if (trades < 30) {
    return `Small sample (${trades} ${tradeWord}). ${core}`;
  }
  return core;
}

/**
 * A second, optional descriptive line that names the honesty caveats already in
 * the coverage layer. Still neutral — it states counts, never judgement. Returns
 * null when nothing needs flagging (coverage full, no substitutions/exclusions).
 */
export function buildCoverageCaveat(run: RunResult): string | null {
  const c = run.coverage;
  const parts: string[] = [];
  if (c.substitutions > 0) {
    parts.push(`${c.substitutions} day${c.substitutions === 1 ? "" : "s"} used a nearer strike`);
  }
  if (c.illiquidDays > 0) {
    parts.push(`${c.illiquidDays} low-liquidity day${c.illiquidDays === 1 ? "" : "s"}`);
  }
  if (c.excludedDays > 0) {
    parts.push(`${c.excludedDays} day${c.excludedDays === 1 ? "" : "s"} skipped for missing data`);
  }
  if (parts.length === 0) return null;
  return `Includes ${parts.join(", ")}.`;
}
