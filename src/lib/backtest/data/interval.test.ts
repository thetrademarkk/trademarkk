/**
 * interval.test.ts — the arbitrary-timeframe parser. Reference for expected
 * values: docs/backtesting/13-strike-and-timeframe-ux.md §"Timeframe"
 * (Nm / Nh=N·60m / 1d=375m; reject <1m and >1d; warn-but-allow non-session-
 * divisors) and the 375-minute IST session (06-engine-semantics §1.1).
 */

import { describe, expect, it } from "vitest";
import { dividesSession, isParsableInterval, parseInterval, SESSION_MINUTES } from "./interval";

describe("parseInterval — minute tokens", () => {
  it("parses bare minutes and the 'm' suffix identically", () => {
    expect(parseInterval("5")).toMatchObject({
      valid: true,
      minutes: 5,
      unit: "minute",
      label: "5m",
    });
    expect(parseInterval("5m")).toMatchObject({ valid: true, minutes: 5, label: "5m" });
  });

  it("accepts arbitrary non-divisor minute intervals and WARNS (ragged candle)", () => {
    for (const n of [2, 3, 7, 11, 13, 17, 30]) {
      const r = parseInterval(`${n}m`);
      expect(r.valid).toBe(true);
      expect(r.minutes).toBe(n);
      // 3 divides 375 (125 buckets) → no warning; the rest do not.
      if (SESSION_MINUTES % n === 0) {
        expect(r.dividesSession).toBe(true);
        expect(r.warning).toBeUndefined();
      } else {
        expect(r.dividesSession).toBe(false);
        expect(r.warning).toBeTruthy();
      }
    }
  });

  it("flags clean session divisors with dividesSession:true and no warning", () => {
    // 375 = 3 · 5³ ; divisors include 1,3,5,15,25,75,125,375.
    for (const n of [1, 3, 5, 15, 25, 75, 125, 375]) {
      const r = parseInterval(`${n}m`);
      expect(r.valid).toBe(true);
      expect(r.dividesSession).toBe(true);
      expect(r.warning).toBeUndefined();
    }
  });

  it("1m is the identity interval (valid, divides, no warning)", () => {
    expect(parseInterval("1m")).toMatchObject({ valid: true, minutes: 1, dividesSession: true });
  });
});

describe("parseInterval — hour tokens (N·60m)", () => {
  it("1h == 60 minutes", () => {
    expect(parseInterval("1h")).toMatchObject({
      valid: true,
      minutes: 60,
      unit: "minute",
      label: "1h",
    });
  });

  it("hour tokens carry the ragged warning when they do not divide the session", () => {
    // 60 does not divide 375 (375/60 = 6.25) → warn.
    expect(parseInterval("1h").dividesSession).toBe(false);
    expect(parseInterval("1h").warning).toBeTruthy();
  });

  it("rejects hour tokens coarser than the session (>6h)", () => {
    expect(parseInterval("7h").valid).toBe(false); // 420m > 375m
  });
});

describe("parseInterval — day and week tokens", () => {
  it("1d collapses one session → 375 minutes, unit:day", () => {
    expect(parseInterval("1d")).toMatchObject({
      valid: true,
      minutes: SESSION_MINUTES,
      unit: "day",
      label: "1d",
    });
  });

  it("1w is a week roll-up with no fixed minute count", () => {
    expect(parseInterval("1w")).toMatchObject({
      valid: true,
      minutes: null,
      unit: "week",
      label: "1w",
    });
  });

  it("rejects multi-day / multi-week tokens (only 1d, 1w in v1)", () => {
    expect(parseInterval("2d").valid).toBe(false);
    expect(parseInterval("3w").valid).toBe(false);
  });
});

describe("parseInterval — rejections", () => {
  it("rejects sub-1m, zero, fractional and negative", () => {
    expect(parseInterval("0").valid).toBe(false);
    expect(parseInterval("0m").valid).toBe(false);
    expect(parseInterval("2.5m").valid).toBe(false);
    expect(parseInterval("-5m").valid).toBe(false);
  });

  it("rejects minute intervals coarser than 1d (>375m)", () => {
    expect(parseInterval("400m").valid).toBe(false);
    expect(parseInterval("376m").valid).toBe(false);
  });

  it("rejects empty and garbage tokens", () => {
    expect(parseInterval("").valid).toBe(false);
    expect(parseInterval("abc").valid).toBe(false);
    expect(parseInterval("5x").valid).toBe(false);
    expect(parseInterval("m").valid).toBe(false); // unit with no count
  });

  it("invalid tokens carry a reason for the UI", () => {
    expect(parseInterval("400m").reason).toBeTruthy();
    expect(parseInterval("").reason).toBeTruthy();
  });
});

describe("helpers", () => {
  it("dividesSession matches the 375-min session arithmetic", () => {
    expect(dividesSession(5)).toBe(true);
    expect(dividesSession(7)).toBe(false);
    expect(dividesSession(375)).toBe(true);
  });

  it("isParsableInterval mirrors parseInterval().valid", () => {
    expect(isParsableInterval("7m")).toBe(true);
    expect(isParsableInterval("nope")).toBe(false);
  });
});
