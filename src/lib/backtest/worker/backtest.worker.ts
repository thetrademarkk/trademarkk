/// <reference lib="webworker" />
/**
 * Web Worker that runs the BT-04 deterministic bar-replay ENGINE off the main
 * thread, so a multi-month backtest never freezes the UI. It owns no DOM and no
 * persistent state: it receives a `BacktestRunRequest` (a serializable
 * StrategyDef + a serializable data payload), rebuilds the DataSource, runs the
 * pure `runBacktest`, and posts back typed progress/partial/done/empty/error
 * messages tagged with the request's `runId`.
 *
 * Instantiated from the UI via
 * `new Worker(new URL("./backtest.worker.ts", import.meta.url), { type: "module" })`
 * — the pattern Next 15 / Turbopack / webpack all recognise to emit the worker
 * as its own fingerprinted chunk (mirrors montecarlo.worker.ts). It is NEVER
 * imported during SSR (only the hook touches it, lazily, on the client).
 *
 * DATA-SOURCE SWAP SEAM (BT-08): only the `data` payload variant changes; the
 * reply protocol and the engine call below stay identical because the engine
 * depends solely on the abstract DataSource interface.
 *
 * DETERMINISM: the engine is pure (seed → mulberry32). Identical request ⇒
 * byte-identical RunResult (modulo the explicit `ranAt` stamp the request carries).
 */

import { runBacktest } from "../engine/engine";
import { FixtureDataSource } from "../engine/adapters/fixture-source";
import type { DataSource } from "../engine/data-source";
import { makeProgressThrottle } from "./messages";
import type { BacktestPhase } from "../../../features/backtest/shared/backtest-status";
import type {
  BacktestDataPayload,
  BacktestProgressMessage,
  BacktestWorkerRequest,
  BacktestWorkerResponse,
} from "./messages";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/** Build a concrete DataSource from a serializable payload (the swap seam). */
function buildDataSource(payload: BacktestDataPayload): DataSource {
  switch (payload.kind) {
    case "fixture":
      return new FixtureDataSource(payload.snapshot);
  }
}

/** Count the trading days a fixture snapshot covers (for the progress counter). */
function dayCount(payload: BacktestDataPayload): number {
  switch (payload.kind) {
    case "fixture":
      return payload.snapshot.days.length;
  }
}

ctx.addEventListener("message", (e: MessageEvent<BacktestWorkerRequest>) => {
  const req = e.data;
  if (req.type !== "run") return;
  const { runId, strategy, data, ranAt } = req;

  const post = (msg: BacktestWorkerResponse) => ctx.postMessage(msg);
  const daysTotal = dayCount(data);

  // Throttle progress to ≤1 / 100ms; the final tick is forced through.
  const emitProgress = makeProgressThrottle<BacktestProgressMessage>((m) => post(m));
  const progress = (phase: BacktestPhase, fraction: number, daysDone: number, force = false) =>
    emitProgress({ type: "progress", runId, phase, fraction, daysDone, daysTotal }, force);

  try {
    // Phase 1 — engine boot (the worker itself is up; this names the step).
    progress("booting", 0.05, 0, true);

    // Phase 2 — resolve the data snapshot into a concrete source.
    const source = buildDataSource(data);
    progress("resolving-data", 0.15, 0, true);

    // Phase 3 — simulate the bar replay. The engine runs as one pure call; we
    // bracket it with simulating/aggregating phase ticks (per-bar streaming
    // progress is a future engine hook — the contract already supports it).
    progress("simulating", 0.25, 0, true);
    const result = runBacktest(strategy, source, { ranAt });

    // Phase 4 — aggregate into the RunResult (already done inside the engine;
    // this names the tail so the UI's live counter reaches completion honestly).
    progress("aggregating", 0.95, result.blotter.length, true);

    // EMPTY is a first-class honest outcome: the engine ran but no day produced a
    // tradeable cycle (whole range filtered / every required leg missing data).
    if (result.blotter.length === 0) {
      post({
        type: "empty",
        runId,
        reason:
          result.coverage.excludedDays > 0
            ? "No tradeable days — every day in this range was missing a required option leg."
            : "No qualifying trading days in this date range.",
      });
      return;
    }

    progress("aggregating", 1, result.blotter.length, true);
    post({ type: "done", runId, result });
  } catch (err) {
    post({ type: "error", runId, error: err instanceof Error ? err.message : String(err) });
  }
});
