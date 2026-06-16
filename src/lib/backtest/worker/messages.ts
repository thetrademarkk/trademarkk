/**
 * The backtest WORKER MESSAGE CONTRACT (BT-05). This is the wire protocol
 * between the main thread (`useBacktest`) and `backtest.worker.ts`. It is the
 * one file both sides import so the types can never drift.
 *
 * Design goal — DATA-SOURCE INDEPENDENCE: the request carries a discriminated
 * `data` payload describing HOW the worker should build its DataSource. Today the
 * only variant is an in-memory `FixtureSnapshot` (`{ kind: "fixture", snapshot }`).
 * BT-08 adds the HF/duckdb-wasm source as a NEW variant (e.g.
 * `{ kind: "hf", ... }`) WITHOUT touching this protocol or the worker's reply
 * messages — the engine already depends only on the abstract DataSource seam.
 *
 * Progress is THROTTLED on the worker side to ≤1 message / 100ms (see
 * `makeProgressThrottle`) so a long replay can't flood the main thread.
 *
 * Every message carries a `runId` (the request id) so the hook can ignore stale
 * replies from a superseded (cancelled) run — the same supersession idiom the
 * monte-carlo worker uses.
 */

import type { FixtureSnapshot } from "../engine/adapters/fixture-source";
import type { BacktestPhase } from "../../../features/backtest/shared/backtest-status";
import type { RunResult } from "../../../features/backtest/shared/run-result";
import type { StrategyDef } from "../../../features/backtest/shared/strategy-def";

/**
 * How the worker should obtain its DataSource. Discriminated for forward-compat.
 *
 *   - "fixture" — an in-memory `FixtureSnapshot` (unit tests + golden runs).
 *   - "hf" — the BT-08 duckdb-wasm-over-HuggingFace source. The payload carries
 *     NO data: the worker builds the source by prefetching from HF using the
 *     request's own `strategy` (its day spine + expiry rule + strike band).
 *     `bandPts` optionally overrides the derived chain width. The dataset is
 *     public + ungated, so there is NO secret/token in this payload (or anywhere
 *     in client code). The signed CDN redirect is never cached (urls.ts uses the
 *     stable resolve/main form).
 */
export type BacktestDataPayload =
  | { kind: "fixture"; snapshot: FixtureSnapshot }
  | { kind: "hf"; bandPts?: number };

/** Main-thread → worker: run this strategy against this data, tagged with runId. */
export interface BacktestRunRequest {
  type: "run";
  runId: number;
  strategy: StrategyDef;
  data: BacktestDataPayload;
  /** Stamped onto RunResult.ranAt so the result records when it ran. */
  ranAt: number;
}

export type BacktestWorkerRequest = BacktestRunRequest;

/** Throttled progress tick — a named phase + a 0..1 fraction. */
export interface BacktestProgressMessage {
  type: "progress";
  runId: number;
  phase: BacktestPhase;
  /** 0..1 completion fraction within the overall run (monotonic, best-effort). */
  fraction: number;
  /** Trading days replayed so far / total (descriptive counter for the UI). */
  daysDone: number;
  daysTotal: number;
}

/** Optional intermediate yield (the machine's `partial` state). */
export interface BacktestPartialMessage {
  type: "partial";
  runId: number;
  /** Net P&L accumulated so far (rupees) — a live counter, not a final figure. */
  netSoFar: number;
  daysDone: number;
  daysTotal: number;
}

/** Terminal success — the full RunResult. */
export interface BacktestDoneMessage {
  type: "done";
  runId: number;
  result: RunResult;
}

/** Terminal: the engine ran but produced no tradeable days (honest empty). */
export interface BacktestEmptyMessage {
  type: "empty";
  runId: number;
  /** Descriptive reason, e.g. "No qualifying trading days in this range." */
  reason: string;
}

/** Terminal failure — a thrown engine/validation error. */
export interface BacktestErrorMessage {
  type: "error";
  runId: number;
  error: string;
}

export type BacktestWorkerResponse =
  | BacktestProgressMessage
  | BacktestPartialMessage
  | BacktestDoneMessage
  | BacktestEmptyMessage
  | BacktestErrorMessage;

// ── Progress-throttle helper (pure, unit-tested) ─────────────────────────────

/** Minimal monotonic clock — injectable so the helper is unit-testable. */
export type NowFn = () => number;

/** Default throttle window: at most one progress emission per 100ms (spec). */
export const PROGRESS_THROTTLE_MS = 100;

/**
 * Build a progress throttle. Returns an `emit(value, force?)` function: it
 * forwards `value` to `sink` only if at least `windowMs` has elapsed since the
 * last forwarded emission (or `force` is true — used for the FINAL tick so the
 * UI always lands on 100%). The FIRST call always emits (leading edge).
 *
 * Pure aside from the injected clock; no timers, no closures over wall-clock —
 * the worker calls `emit` inside its day loop and the throttle drops the
 * in-between ticks. This guarantees ≤1 message / window without losing the
 * leading or the (forced) trailing edge.
 */
export function makeProgressThrottle<T>(
  sink: (value: T) => void,
  windowMs: number = PROGRESS_THROTTLE_MS,
  now: NowFn = () => Date.now()
): (value: T, force?: boolean) => void {
  let lastEmit = Number.NEGATIVE_INFINITY;
  return (value: T, force = false) => {
    const t = now();
    if (force || t - lastEmit >= windowMs) {
      lastEmit = t;
      sink(value);
    }
  };
}
