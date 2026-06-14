"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { runBacktest } from "@/lib/backtest/engine/engine";
import { FixtureDataSource } from "@/lib/backtest/engine/adapters/fixture-source";
import type {
  BacktestDataPayload,
  BacktestRunRequest,
  BacktestWorkerResponse,
} from "@/lib/backtest/worker/messages";
import { nextStatus, type BacktestStatus } from "@/features/backtest/shared/backtest-status";
import type { RunResult } from "@/features/backtest/shared/run-result";
import type { StrategyDef } from "@/features/backtest/shared/strategy-def";

/** Live progress snapshot the UI renders (phase label comes from STATUS_LABEL). */
export interface BacktestProgress {
  fraction: number; // 0..1
  daysDone: number;
  daysTotal: number;
}

export interface UseBacktest {
  status: BacktestStatus;
  result: RunResult | null;
  progress: BacktestProgress | null;
  /** Set on the `empty` state — a descriptive, honest reason. */
  emptyReason: string | null;
  error: string | null;
  /** Kick off a run; supersedes (cancels) any in-flight run. */
  run: (strategy: StrategyDef, data: BacktestDataPayload) => void;
  /** Cancel the in-flight run: terminate + respawn the worker, return to idle. */
  cancel: () => void;
}

/**
 * Drives the backtest worker (BT-05). Clones the use-monte-carlo idiom exactly:
 *
 *  - REQUEST-ID SUPERSESSION: each `run` bumps `reqId`; a worker reply whose
 *    runId !== the live reqId is dropped (a stale, superseded run can never
 *    overwrite a newer one or a cancel).
 *  - CANCEL = TERMINATE + RESPAWN: `cancel()` kills the worker mid-run (the only
 *    way to stop a busy worker) and clears it so the next `run` builds a fresh
 *    one; status returns to idle.
 *  - LAYOUT-LEVEL OWNERSHIP: this hook is intended to be owned by a provider
 *    mounted in the backtesting LAYOUT (see BacktestRunnerProvider), so
 *    navigating between /build and the results view does not unmount the worker
 *    and kill an in-flight run — matching where the monte-carlo worker lives
 *    relative to its consuming screens.
 *  - SYNCHRONOUS FALLBACK: if the environment can't build a Worker (very old
 *    engines, or a non-DOM test env) we run the pure engine on the main thread —
 *    slower, but the feature never breaks.
 *
 * Status is driven through the pure BacktestStatus machine (`nextStatus`), so an
 * illegal/late transition is guarded rather than corrupting the UI.
 */
export function useBacktest(): UseBacktest {
  const [status, setStatus] = useState<BacktestStatus>("idle");
  const [result, setResult] = useState<RunResult | null>(null);
  const [progress, setProgress] = useState<BacktestProgress | null>(null);
  const [emptyReason, setEmptyReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);

  /** Advance the state machine via the pure transition fn (guards illegal moves). */
  const advance = useCallback((event: Parameters<typeof nextStatus>[1]) => {
    setStatus((cur) => nextStatus(cur, event));
  }, []);

  const ensureWorker = useCallback((): Worker | null => {
    if (workerRef.current) return workerRef.current;
    if (typeof window === "undefined" || typeof Worker === "undefined") return null;
    try {
      // new URL(..., import.meta.url) is the pattern Next/Turbopack/webpack all
      // recognise to bundle the worker as its own fingerprinted chunk.
      const worker = new Worker(new URL("@/lib/backtest/worker/backtest.worker", import.meta.url), {
        type: "module",
      });
      worker.addEventListener("message", (e: MessageEvent<BacktestWorkerResponse>) => {
        const msg = e.data;
        if (msg.runId !== reqId.current) return; // stale reply from a superseded run
        switch (msg.type) {
          case "progress":
            setProgress({
              fraction: msg.fraction,
              daysDone: msg.daysDone,
              daysTotal: msg.daysTotal,
            });
            advance({ type: "ADVANCE", to: msg.phase });
            break;
          case "partial":
            setProgress((p) =>
              p ? { ...p, daysDone: msg.daysDone, daysTotal: msg.daysTotal } : p
            );
            advance({ type: "PARTIAL" });
            break;
          case "done":
            setResult(msg.result);
            setProgress({
              fraction: 1,
              daysDone: msg.result.blotter.length,
              daysTotal: msg.result.blotter.length,
            });
            advance({ type: "DONE" });
            break;
          case "empty":
            setEmptyReason(msg.reason);
            advance({ type: "EMPTY" });
            break;
          case "error":
            setError(msg.error);
            advance({ type: "ERROR" });
            break;
        }
      });
      worker.addEventListener("error", (e) => {
        setError(e.message || "Backtest worker failed");
        advance({ type: "ERROR" });
      });
      workerRef.current = worker;
      return worker;
    } catch {
      return null; // fall back to synchronous mode in `run`
    }
  }, [advance]);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const cancel = useCallback(() => {
    // Bump the id so any reply already in flight is treated as stale.
    reqId.current += 1;
    // Terminate the busy worker (the only way to stop it) and drop it so the
    // next run builds a fresh one.
    workerRef.current?.terminate();
    workerRef.current = null;
    setProgress(null);
    advance({ type: "RESET" });
  }, [advance]);

  const run = useCallback(
    (strategy: StrategyDef, data: BacktestDataPayload) => {
      const id = ++reqId.current;
      setResult(null);
      setError(null);
      setEmptyReason(null);
      setProgress({ fraction: 0, daysDone: 0, daysTotal: 0 });
      // START → validating (always legal from any state, including terminal).
      setStatus((cur) => nextStatus(nextStatus(cur, { type: "RESET" }), { type: "START" }));

      const ranAt = Date.now();
      const worker = ensureWorker();
      if (worker) {
        const req: BacktestRunRequest = { type: "run", runId: id, strategy, data, ranAt };
        worker.postMessage(req);
        return;
      }

      // Synchronous fallback — defer a tick so the spinner can paint first.
      setTimeout(() => {
        if (id !== reqId.current) return;
        try {
          if (data.kind !== "fixture") {
            setError("This environment cannot run a worker-only data source.");
            advance({ type: "ERROR" });
            return;
          }
          const res = runBacktest(strategy, new FixtureDataSource(data.snapshot), { ranAt });
          if (id !== reqId.current) return;
          if (res.blotter.length === 0) {
            setEmptyReason("No qualifying trading days in this date range.");
            advance({ type: "EMPTY" });
            return;
          }
          setResult(res);
          setProgress({ fraction: 1, daysDone: res.blotter.length, daysTotal: res.blotter.length });
          advance({ type: "DONE" });
        } catch (err) {
          if (id !== reqId.current) return;
          setError(err instanceof Error ? err.message : String(err));
          advance({ type: "ERROR" });
        }
      }, 0);
    },
    [ensureWorker, advance]
  );

  return { status, result, progress, emptyReason, error, run, cancel };
}
