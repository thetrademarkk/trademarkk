import { describe, expect, it } from "vitest";
import { makeInitialDraft } from "./draft";
import {
  canAdvance,
  validateLegs,
  validateRisk,
  validateSetup,
  validateStep,
  validateTiming,
} from "./validation";
import type { StrategyDef } from "./types";

const base = (): StrategyDef => makeInitialDraft(new Date("2026-06-14T00:00:00Z"));

describe("validateSetup", () => {
  it("passes on the default draft", () => {
    expect(validateSetup(base()).ok).toBe(true);
  });

  it("blocks an inverted date range", () => {
    const s = base();
    s.market.dateRange = { start: "2026-06-14", end: "2026-01-01" };
    const v = validateSetup(s);
    expect(v.ok).toBe(false);
    expect(v.errors.length).toBeGreaterThan(0);
  });
});

describe("validateLegs — advance gating", () => {
  it("BLOCKS advance when there are no enabled legs", () => {
    const s = base();
    s.legs = s.legs.map((l) => ({ ...l, enabled: false }));
    const v = validateLegs(s);
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toMatch(/at least one leg/i);
    expect(canAdvance("legs", s)).toBe(false);
  });

  it("ALLOWS advance with one valid leg", () => {
    const s = base();
    expect(validateLegs(s).ok).toBe(true);
    expect(canAdvance("legs", s)).toBe(true);
  });

  it("warns (but does not block) on an unhedged short", () => {
    const s = base(); // default = two short legs, no buy hedge
    const v = validateLegs(s);
    expect(v.ok).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/unlimited risk/i);
  });

  it("flags an EXACT strike off the index grid", () => {
    const s = base();
    s.legs = [{ ...s.legs[0]!, strike: { mode: "EXACT", strike: 24525 } }]; // NIFTY step 50
    const v = validateLegs(s);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/multiple of 50/i);
  });
});

describe("validateTiming", () => {
  it("passes default 09:20 → 15:15", () => {
    expect(validateTiming(base()).ok).toBe(true);
  });

  it("blocks entry >= exit", () => {
    const s = base();
    s.timing = { ...s.timing, entryTime: "15:20", exitTime: "09:20" };
    expect(validateTiming(s).ok).toBe(false);
  });
});

describe("validateRisk", () => {
  it("passes with no stops but warns naked-short", () => {
    const v = validateRisk(base());
    expect(v.ok).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/no overall stop/i);
  });

  it("clears the naked-short warning once an overall stop is set", () => {
    const s = base();
    s.risk = { ...s.risk, stopLoss: { unit: "rupees", value: 10000 } };
    const v = validateRisk(s);
    expect(v.ok).toBe(true);
    expect(v.warnings.length).toBe(0);
  });
});

describe("validateStep dispatch + review", () => {
  it("review fails when any earlier step is invalid", () => {
    const s = base();
    s.legs = s.legs.map((l) => ({ ...l, enabled: false }));
    expect(validateStep("review", s).ok).toBe(false);
  });
});
