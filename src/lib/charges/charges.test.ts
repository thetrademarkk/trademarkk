import { describe, expect, it } from "vitest";
import { computeCharges, computeGrossPnl, computeRMultiple } from "./charges";
import { getChargeProfile } from "@/config/brokers";

const zerodha = getChargeProfile("zerodha");

describe("computeGrossPnl", () => {
  it("long: profit when exit > entry", () => {
    expect(computeGrossPnl({ direction: "long", qty: 75, entryPrice: 100, exitPrice: 120 })).toBe(1500);
  });
  it("short: profit when exit < entry", () => {
    expect(computeGrossPnl({ direction: "short", qty: 75, entryPrice: 100, exitPrice: 80 })).toBe(1500);
  });
  it("long: loss when exit < entry", () => {
    expect(computeGrossPnl({ direction: "long", qty: 50, entryPrice: 200, exitPrice: 180 })).toBe(-1000);
  });
});

describe("computeCharges (options)", () => {
  const trade = { segment: "OPT" as const, qty: 75, entryPrice: 100, exitPrice: 120, direction: "long" as const };
  const breakdown = computeCharges(zerodha, trade);

  it("charges flat ₹20 brokerage per order (2 orders)", () => {
    expect(breakdown.brokerage).toBe(40);
  });
  it("applies STT only on the sell-side premium (0.1%)", () => {
    // sell turnover = 120 * 75 = 9000 → 0.1% = 9
    expect(breakdown.stt).toBeCloseTo(9, 2);
  });
  it("applies stamp duty only on the buy side", () => {
    // buy turnover = 100 * 75 = 7500 → 0.003% = 0.23
    expect(breakdown.stampDuty).toBeCloseTo(0.23, 2);
  });
  it("total = sum of components", () => {
    const sum =
      breakdown.brokerage + breakdown.stt + breakdown.exchange + breakdown.sebi + breakdown.gst + breakdown.stampDuty;
    expect(breakdown.total).toBeCloseTo(sum, 1);
  });
});

describe("computeCharges (equity intraday)", () => {
  it("uses percentage brokerage cap when lower than flat", () => {
    // tiny turnover → 0.03% beats ₹20 flat
    const b = computeCharges(zerodha, { segment: "EQ", qty: 1, entryPrice: 100, exitPrice: 101, direction: "long" });
    expect(b.brokerage).toBeLessThan(40);
  });
});

describe("computeRMultiple", () => {
  it("computes +2R when reward = 2x risk", () => {
    expect(
      computeRMultiple({ direction: "long", entryPrice: 100, exitPrice: 120, plannedEntry: 100, plannedSl: 90 })
    ).toBe(2);
  });
  it("computes -1R at stop loss", () => {
    expect(
      computeRMultiple({ direction: "long", entryPrice: 100, exitPrice: 90, plannedEntry: 100, plannedSl: 90 })
    ).toBe(-1);
  });
  it("handles shorts", () => {
    expect(
      computeRMultiple({ direction: "short", entryPrice: 100, exitPrice: 90, plannedEntry: 100, plannedSl: 105 })
    ).toBe(2);
  });
  it("returns null without a stop", () => {
    expect(
      computeRMultiple({ direction: "long", entryPrice: 100, exitPrice: 110, plannedEntry: null, plannedSl: null })
    ).toBeNull();
  });
});
