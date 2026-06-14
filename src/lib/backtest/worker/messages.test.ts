/**
 * Worker MESSAGE-CONTRACT + progress-throttle tests (BT-05). Verifies:
 *  - makeProgressThrottle emits at most one value per window, always emits the
 *    leading edge, drops in-between ticks, and `force` bypasses the window (the
 *    final 100% tick always lands);
 *  - the discriminated request/response unions are well-formed and round-trip
 *    through structuredClone-style JSON (workers postMessage serializable data).
 */

import { describe, expect, it } from "vitest";
import {
  PROGRESS_THROTTLE_MS,
  makeProgressThrottle,
  type BacktestDataPayload,
  type BacktestRunRequest,
  type BacktestWorkerResponse,
} from "./messages";
import type { FixtureSnapshot } from "../engine/adapters/fixture-source";

describe("makeProgressThrottle", () => {
  it("emits the leading edge, then drops ticks within the window", () => {
    let t = 1000;
    const out: number[] = [];
    const emit = makeProgressThrottle<number>(
      (v) => out.push(v),
      100,
      () => t
    );

    emit(1); // leading edge — emits
    t = 1050;
    emit(2); // within 100ms of last emit → dropped
    t = 1099;
    emit(3); // still within window → dropped
    t = 1100;
    emit(4); // exactly 100ms later → emits
    expect(out).toEqual([1, 4]);
  });

  it("`force` bypasses the window so the final tick always lands", () => {
    let t = 0;
    const out: number[] = [];
    const emit = makeProgressThrottle<number>(
      (v) => out.push(v),
      100,
      () => t
    );
    emit(10); // leading edge
    t = 5;
    emit(99); // dropped (within window)
    emit(100, true); // forced → emits even though window not elapsed
    expect(out).toEqual([10, 100]);
  });

  it("respects a custom window and never emits more than once per window", () => {
    let t = 0;
    const out: number[] = [];
    const emit = makeProgressThrottle<number>(
      (v) => out.push(v),
      250,
      () => t
    );
    for (let i = 0; i < 10; i++) {
      emit(i);
      t += 50; // 50ms apart → only every 5th passes the 250ms gate
    }
    // t starts at 0: emit at 0 (leading), next at 250 (i=5). i=0 and i=5.
    expect(out).toEqual([0, 5]);
  });

  it("defaults to the spec's 100ms window", () => {
    expect(PROGRESS_THROTTLE_MS).toBe(100);
  });
});

describe("worker message contract", () => {
  const snapshot: FixtureSnapshot = {
    snapshotId: "test-snap",
    symbol: "NIFTY",
    days: [],
  };

  it("builds a serializable run request (fixture data payload)", () => {
    const data: BacktestDataPayload = { kind: "fixture", snapshot };
    const req: BacktestRunRequest = {
      type: "run",
      runId: 7,
      // a minimal but shaped strategy ref is fine for the wire test
      strategy: { id: "x" } as BacktestRunRequest["strategy"],
      data,
      ranAt: 123,
    };
    const round = JSON.parse(JSON.stringify(req)) as BacktestRunRequest;
    expect(round.type).toBe("run");
    expect(round.runId).toBe(7);
    expect(round.data.kind).toBe("fixture");
    expect(round.ranAt).toBe(123);
  });

  it("every response variant carries a runId and a discriminant", () => {
    const responses: BacktestWorkerResponse[] = [
      { type: "progress", runId: 1, phase: "simulating", fraction: 0.5, daysDone: 1, daysTotal: 2 },
      { type: "partial", runId: 1, netSoFar: 100, daysDone: 1, daysTotal: 2 },
      { type: "empty", runId: 1, reason: "no days" },
      { type: "error", runId: 1, error: "boom" },
    ];
    for (const r of responses) {
      const round = JSON.parse(JSON.stringify(r)) as BacktestWorkerResponse;
      expect(round.runId).toBe(1);
      expect(typeof round.type).toBe("string");
    }
  });
});
