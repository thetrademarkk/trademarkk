"use client";

import type { RunResult } from "@/features/backtest/shared/run-result";
import { RunResultReport } from "@/components/backtesting/results/run-result-report";

/**
 * Client wrapper for the immutable shared run. Renders the SAME read-only report
 * the owner sees (coverage chips → neutral verdict → 6 stats → equity/underwater
 * → evidence tabs → blotter). No iteration toolbar, no Save/Share bar, no
 * benchmark overlay (the fixture isn't shipped to a public viewer) — a shared
 * run is purely read-only. `prevStats` is omitted so no per-stat deltas show.
 */
export function SharedRunView({ result }: { result: RunResult }) {
  return <RunResultReport result={result} />;
}
