/**
 * resolve-strike.ts — the coverage-honesty differentiator. Tests the §8.3
 * fallback ladder thoroughly: ideal-with-coverage (high), fallback to a nearer
 * liquid strike (medium), any-coverage nearest (low + LOW_LIQUIDITY), and the
 * no-strike → null (MISSING_LEG) terminal.
 */

import { describe, expect, it } from "vitest";
import {
  atmStrike,
  nearestAvailableStrike,
  resolvePremiumStrike,
  resolveStrike,
} from "./resolve-strike";
import type { ContractMeta } from "./types";

const ce = (strike: number, coverage: number, medVol = 1000): ContractMeta => ({
  strike,
  optionType: "CE",
  coverage,
  medVol,
});

describe("nearest / ATM", () => {
  it("nearest ties round to the HIGHER strike (deterministic)", () => {
    const chain = [ce(24200, 1), ce(24300, 1)];
    expect(nearestAvailableStrike(chain, 24250)).toBe(24300); // equidistant → higher
  });

  it("ATM picks the nearest available union strike", () => {
    const chain = [ce(24200, 1), ce(24250, 1), ce(24300, 1)];
    expect(atmStrike(chain, 24237)).toBe(24250);
  });
});

describe("fallback ladder", () => {
  it("ideal strike with coverage ≥ 0.6 → high confidence, 0 fallback steps", () => {
    const chain = [ce(24250, 0.95)];
    const r = resolveStrike("NIFTY", chain, "CE", { kind: "atm", offset: 0 }, 24250)!;
    expect(r.served).toBe(24250);
    expect(r.confidence).toBe("high");
    expect(r.fallbackSteps).toBe(0);
  });

  it("ideal under-covered → fall back to nearest liquid strike (medium)", () => {
    // ideal 24250 cov 0.2 (bad); 24300 cov 0.71 (good, +1 step); 24200 absent.
    const chain = [ce(24250, 0.2), ce(24300, 0.71)];
    const r = resolveStrike("NIFTY", chain, "CE", { kind: "atm", offset: 0 }, 24250)!;
    expect(r.requested).toBe(24250);
    expect(r.served).toBe(24300);
    expect(r.confidence).toBe("medium");
    expect(r.fallbackSteps).toBe(1);
  });

  it("on a tie, fall back to the HIGHER strike", () => {
    // both ±1 step liquid; the up side (24300) must win.
    const chain = [ce(24250, 0.2), ce(24300, 0.8), ce(24200, 0.8)];
    const r = resolveStrike("NIFTY", chain, "CE", { kind: "atm", offset: 0 }, 24250)!;
    expect(r.served).toBe(24300);
  });

  it("no liquid strike within range → nearest at any coverage (low + flagged)", () => {
    const chain = [ce(24250, 0.1), ce(24300, 0.15)];
    const r = resolveStrike("NIFTY", chain, "CE", { kind: "atm", offset: 0 }, 24250)!;
    expect(r.confidence).toBe("low");
    expect(r.served).toBe(24250); // nearest to ideal
  });

  it("no strikes at all on that side → null (MISSING_LEG)", () => {
    const chain = [ce(24250, 1)]; // only CE; resolving a PE → null
    expect(resolveStrike("NIFTY", chain, "PE", { kind: "atm", offset: 0 }, 24250)).toBeNull();
  });

  it("ATM offset shifts the ideal strike by offset × step", () => {
    const chain = [ce(24250, 1), ce(24350, 1)];
    const r = resolveStrike("NIFTY", chain, "CE", { kind: "atm", offset: 2 }, 24250)!;
    expect(r.requested).toBe(24350); // 24250 + 2×50
    expect(r.served).toBe(24350);
  });

  it("PERCENT selector snaps to the grid", () => {
    const chain = [ce(24500, 1)];
    // +1% of 24250 = 24492.5 → snap to 24500.
    const r = resolveStrike("NIFTY", chain, "CE", { kind: "pct", pct: 1 }, 24250)!;
    expect(r.requested).toBe(24500);
  });

  it("EXACT selector resolves to the given strike if present", () => {
    const chain = [ce(24500, 0.9)];
    const r = resolveStrike("NIFTY", chain, "CE", { kind: "exact", strike: 24500 }, 24250)!;
    expect(r.served).toBe(24500);
    expect(r.confidence).toBe("high");
  });
});

describe("premium selection (§8.4)", () => {
  it("picks the strike whose entry price is closest to the target premium", () => {
    const chain = [ce(24200, 0.9), ce(24250, 0.9), ce(24300, 0.9)];
    const prices = new Map([
      [24200, 150],
      [24250, 100],
      [24300, 60],
    ]);
    const r = resolvePremiumStrike("NIFTY", chain, "CE", 105, undefined, prices, 24250)!;
    expect(r.served).toBe(24250); // 100 is closest to 105
    expect(r.confidence).toBe("medium"); // estimated/premium never "high"
  });

  it("respects a premium band", () => {
    const chain = [ce(24200, 0.9), ce(24300, 0.9)];
    const prices = new Map([
      [24200, 150],
      [24300, 60],
    ]);
    // band excludes 150 → must pick 60.
    const r = resolvePremiumStrike("NIFTY", chain, "CE", 100, { min: 50, max: 80 }, prices, 24250)!;
    expect(r.served).toBe(24300);
  });
});
