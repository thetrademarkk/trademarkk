import { describe, expect, it } from "vitest";
import {
  intrinsicValue,
  legPayoffAt,
  strategyPayoffAt,
  buildPayoffCurve,
  classifyStrategy,
  daysToExpiry,
  dteBucketKey,
  type PayoffLeg,
  type LegShape,
} from "./payoff";

const leg = (
  p: Partial<PayoffLeg> & Pick<PayoffLeg, "strike" | "optionType" | "direction">
): PayoffLeg => ({
  qty: 1,
  premium: 0,
  ...p,
});

describe("intrinsicValue", () => {
  it("calls pay max(S - K, 0)", () => {
    expect(intrinsicValue("CE", 100, 120)).toBe(20);
    expect(intrinsicValue("CE", 100, 80)).toBe(0);
    expect(intrinsicValue("CE", 100, 100)).toBe(0);
  });
  it("puts pay max(K - S, 0)", () => {
    expect(intrinsicValue("PE", 100, 80)).toBe(20);
    expect(intrinsicValue("PE", 100, 120)).toBe(0);
    expect(intrinsicValue("PE", 100, 100)).toBe(0);
  });
});

describe("legPayoffAt — long/short CE/PE per unit scaled by qty", () => {
  it("long call: -premium below strike, intrinsic-premium above", () => {
    const l = leg({ strike: 100, optionType: "CE", direction: "long", premium: 10, qty: 50 });
    expect(legPayoffAt(l, 90)).toBe(-10 * 50); // expires worthless, lose premium
    expect(legPayoffAt(l, 110)).toBe((10 - 10) * 50); // intrinsic 10 = premium → breakeven
    expect(legPayoffAt(l, 130)).toBe((30 - 10) * 50); // +20 per unit
  });
  it("short call: +premium below strike, premium-intrinsic above (loss runs)", () => {
    const l = leg({ strike: 100, optionType: "CE", direction: "short", premium: 10, qty: 50 });
    expect(legPayoffAt(l, 90)).toBe(10 * 50); // keep premium
    expect(legPayoffAt(l, 130)).toBe((10 - 30) * 50); // -20 per unit
  });
  it("long put: -premium above strike, gain as S falls", () => {
    const l = leg({ strike: 100, optionType: "PE", direction: "long", premium: 8, qty: 25 });
    expect(legPayoffAt(l, 120)).toBe(-8 * 25);
    expect(legPayoffAt(l, 80)).toBe((20 - 8) * 25);
  });
  it("short put: +premium above strike, loss as S falls", () => {
    const l = leg({ strike: 100, optionType: "PE", direction: "short", premium: 8, qty: 25 });
    expect(legPayoffAt(l, 120)).toBe(8 * 25);
    expect(legPayoffAt(l, 80)).toBe((8 - 20) * 25);
  });
});

describe("strategyPayoffAt", () => {
  it("sums all legs", () => {
    const legs: PayoffLeg[] = [
      leg({ strike: 100, optionType: "CE", direction: "long", premium: 5, qty: 10 }),
      leg({ strike: 100, optionType: "PE", direction: "long", premium: 5, qty: 10 }),
    ];
    // At S=100 both expire worthless → lose both premiums = -100.
    expect(strategyPayoffAt(legs, 100)).toBe(-100);
    // At S=130: call intrinsic 30, put 0 → (30-5)*10 + (-5)*10 = 250 - 50 = 200.
    expect(strategyPayoffAt(legs, 130)).toBe(200);
  });
});

describe("buildPayoffCurve — long straddle", () => {
  // Long ATM straddle: long 100 CE @5 + long 100 PE @5, qty 1.
  const legs: PayoffLeg[] = [
    leg({ strike: 100, optionType: "CE", direction: "long", premium: 5, qty: 1 }),
    leg({ strike: 100, optionType: "PE", direction: "long", premium: 5, qty: 1 }),
  ];
  const curve = buildPayoffCurve(legs);

  it("max loss at the strike = total premium paid", () => {
    // Net premium = 10; max loss = -10 (at S=100).
    expect(curve.maxLoss).toBe(-10);
  });
  it("breakevens at strike ± total premium", () => {
    expect(curve.breakevens).toEqual([90, 110]);
  });
  it("profit is unbounded (net long calls + long puts)", () => {
    expect(curve.profitUnbounded).toBe(true);
    expect(curve.maxProfit).toBe(Infinity);
  });
});

describe("buildPayoffCurve — short strangle", () => {
  // Short 110 CE @4 + short 90 PE @4, qty 1.
  const legs: PayoffLeg[] = [
    leg({ strike: 110, optionType: "CE", direction: "short", premium: 4, qty: 1 }),
    leg({ strike: 90, optionType: "PE", direction: "short", premium: 4, qty: 1 }),
  ];
  const curve = buildPayoffCurve(legs);

  it("max profit between strikes = premium collected (8)", () => {
    expect(curve.maxProfit).toBe(8);
  });
  it("breakevens at 110+8 and 90-8", () => {
    expect(curve.breakevens).toEqual([82, 118]);
  });
  it("loss is unbounded above (net short calls)", () => {
    expect(curve.lossUnbounded).toBe(true);
    expect(curve.maxLoss).toBe(-Infinity);
  });
});

describe("buildPayoffCurve — bull call spread (bounded both sides)", () => {
  // Long 100 CE @8, short 110 CE @3. Net debit 5. Width 10.
  const legs: PayoffLeg[] = [
    leg({ strike: 100, optionType: "CE", direction: "long", premium: 8, qty: 1 }),
    leg({ strike: 110, optionType: "CE", direction: "short", premium: 3, qty: 1 }),
  ];
  const curve = buildPayoffCurve(legs);

  it("max profit = width - net debit = 5", () => {
    expect(curve.maxProfit).toBe(5);
    expect(curve.profitUnbounded).toBe(false);
  });
  it("max loss = net debit = -5", () => {
    expect(curve.maxLoss).toBe(-5);
    expect(curve.lossUnbounded).toBe(false);
  });
  it("single breakeven at 100 + net debit = 105", () => {
    expect(curve.breakevens).toEqual([105]);
  });
});

describe("buildPayoffCurve — single long put (CORR-01: bounded upside)", () => {
  // Long 100 PE @5, qty 1. A long put's profit is bounded at (K − premium)·qty
  // (the underlying can only fall to 0), so max profit is 95 — NOT Infinity.
  const legs: PayoffLeg[] = [
    leg({ strike: 100, optionType: "PE", direction: "long", premium: 5, qty: 1 }),
  ];
  const curve = buildPayoffCurve(legs);

  it("profit is NOT unbounded (only long calls are)", () => {
    expect(curve.profitUnbounded).toBe(false);
  });
  it("max profit = (strike − premium)·qty at S=0", () => {
    expect(curve.maxProfit).toBe(95); // (100 − 5) · 1
  });
  it("max loss = premium paid (at/above the strike)", () => {
    expect(curve.maxLoss).toBe(-5);
    expect(curve.lossUnbounded).toBe(false);
  });
  it("breakeven at strike − premium = 95", () => {
    expect(curve.breakevens).toEqual([95]);
  });
  it("scales the bounded max profit by qty (CORR-01 golden)", () => {
    const scaled = buildPayoffCurve([
      leg({ strike: 100, optionType: "PE", direction: "long", premium: 5, qty: 50 }),
    ]);
    expect(scaled.profitUnbounded).toBe(false);
    expect(scaled.maxProfit).toBe(95 * 50); // (strike − premium)·qty
  });
});

describe("buildPayoffCurve — single short put (CORR-06: max loss sampled to S=0)", () => {
  // Short 100 PE @5, qty 1. Max loss occurs at S=0: −(strike − premium)·qty
  // = −95. The old sampler floored `lo` ~20% above centre and never reached
  // S=0, understating the loss; the range now extends to 0 for put-bearing books.
  const legs: PayoffLeg[] = [
    leg({ strike: 100, optionType: "PE", direction: "short", premium: 5, qty: 1 }),
  ];
  const curve = buildPayoffCurve(legs);

  it("samples down to S=0", () => {
    expect(curve.minUnderlying).toBe(0);
  });
  it("max loss ≈ −(strike − premium)·qty at S=0", () => {
    expect(curve.maxLoss).toBe(-95); // −(100 − 5) · 1
    expect(curve.lossUnbounded).toBe(false);
  });
  it("max profit = premium collected (at/above the strike)", () => {
    expect(curve.maxProfit).toBe(5);
    expect(curve.profitUnbounded).toBe(false);
  });
  it("breakeven at strike − premium = 95", () => {
    expect(curve.breakevens).toEqual([95]);
  });
  it("scales the bounded max loss by qty (CORR-06 golden)", () => {
    const scaled = buildPayoffCurve([
      leg({ strike: 100, optionType: "PE", direction: "short", premium: 5, qty: 25 }),
    ]);
    expect(scaled.maxLoss).toBe(-95 * 25); // −(strike − premium)·qty
    expect(scaled.lossUnbounded).toBe(false);
  });
});

describe("classifyStrategy", () => {
  const L = (
    strike: number,
    optionType: "CE" | "PE",
    direction: "long" | "short",
    qty = 1
  ): LegShape => ({
    strike,
    optionType,
    direction,
    qty,
  });

  it("single legs", () => {
    expect(classifyStrategy([L(100, "CE", "long")])).toBe("Long Call");
    expect(classifyStrategy([L(100, "CE", "short")])).toBe("Short Call");
    expect(classifyStrategy([L(100, "PE", "long")])).toBe("Long Put");
    expect(classifyStrategy([L(100, "PE", "short")])).toBe("Short Put");
  });

  it("straddle vs strangle (long)", () => {
    expect(classifyStrategy([L(100, "CE", "long"), L(100, "PE", "long")])).toBe("Straddle");
    expect(classifyStrategy([L(110, "CE", "long"), L(90, "PE", "long")])).toBe("Strangle");
  });

  it("short straddle / strangle", () => {
    expect(classifyStrategy([L(100, "CE", "short"), L(100, "PE", "short")])).toBe("Short Straddle");
    expect(classifyStrategy([L(110, "CE", "short"), L(90, "PE", "short")])).toBe("Short Strangle");
  });

  it("vertical call spreads (bull = long lower strike)", () => {
    expect(classifyStrategy([L(100, "CE", "long"), L(110, "CE", "short")])).toBe(
      "Bull Call Spread"
    );
    expect(classifyStrategy([L(110, "CE", "long"), L(100, "CE", "short")])).toBe(
      "Bear Call Spread"
    );
  });

  it("vertical put spreads (bull = long lower strike)", () => {
    expect(classifyStrategy([L(90, "PE", "long"), L(100, "PE", "short")])).toBe("Bull Put Spread");
    expect(classifyStrategy([L(100, "PE", "long"), L(90, "PE", "short")])).toBe("Bear Put Spread");
  });

  it("ratio spreads when leg quantities differ", () => {
    expect(classifyStrategy([L(100, "CE", "long", 1), L(110, "CE", "short", 2)])).toBe(
      "Call Ratio Spread"
    );
    expect(classifyStrategy([L(100, "PE", "long", 1), L(90, "PE", "short", 2)])).toBe(
      "Put Ratio Spread"
    );
  });

  it("iron condor (different short strikes) vs butterfly (same short strikes)", () => {
    const condor: LegShape[] = [
      L(95, "PE", "short"),
      L(90, "PE", "long"),
      L(105, "CE", "short"),
      L(110, "CE", "long"),
    ];
    expect(classifyStrategy(condor)).toBe("Iron Condor");
    const fly: LegShape[] = [
      L(100, "PE", "short"),
      L(90, "PE", "long"),
      L(100, "CE", "short"),
      L(110, "CE", "long"),
    ];
    expect(classifyStrategy(fly)).toBe("Iron Butterfly");
  });

  it("unrecognised shapes are Custom", () => {
    // Long call + short put (a synthetic) is not in the vanilla catalogue.
    expect(classifyStrategy([L(100, "CE", "long"), L(100, "PE", "short")])).toBe("Custom");
    expect(classifyStrategy([])).toBe("Custom");
  });
});

describe("daysToExpiry + dteBucketKey", () => {
  it("same-day = 0 (expiry day)", () => {
    expect(daysToExpiry("2026-06-13T10:00:00Z", "2026-06-13")).toBe(0);
    expect(dteBucketKey(0)).toBe("0DTE");
  });
  it("counts calendar days regardless of intraday time", () => {
    expect(daysToExpiry("2026-06-13T15:30:00Z", "2026-06-20")).toBe(7);
    expect(dteBucketKey(7)).toBe("3–7");
  });
  it("null expiry → null", () => {
    expect(daysToExpiry("2026-06-13T10:00:00Z", null)).toBeNull();
  });
  it("negative (data error) → null", () => {
    expect(daysToExpiry("2026-06-20T10:00:00Z", "2026-06-13")).toBeNull();
  });
  it("bucket boundaries", () => {
    expect(dteBucketKey(1)).toBe("1–2");
    expect(dteBucketKey(2)).toBe("1–2");
    expect(dteBucketKey(3)).toBe("3–7");
    expect(dteBucketKey(8)).toBe("8–30");
    expect(dteBucketKey(30)).toBe("8–30");
    expect(dteBucketKey(31)).toBe(">30");
    expect(dteBucketKey(365)).toBe(">30");
  });
});
