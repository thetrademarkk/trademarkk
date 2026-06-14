"use client";

import * as React from "react";
import { useBacktest, type UseBacktest } from "@/features/backtest/hooks/use-backtest";

/**
 * BacktestRunnerProvider — owns the single `useBacktest` instance for the whole
 * backtesting universe and exposes it via context. Mounted in the backtesting
 * LAYOUT (src/app/backtesting/layout.tsx) so the worker it owns is NOT unmounted
 * when the user navigates between /backtesting/build and the results view — an
 * in-flight run keeps going. This mirrors the level at which the monte-carlo
 * worker lives relative to its consuming screens (owned above the screens that
 * read it, not inside one of them).
 *
 * Any client component under the layout calls `useBacktestRunner()` to read the
 * shared status/result/progress and to `run()` / `cancel()`.
 */
const BacktestRunnerContext = React.createContext<UseBacktest | null>(null);

export function BacktestRunnerProvider({ children }: { children: React.ReactNode }) {
  const runner = useBacktest();
  return <BacktestRunnerContext.Provider value={runner}>{children}</BacktestRunnerContext.Provider>;
}

/** Read the layout-owned backtest runner. Throws if used outside the provider. */
export function useBacktestRunner(): UseBacktest {
  const ctx = React.useContext(BacktestRunnerContext);
  if (!ctx) {
    throw new Error("useBacktestRunner must be used within a BacktestRunnerProvider");
  }
  return ctx;
}
