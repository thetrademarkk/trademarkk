/**
 * The 6 headline stat cards in the R24 LEAD ORDER:
 *   1. Net P&L  2. Win %  3. Max Drawdown  4. Expectancy  5. Profit Factor  6. Sharpe
 *
 * This module is pure: it maps a RunResult's HeadlineStats into display rows
 * (formatted value, sub-line, semantic tone, and the derivation key used by the
 * tap-to-derive panel), and computes per-stat DELTAS against a previous run for
 * the "change one thing" iteration loop.
 *
 * Tone is semantic only ("profit" | "loss" | "neutral"); the UI maps that to the
 * profit/loss/muted tokens. No raw colours, no evaluation.
 */

import { formatINR } from "@/lib/utils";
import type { HeadlineStats, RunResult } from "@/features/backtest/shared/run-result";

/** Stable identifiers for the 6 cards, in lead order. Drives tap-to-derive. */
export type StatKey =
  | "netPnl"
  | "winRate"
  | "maxDrawdown"
  | "expectancy"
  | "profitFactor"
  | "sharpe";

export const STAT_ORDER: readonly StatKey[] = [
  "netPnl",
  "winRate",
  "maxDrawdown",
  "expectancy",
  "profitFactor",
  "sharpe",
] as const;

export interface StatCardView {
  key: StatKey;
  label: string;
  value: string;
  /** Optional small sub-line (e.g. "262 / 412"). */
  sub?: string;
  tone: "profit" | "loss" | "neutral";
  /** True when tapping reveals a derivation panel (Net P&L always does). */
  derivable: boolean;
}

const pf = (n: number) => (n >= 9999 ? "∞" : n.toFixed(2));

/** Build the 6 stat cards from a run's headline stats (in lead order). */
export function buildStatCards(run: RunResult): StatCardView[] {
  const s: HeadlineStats = run.stats;
  const wins = run.blotter.filter((b) => b.legs.length > 0 && b.net > 0).length;
  const traded = run.blotter.filter((b) => b.legs.length > 0).length;
  return [
    {
      key: "netPnl",
      label: "Net P&L",
      value: formatINR(s.netPnl, { signed: true, decimals: true }),
      tone: s.netPnl > 0 ? "profit" : s.netPnl < 0 ? "loss" : "neutral",
      derivable: true,
    },
    {
      key: "winRate",
      label: "Win %",
      value: `${(s.winRate * 100).toFixed(1)}%`,
      sub: traded > 0 ? `${wins} / ${traded}` : undefined,
      tone: "neutral",
      derivable: false,
    },
    {
      key: "maxDrawdown",
      label: "Max drawdown",
      value: formatINR(s.maxDrawdown, { decimals: true }),
      tone: s.maxDrawdown < 0 ? "loss" : "neutral",
      derivable: false,
    },
    {
      key: "expectancy",
      label: "Expectancy",
      value: `${formatINR(s.expectancy, { signed: true, decimals: true })}/day`,
      tone: s.expectancy > 0 ? "profit" : s.expectancy < 0 ? "loss" : "neutral",
      derivable: false,
    },
    {
      key: "profitFactor",
      label: "Profit factor",
      value: pf(s.profitFactor),
      tone: "neutral",
      derivable: false,
    },
    {
      key: "sharpe",
      label: "Sharpe",
      value: s.sharpe.toFixed(2),
      tone: "neutral",
      derivable: false,
    },
  ];
}

export interface StatDelta {
  key: StatKey;
  /** Raw numeric change (current − previous), in the stat's native unit. */
  diff: number;
  /** Formatted, signed delta string for display (e.g. "+₹240.00", "+1.2%"). */
  display: string;
  /**
   * "up" when the value rose, "down" when it fell, "flat" when unchanged. This
   * is purely directional — NOT "better/worse" (a bigger drawdown is "up" in
   * magnitude terms but the UI decides how to tint it). Drawdown is reported as
   * a negative number, so a deeper drawdown is a more-negative diff.
   */
  direction: "up" | "down" | "flat";
}

const EPS = 1e-9;

function fmtDelta(key: StatKey, diff: number): string {
  switch (key) {
    case "netPnl":
    case "maxDrawdown":
    case "expectancy":
      return formatINR(diff, { signed: true, decimals: true });
    case "winRate":
      return `${diff >= 0 ? "+" : "-"}${Math.abs(diff * 100).toFixed(1)}%`;
    case "profitFactor":
    case "sharpe":
      return `${diff >= 0 ? "+" : "-"}${Math.abs(diff).toFixed(2)}`;
  }
}

/**
 * Per-stat deltas of the current run vs a previous run. Used by the iteration
 * loop ("change one thing") to ghost the prior run and show how each headline
 * moved. Pure: maps two HeadlineStats into 6 directional deltas in lead order.
 */
export function computeStatDeltas(current: HeadlineStats, previous: HeadlineStats): StatDelta[] {
  const diffOf = (key: StatKey): number => {
    switch (key) {
      case "netPnl":
        return round2(current.netPnl - previous.netPnl);
      case "winRate":
        return round4(current.winRate - previous.winRate);
      case "maxDrawdown":
        return round2(current.maxDrawdown - previous.maxDrawdown);
      case "expectancy":
        return round2(current.expectancy - previous.expectancy);
      case "profitFactor":
        return round4(current.profitFactor - previous.profitFactor);
      case "sharpe":
        return round4(current.sharpe - previous.sharpe);
    }
  };
  return STAT_ORDER.map((key) => {
    const diff = diffOf(key);
    const direction = diff > EPS ? "up" : diff < -EPS ? "down" : "flat";
    return { key, diff, display: fmtDelta(key, diff), direction };
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** The lightweight snapshot held for the iteration delta loop (prev run). */
export interface PrevRunSnapshot {
  runId: string;
  name: string;
  ranAt: number;
  stats: HeadlineStats;
}

export function toPrevRunSnapshot(run: RunResult): PrevRunSnapshot {
  return { runId: run.runId, name: run.config.name, ranAt: run.ranAt, stats: run.stats };
}
