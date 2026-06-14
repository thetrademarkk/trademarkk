/**
 * BacktestStatus — the explicit state machine that governs a single backtest
 * run's lifecycle (BT-05). It is a PURE, unit-testable transition function: the
 * UI/hook never mutates status ad-hoc, it asks `nextStatus(current, event)` and
 * the machine guards every illegal transition.
 *
 * Why a real machine (not a string flag): a backtest run moves through several
 * descriptive phases the UI surfaces as live, honest progress — booting the
 * worker, resolving the data snapshot, simulating the bar replay, then
 * aggregating into the RunResult. A flag ("running") would erase that detail;
 * an enum + transition table makes the legal flow auditable and prevents a stale
 * worker reply from yanking a superseded run back to "done".
 *
 * The phases are DESCRIPTIVE labels only (no LLM, no evaluation): the worker
 * emits a `phase` on each progress tick and the machine advances accordingly.
 *
 * Lifecycle (happy path):
 *   idle → validating → booting → resolving-data → simulating → aggregating → done
 *
 * Branches:
 *   - any active phase → error    (worker error or thrown validation)
 *   - any active phase → empty    (no qualifying trading days / no result rows)
 *   - simulating → partial → simulating | aggregating | done  (intermediate yields)
 *   - terminal (done/error/empty) → validating  (a brand-new run restarts the flow)
 *   - any state → idle  (cancel / reset)
 */

/** The descriptive run phases, in lifecycle order. */
export const BACKTEST_STATUSES = [
  "idle",
  "validating",
  "booting",
  "resolving-data",
  "simulating",
  "aggregating",
  "partial",
  "done",
  "error",
  "empty",
] as const;

export type BacktestStatus = (typeof BACKTEST_STATUSES)[number];

/** Terminal states — a run is finished and the UI can show its outcome. */
export const TERMINAL_STATUSES = ["done", "error", "empty"] as const;

/** Active (in-flight) states — a worker run is underway. */
export const ACTIVE_STATUSES = [
  "validating",
  "booting",
  "resolving-data",
  "simulating",
  "aggregating",
  "partial",
] as const;

export function isTerminal(s: BacktestStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(s);
}

export function isActive(s: BacktestStatus): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(s);
}

/**
 * Events that drive the machine. `START` kicks a new run, `ADVANCE` moves to a
 * named phase (driven by the worker's `phase` ticks), the terminal events close
 * the run, and `RESET` returns to idle (used by cancel()).
 */
export type BacktestEvent =
  | { type: "START" } // → validating
  | { type: "ADVANCE"; to: BacktestPhase } // → a named active phase
  | { type: "PARTIAL" } // intermediate yield while simulating
  | { type: "DONE" } // → done
  | { type: "EMPTY" } // → empty (no qualifying data)
  | { type: "ERROR" } // → error
  | { type: "RESET" }; // → idle

/** The active phases an ADVANCE event may target (subset of BacktestStatus). */
export type BacktestPhase = "booting" | "resolving-data" | "simulating" | "aggregating";

/**
 * Allowed transitions. A transition NOT listed here is illegal and
 * `nextStatus` returns the current state unchanged (guarded). Keys are the
 * source state; the value is the set of states reachable in one step.
 */
const ALLOWED: Record<BacktestStatus, ReadonlySet<BacktestStatus>> = {
  idle: new Set(["validating"]),
  validating: new Set(["booting", "error", "empty", "idle"]),
  booting: new Set(["resolving-data", "error", "empty", "idle"]),
  "resolving-data": new Set(["simulating", "error", "empty", "idle"]),
  simulating: new Set(["partial", "aggregating", "done", "error", "empty", "idle"]),
  partial: new Set(["simulating", "aggregating", "done", "error", "empty", "idle"]),
  aggregating: new Set(["done", "error", "empty", "idle"]),
  // Terminal states only restart (→ validating) or reset (→ idle).
  done: new Set(["validating", "idle"]),
  error: new Set(["validating", "idle"]),
  empty: new Set(["validating", "idle"]),
};

/** Map an event to its target status (phase events carry their own target). */
function targetOf(event: BacktestEvent): BacktestStatus {
  switch (event.type) {
    case "START":
      return "validating";
    case "ADVANCE":
      return event.to;
    case "PARTIAL":
      return "partial";
    case "DONE":
      return "done";
    case "EMPTY":
      return "empty";
    case "ERROR":
      return "error";
    case "RESET":
      return "idle";
  }
}

/**
 * The pure transition function. Returns the next status if the (current, event)
 * pair is a legal transition; otherwise returns `current` unchanged (the machine
 * silently guards illegal moves rather than throwing, so a late/stale worker
 * message can never corrupt the UI state).
 */
export function nextStatus(current: BacktestStatus, event: BacktestEvent): BacktestStatus {
  const target = targetOf(event);
  if (target === current) return current; // no-op self transition is a safe identity
  return ALLOWED[current].has(target) ? target : current;
}

/** True iff `nextStatus(current, event)` would actually change state. */
export function canTransition(current: BacktestStatus, event: BacktestEvent): boolean {
  const target = targetOf(event);
  return target !== current && ALLOWED[current].has(target);
}

/**
 * A human-readable, DESCRIPTIVE label for each status — surfaced verbatim in the
 * running modal's live counter. No evaluation, no verdict (D10): these only name
 * what the engine is mechanically doing.
 */
export const STATUS_LABEL: Record<BacktestStatus, string> = {
  idle: "Ready",
  validating: "Checking your strategy",
  booting: "Starting the engine",
  "resolving-data": "Loading market data",
  simulating: "Replaying the market",
  aggregating: "Tallying results",
  partial: "Replaying the market",
  done: "Done",
  error: "Run failed",
  empty: "No tradeable days",
};
