/**
 * BacktestStatus state-machine tests (BT-05). Verifies the full happy-path flow,
 * every guarded INVALID transition is rejected (returns current unchanged), the
 * terminal/active classifiers, and the descriptive labels exist for every state.
 */

import { describe, expect, it } from "vitest";
import {
  ACTIVE_STATUSES,
  BACKTEST_STATUSES,
  STATUS_LABEL,
  TERMINAL_STATUSES,
  canTransition,
  isActive,
  isTerminal,
  nextStatus,
  type BacktestEvent,
  type BacktestStatus,
} from "./backtest-status";

describe("BacktestStatus — happy path", () => {
  it("walks idle → validating → booting → resolving-data → simulating → aggregating → done", () => {
    let s: BacktestStatus = "idle";
    s = nextStatus(s, { type: "START" });
    expect(s).toBe("validating");
    s = nextStatus(s, { type: "ADVANCE", to: "booting" });
    expect(s).toBe("booting");
    s = nextStatus(s, { type: "ADVANCE", to: "resolving-data" });
    expect(s).toBe("resolving-data");
    s = nextStatus(s, { type: "ADVANCE", to: "simulating" });
    expect(s).toBe("simulating");
    s = nextStatus(s, { type: "ADVANCE", to: "aggregating" });
    expect(s).toBe("aggregating");
    s = nextStatus(s, { type: "DONE" });
    expect(s).toBe("done");
  });

  it("supports a partial yield while simulating, then aggregating → done", () => {
    let s: BacktestStatus = "simulating";
    s = nextStatus(s, { type: "PARTIAL" });
    expect(s).toBe("partial");
    s = nextStatus(s, { type: "ADVANCE", to: "simulating" });
    expect(s).toBe("simulating");
    s = nextStatus(s, { type: "DONE" });
    expect(s).toBe("done");
  });

  it("a terminal state restarts on a new run (→ validating)", () => {
    for (const term of TERMINAL_STATUSES) {
      expect(nextStatus(term, { type: "START" })).toBe("validating");
    }
  });

  it("RESET returns any state to idle", () => {
    for (const s of BACKTEST_STATUSES) {
      expect(nextStatus(s, { type: "RESET" })).toBe("idle");
    }
  });

  it("any active phase can transition to error or empty", () => {
    for (const s of ACTIVE_STATUSES) {
      expect(nextStatus(s, { type: "ERROR" })).toBe("error");
      expect(nextStatus(s, { type: "EMPTY" })).toBe("empty");
    }
  });
});

describe("BacktestStatus — guarded invalid transitions", () => {
  it("idle cannot jump straight to simulating/done/aggregating", () => {
    expect(nextStatus("idle", { type: "ADVANCE", to: "simulating" })).toBe("idle");
    expect(nextStatus("idle", { type: "DONE" })).toBe("idle");
    expect(nextStatus("idle", { type: "ADVANCE", to: "aggregating" })).toBe("idle");
  });

  it("cannot go backwards (simulating → booting, aggregating → simulating)", () => {
    expect(nextStatus("simulating", { type: "ADVANCE", to: "booting" })).toBe("simulating");
    expect(nextStatus("aggregating", { type: "ADVANCE", to: "simulating" })).toBe("aggregating");
  });

  it("a terminal state cannot DONE/PARTIAL/ADVANCE — only restart or reset", () => {
    expect(nextStatus("done", { type: "DONE" })).toBe("done");
    expect(nextStatus("error", { type: "PARTIAL" })).toBe("error");
    expect(nextStatus("empty", { type: "ADVANCE", to: "simulating" })).toBe("empty");
  });

  it("validating cannot skip to simulating (must boot + resolve first)", () => {
    expect(nextStatus("validating", { type: "ADVANCE", to: "simulating" })).toBe("validating");
  });

  it("a self-transition is a safe no-op (identity, not an error)", () => {
    expect(nextStatus("simulating", { type: "ADVANCE", to: "simulating" })).toBe("simulating");
  });

  it("canTransition agrees with nextStatus for valid and invalid moves", () => {
    const valid: [BacktestStatus, BacktestEvent][] = [
      ["idle", { type: "START" }],
      ["simulating", { type: "DONE" }],
      ["booting", { type: "ERROR" }],
    ];
    const invalid: [BacktestStatus, BacktestEvent][] = [
      ["idle", { type: "DONE" }],
      ["done", { type: "PARTIAL" }],
      ["aggregating", { type: "ADVANCE", to: "booting" }],
    ];
    for (const [s, e] of valid) {
      expect(canTransition(s, e)).toBe(true);
      expect(nextStatus(s, e)).not.toBe(s);
    }
    for (const [s, e] of invalid) {
      expect(canTransition(s, e)).toBe(false);
      expect(nextStatus(s, e)).toBe(s);
    }
    // A no-op self transition is reported as NOT a real transition.
    expect(canTransition("simulating", { type: "ADVANCE", to: "simulating" })).toBe(false);
  });
});

describe("BacktestStatus — classifiers + labels", () => {
  it("isTerminal / isActive partition the non-idle states correctly", () => {
    expect(isTerminal("done")).toBe(true);
    expect(isTerminal("error")).toBe(true);
    expect(isTerminal("empty")).toBe(true);
    expect(isTerminal("simulating")).toBe(false);
    expect(isActive("simulating")).toBe(true);
    expect(isActive("partial")).toBe(true);
    expect(isActive("idle")).toBe(false);
    expect(isActive("done")).toBe(false);
  });

  it("every status has a descriptive (non-empty) label", () => {
    for (const s of BACKTEST_STATUSES) {
      expect(STATUS_LABEL[s]).toBeTruthy();
      expect(STATUS_LABEL[s].length).toBeGreaterThan(0);
    }
  });

  it("idle is neither active nor terminal", () => {
    expect(isActive("idle")).toBe(false);
    expect(isTerminal("idle")).toBe(false);
  });
});
