"use client";

import * as React from "react";
import {
  AlertTriangle,
  FlaskConical,
  Loader2,
  Pencil,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { RunResult } from "@/features/backtest/shared/run-result";
import type { StrategyDef } from "@/features/backtest/shared/strategy-def";
import { STATUS_LABEL, type BacktestStatus } from "@/features/backtest/shared/backtest-status";
import type { BacktestProgress } from "@/features/backtest/hooks/use-backtest";
import { usePrevRunStore } from "@/features/backtest/results/prev-run-store";
import { toPrevRunSnapshot } from "@/features/backtest/results/stat-cards";
import type { FixtureSnapshot } from "@/lib/backtest/engine/adapters/fixture-source";
import { RunResultReport } from "./run-result-report";
import { SaveShareBar } from "@/components/backtesting/persist/save-share-bar";

/**
 * The BT-07 RESULTS orchestrator: verdict → evidence → drill-down, with all 5
 * states (empty / running / partial / error / done). It owns the iteration loop
 * (per-stat deltas vs the previous run, held in zustand+localStorage) and the
 * "change one thing" path back to the builder.
 *
 * Honesty is woven through every tier: the QualityChipRow leads, the hero shows
 * the underwater band, the heatmap hatches empty months, the blotter flags
 * substitute rows. NO LLM, NO HF data — runs on the committed fixture via the
 * BT-05 worker.
 */
export function ResultsView({
  status,
  result,
  progress,
  error,
  emptyReason,
  snapshot,
  strategy,
  onEdit,
  onReRun,
}: {
  status: BacktestStatus;
  result: RunResult | null;
  progress: BacktestProgress | null;
  error: string | null;
  emptyReason: string | null;
  /** The fixture the run executed against — powers the benchmark overlay. */
  snapshot?: FixtureSnapshot | null;
  /** The strategy that produced the run — enables Save/Share/claim. */
  strategy?: StrategyDef | null;
  onEdit?: () => void;
  onReRun?: () => void;
}) {
  const prev = usePrevRunStore((s) => s.prev);
  const remember = usePrevRunStore((s) => s.remember);

  // The delta comparison must use the PREVIOUS run, then this run becomes the new
  // "previous" for the next iteration — so capture prevStats before promoting.
  const prevStatsRef = React.useRef<RunResult["stats"] | null>(null);
  const promotedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (status === "done" && result && promotedFor.current !== result.runId) {
      prevStatsRef.current = prev && prev.runId !== result.runId ? prev.stats : null;
      remember(toPrevRunSnapshot(result));
      promotedFor.current = result.runId;
    }
  }, [status, result, prev, remember]);

  if (status === "idle") return <EmptyState />;
  if (status === "error") return <ErrorState message={error} onReRun={onReRun} />;
  if (status === "empty") return <NoTradesState reason={emptyReason} onEdit={onEdit} />;
  if (status !== "done" || !result) return <RunningState status={status} progress={progress} />;

  return (
    <DoneState
      result={result}
      prevStats={prevStatsRef.current}
      snapshot={snapshot}
      strategy={strategy}
      onEdit={onEdit}
      onReRun={onReRun}
    />
  );
}

/* ── State: empty (no run yet) ───────────────────────────────────────────── */
function EmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-2xl border border-dashed py-16 text-center"
      data-testid="bt-results-empty"
    >
      <FlaskConical className="mb-3 h-8 w-8 text-muted" aria-hidden />
      <h2 className="text-base font-semibold">No backtest run yet</h2>
      <p className="mt-1 max-w-sm text-sm text-muted">
        Build a strategy and press Run — the verdict, evidence and trade-by-trade log appear here.
      </p>
      <Button asChild className="mt-4" size="sm">
        <a href="/backtesting/build">Build a strategy</a>
      </Button>
    </div>
  );
}

/* ── State: running (reuse BT-05 status labels) ──────────────────────────── */
function RunningState({
  status,
  progress,
}: {
  status: BacktestStatus;
  progress: BacktestProgress | null;
}) {
  const pct = progress ? Math.round(progress.fraction * 100) : 0;
  return (
    <div className="rounded-2xl border bg-surface p-6" data-testid="bt-results-running">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden />
        {STATUS_LABEL[status]}
      </div>
      <Progress value={pct} aria-label="Backtest progress" />
      {progress && progress.daysTotal > 0 && (
        <p className="mt-2 text-xs tabular-nums text-muted">
          {progress.daysDone} / {progress.daysTotal} trading days · {pct}%
        </p>
      )}
      {/* Skeleton of the results layout so the handoff reads as an arrival. */}
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-2/60" aria-hidden />
        ))}
      </div>
      <div className="mt-3 h-56 animate-pulse rounded-lg bg-surface-2/60" aria-hidden />
      {/* Coverage-seam skeleton so the seam doesn't pop in on completion. */}
      <div className="mt-1 h-1 animate-pulse rounded-sm bg-surface-2/60" aria-hidden />
    </div>
  );
}

/* ── State: error ────────────────────────────────────────────────────────── */
function ErrorState({ message, onReRun }: { message: string | null; onReRun?: () => void }) {
  return (
    <div
      className="rounded-2xl border border-loss/40 bg-loss/5 p-6 text-center"
      data-testid="bt-results-error"
    >
      <AlertTriangle className="mx-auto mb-2 h-7 w-7 text-loss" aria-hidden />
      <h2 className="text-base font-semibold text-loss">The backtest hit an error</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
        {message ?? "Something went wrong while running. Try again."}
      </p>
      {onReRun && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onReRun}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Retry
        </Button>
      )}
    </div>
  );
}

/* ── State: empty:no-trades ──────────────────────────────────────────────── */
function NoTradesState({ reason, onEdit }: { reason: string | null; onEdit?: () => void }) {
  return (
    <div
      className="rounded-2xl border border-warning/40 bg-warning/5 p-6 text-center"
      data-testid="bt-results-notrades"
    >
      <TriangleAlert className="mx-auto mb-2 h-7 w-7 text-warning" aria-hidden />
      <h2 className="text-base font-semibold">No tradeable days</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
        {reason ?? "This strategy never found a tradeable entry in the range — it's not an error."}
      </p>
      {onEdit && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit strikes
        </Button>
      )}
    </div>
  );
}

/* ── State: done (also renders the honest partial verdict) ───────────────── */
function DoneState({
  result,
  prevStats,
  snapshot,
  strategy,
  onEdit,
  onReRun,
}: {
  result: RunResult;
  prevStats: RunResult["stats"] | null;
  snapshot?: FixtureSnapshot | null;
  /** The strategy that produced this run — needed to Save/claim it. */
  strategy?: StrategyDef | null;
  onEdit?: () => void;
  onReRun?: () => void;
}) {
  return (
    <div className="space-y-3 sm:space-y-6">
      {/* Iteration toolbar */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {onEdit && (
          <Button variant="outline" size="sm" onClick={onEdit} data-testid="bt-change-one-thing">
            <Pencil className="h-3.5 w-3.5" aria-hidden /> Change one thing
          </Button>
        )}
        {onReRun && (
          <Button variant="ghost" size="sm" onClick={onReRun}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Re-run
          </Button>
        )}
      </div>

      {/* Save / Share / Notify — login is nudged ONLY here, never to build/run. */}
      {strategy && <SaveShareBar result={result} strategy={strategy} />}

      {/* The full read-only report (coverage-honesty layer → verdict → evidence
          → blotter). Shared verbatim with the public /backtesting/r/[shareId]. */}
      <RunResultReport result={result} prevStats={prevStats} snapshot={snapshot} />
    </div>
  );
}
