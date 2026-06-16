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

  it("no liquid strike within range, but above the floor → nearest (low + flagged)", () => {
    // ideal 24250 cov 0.55 — under MIN_COVERAGE (0.6) so not high/medium, but
    // at/above the D2 floor (MIN_FALLBACK_COVERAGE 0.5) so still a legible fill.
    const chain = [ce(24250, 0.55), ce(24300, 0.15)];
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

describe("D2 hard-fail CEILING (07-data-layer §7b)", () => {
  it("(a) a near, well-covered strike still resolves (regression guard)", () => {
    // ideal 24250 cov 0.95 → exact high fill; the ceiling never trips on a
    // healthy strike. This is the "do not over-reject" guard.
    const chain = [ce(24250, 0.95)];
    const r = resolveStrike("NIFTY", chain, "CE", { kind: "atm", offset: 0 }, 24250)!;
    expect(r.served).toBe(24250);
    expect(r.confidence).toBe("high");
  });

  it("(a) a 1-step illiquid-but-fillable substitute still resolves at low", () => {
    // exact 24250 absent; only 24300 (+1 step) at cov 0.4 exists. 0.4 is below
    // MIN_COVERAGE (0.6) and below ILLIQUID_COVERAGE (0.5) BUT at/above the
    // hard-fail floor MIN_FALLBACK_COVERAGE (0.2) → still a flagged low fill,
    // preserving the §3.2 illiquid-slippage path. (exact intent so the ideal is
    // NOT snapped to the available chain.)
    const chain = [ce(24300, 0.4)];
    const r = resolveStrike("NIFTY", chain, "CE", { kind: "exact", strike: 24250 }, 24250)!;
    expect(r.served).toBe(24300);
    expect(r.confidence).toBe("low");
    expect(r.fallbackSteps).toBe(1);
  });

  it("(b) a substitute BELOW the coverage floor now → null (MISSING_LEG)", () => {
    // Pre-D2 this returned { served: 24250, confidence: "low" }. The only strike
    // present has cov 0.1 < MIN_FALLBACK_COVERAGE (0.2) — near-empty, < 20% of
    // the session printed → REJECTED, not a silent low-confidence fill.
    const chain = [ce(24250, 0.1)];
    expect(resolveStrike("NIFTY", chain, "CE", { kind: "atm", offset: 0 }, 24250)).toBeNull();
  });

  it("(b) a substitute only available FAR away (beyond ±5 steps) → null", () => {
    // exact 24250 requested; nearest existing strike is 24550 = +6 steps
    // (> MAX_FALLBACK_STEPS 5), even though it is fully covered. Too far to
    // fill credibly → MISSING_LEG. (exact intent so ideal stays at 24250.)
    const chain = [ce(24550, 1)];
    expect(resolveStrike("NIFTY", chain, "CE", { kind: "exact", strike: 24250 }, 24250)).toBeNull();
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

  it("D2: no strike within the premium-deviation ceiling → null (MISSING_LEG)", () => {
    // target 100; the closest available price is 30 → deviation 70/100 = 0.70 >
    // MAX_PREMIUM_DEVIATION (0.5). Pre-D2 this filled silently at strike 24300;
    // now it is a MISSING_LEG.
    const chain = [ce(24200, 0.9), ce(24300, 0.9)];
    const prices = new Map([
      [24200, 25],
      [24300, 30],
    ]);
    expect(resolvePremiumStrike("NIFTY", chain, "CE", 100, undefined, prices, 24250)).toBeNull();
  });

  it("D2: a strike just inside the deviation ceiling still resolves", () => {
    // target 100; closest price 60 → deviation 40/100 = 0.40 ≤ 0.5 → kept.
    const chain = [ce(24300, 0.9)];
    const prices = new Map([[24300, 60]]);
    const r = resolvePremiumStrike("NIFTY", chain, "CE", 100, undefined, prices, 24250)!;
    expect(r.served).toBe(24300);
  });
});
