import { describe, expect, it } from "vitest";
import { LOT_SIZE } from "../shared/instruments";
import { makeEstimateChain, estimatePremium } from "./estimate-chain";
import { buildPayoffSummary, resolvePreviewLeg } from "./payoff-rail";
import type { LegDef, StrategyDef } from "./types";

const NIFTY_LOT = LOT_SIZE.NIFTY; // 75
const chain = makeEstimateChain("NIFTY", 24500); // atm 24500

function leg(partial: Partial<LegDef> & Pick<LegDef, "id" | "optionType" | "side">): LegDef {
  return {
    enabled: true,
    lots: 1,
    strike: { mode: "ATM_OFFSET", steps: 0 },
    expiry: "WEEKLY",
    squareOff: "partial",
    ...partial,
  };
}

function strategy(legs: LegDef[]): Pick<StrategyDef, "legs"> & { market: { symbol: "NIFTY" } } {
  return { legs, market: { symbol: "NIFTY" } };
}

describe("resolvePreviewLeg", () => {
  it("scales qty by the index lot size and uses the estimated premium", () => {
    const pv = resolvePreviewLeg("NIFTY", leg({ id: "a", optionType: "CE", side: "sell" }), chain)!;
    expect(pv.strike).toBe(24500);
    expect(pv.payoff.qty).toBe(NIFTY_LOT);
    expect(pv.payoff.direction).toBe("short");
    expect(pv.premium).toBeCloseTo(estimatePremium("NIFTY", "CE", 24500, 24500), 6);
  });

  it("returns null for a disabled leg", () => {
    const l = leg({ id: "a", optionType: "CE", side: "sell", enabled: false });
    expect(resolvePreviewLeg("NIFTY", l, chain)).toBeNull();
  });
});

describe("buildPayoffSummary — short straddle (hand-computed)", () => {
  const ce = estimatePremium("NIFTY", "CE", 24500, 24500);
  const pe = estimatePremium("NIFTY", "PE", 24500, 24500);
  const totalPremPerUnit = ce + pe;

  const summary = buildPayoffSummary(
    strategy([
      leg({ id: "ce", optionType: "CE", side: "sell" }),
      leg({ id: "pe", optionType: "PE", side: "sell" }),
    ]),
    chain
  );

  it("auto-labels a Short Straddle", () => {
    expect(summary.label).toBe("Short Straddle");
  });

  it("max profit = total premium collected × qty at the strike", () => {
    // Both legs are short → max profit when S = K (both expire worthless to the buyer).
    const expectedMaxProfit = Math.round(totalPremPerUnit * NIFTY_LOT * 100) / 100;
    expect(summary.curve.maxProfit).toBeCloseTo(expectedMaxProfit, 1);
  });

  it("loss is unbounded (naked short call) and net credit is positive", () => {
    expect(summary.curve.lossUnbounded).toBe(true);
    expect(summary.netCredit).toBeGreaterThan(0);
    // Net credit = total premium × qty (both legs short).
    expect(summary.netCredit).toBeCloseTo(totalPremPerUnit * NIFTY_LOT, 1);
  });

  it("breakevens straddle the strike at K ± total premium/unit", () => {
    expect(summary.curve.breakevens).toHaveLength(2);
    const [lo, hi] = summary.curve.breakevens;
    expect(lo!).toBeCloseTo(24500 - totalPremPerUnit, 0);
    expect(hi!).toBeCloseTo(24500 + totalPremPerUnit, 0);
  });
});

describe("buildPayoffSummary — bull call spread (defined risk)", () => {
  const summary = buildPayoffSummary(
    strategy([
      leg({ id: "long", optionType: "CE", side: "buy", strike: { mode: "ATM_OFFSET", steps: 0 } }),
      leg({
        id: "short",
        optionType: "CE",
        side: "sell",
        strike: { mode: "ATM_OFFSET", steps: 2 },
      }),
    ]),
    chain
  );

  it("auto-labels a Bull Call Spread", () => {
    expect(summary.label).toBe("Bull Call Spread");
  });

  it("has bounded max profit AND bounded max loss (defined-risk)", () => {
    expect(summary.curve.profitUnbounded).toBe(false);
    expect(summary.curve.lossUnbounded).toBe(false);
    expect(Number.isFinite(summary.curve.maxProfit)).toBe(true);
    expect(Number.isFinite(summary.curve.maxLoss)).toBe(true);
  });

  it("is a net debit (long the cheaper-to-own near call, short a further one)", () => {
    // Buying the lower-strike (pricier) call and selling a higher one → net debit.
    expect(summary.netCredit).toBeLessThan(0);
  });
});

describe("buildPayoffSummary — empty / single leg", () => {
  it("reports no legs when all are disabled", () => {
    const s = buildPayoffSummary(
      strategy([leg({ id: "a", optionType: "CE", side: "sell", enabled: false })]),
      chain
    );
    expect(s.hasLegs).toBe(false);
    expect(s.curve.points).toHaveLength(0);
  });
});
