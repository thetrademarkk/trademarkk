import { describe, expect, it } from "vitest";
import { STRIKE_STEP } from "../shared/instruments";
import {
  COVERAGE_FLOOR,
  buildLadder,
  estimateCoverage,
  estimatePremium,
  makeEstimateChain,
  resolveIntentStrike,
} from "./estimate-chain";

describe("makeEstimateChain", () => {
  it("centres ATM on the nearest grid strike", () => {
    const c = makeEstimateChain("NIFTY", 24513);
    expect(c.atm).toBe(24500); // step 50
    expect(c.index).toBe("NIFTY");
  });

  it("has a per-index default spot when none is given", () => {
    expect(makeEstimateChain("BANKNIFTY").atm % STRIKE_STEP.BANKNIFTY).toBe(0);
  });
});

describe("buildLadder", () => {
  const chain = makeEstimateChain("NIFTY", 24500);

  it("builds a symmetric ladder around ATM with the ATM rung marked", () => {
    const rungs = buildLadder(chain, "CE", 5);
    expect(rungs).toHaveLength(11); // -5..+5
    const atm = rungs.find((r) => r.isAtm)!;
    expect(atm.offset).toBe(0);
    expect(atm.strike).toBe(24500);
  });

  it("offsets map to real grid strikes", () => {
    const rungs = buildLadder(chain, "PE", 3);
    const plus2 = rungs.find((r) => r.offset === 2)!;
    expect(plus2.strike).toBe(24500 + 2 * STRIKE_STEP.NIFTY);
  });

  it("every rung carries an estimated premium ≥ one tick and a coverage in [0,1]", () => {
    for (const r of buildLadder(chain, "CE")) {
      expect(r.premium).toBeGreaterThanOrEqual(0.05);
      expect(r.coverage).toBeGreaterThanOrEqual(0);
      expect(r.coverage).toBeLessThanOrEqual(1);
      expect(r.thin).toBe(r.coverage <= COVERAGE_FLOOR);
    }
  });

  it("is deterministic — same inputs, same rungs", () => {
    expect(buildLadder(chain, "CE")).toEqual(buildLadder(chain, "CE"));
  });
});

describe("estimatePremium", () => {
  it("an ATM call has only time value (no intrinsic)", () => {
    const atm = estimatePremium("NIFTY", "CE", 24500, 24500);
    expect(atm).toBeGreaterThan(0);
    // Deep-OTM premium decays below ATM premium.
    const otm = estimatePremium("NIFTY", "CE", 24500 + 10 * 50, 24500);
    expect(otm).toBeLessThan(atm);
  });

  it("an ITM call carries intrinsic value", () => {
    const itm = estimatePremium("NIFTY", "CE", 24000, 24500); // 500 in the money
    expect(itm).toBeGreaterThanOrEqual(500);
  });
});

describe("estimateCoverage honesty", () => {
  it("is highest at ATM and decays outward", () => {
    expect(estimateCoverage("NIFTY", 0)).toBeGreaterThan(estimateCoverage("NIFTY", 5));
  });

  it("SENSEX is the worst-covered index at ATM", () => {
    expect(estimateCoverage("SENSEX", 0)).toBeLessThan(estimateCoverage("NIFTY", 0));
  });
});

describe("resolveIntentStrike", () => {
  const chain = makeEstimateChain("NIFTY", 24500);

  it("ATM_OFFSET resolves to atm + steps×step", () => {
    expect(resolveIntentStrike("NIFTY", "CE", { mode: "ATM_OFFSET", steps: 2 }, chain)).toBe(24600);
  });

  it("EXACT resolves to the entered strike", () => {
    expect(resolveIntentStrike("NIFTY", "CE", { mode: "EXACT", strike: 24350 }, chain)).toBe(24350);
  });

  it("PERCENT resolves to a grid strike near spot×(1+pct)", () => {
    const r = resolveIntentStrike("NIFTY", "CE", { mode: "PERCENT", pct: 1 }, chain)!;
    expect(r % STRIKE_STEP.NIFTY).toBe(0);
    expect(r).toBeGreaterThan(24500);
  });

  it("PREMIUM picks the strike whose estimated premium is closest to the target", () => {
    const atmPrem = estimatePremium("NIFTY", "CE", 24500, 24500);
    const r = resolveIntentStrike("NIFTY", "CE", { mode: "PREMIUM", target: atmPrem }, chain);
    expect(r).toBe(24500);
  });
});
