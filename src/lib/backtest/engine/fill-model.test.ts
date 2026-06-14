/**
 * fill-model.ts — adverse slippage, tick snapping, the ≤0 floor, and the
 * liquidity-scaled illiquid bump (D4). Pessimistic always: buys pay up, sells
 * receive less.
 */

import { describe, expect, it } from "vitest";
import { applySlippage, entrySide, exitSide, isIlliquidFill, snapToTick } from "./fill-model";
import type { SlippageConfig } from "./fill-model";

const liquid = { coverage: 0.9, barVolume: 1000 };
const pct = (value: number): SlippageConfig => ({ mode: "percent", value, tickSize: 0.05 });
const ticks = (value: number): SlippageConfig => ({ mode: "ticks", value, tickSize: 0.05 });

describe("slippage direction (always adverse)", () => {
  it("buy pays UP, sell receives LESS (percent)", () => {
    expect(applySlippage(100, pct(0.5), { side: "buy", ...liquid }).fill).toBe(100.5);
    expect(applySlippage(100, pct(0.5), { side: "sell", ...liquid }).fill).toBe(99.5);
  });

  it("ticks mode adds/subtracts ticks × tickSize", () => {
    expect(applySlippage(100, ticks(2), { side: "buy", ...liquid }).fill).toBe(100.1);
    expect(applySlippage(100, ticks(2), { side: "sell", ...liquid }).fill).toBe(99.9);
  });
});

describe("tick snapping + floor", () => {
  it("snaps the slipped price to the nearest tick", () => {
    // 100 × 1.003 = 100.3 → already a tick multiple.
    expect(snapToTick(100.3, 0.05)).toBe(100.3);
    expect(snapToTick(100.32, 0.05)).toBe(100.3);
    expect(snapToTick(100.33, 0.05)).toBe(100.35);
  });

  it("a fill can never go ≤ 0; floors at one tick", () => {
    const r = applySlippage(0.05, pct(99), { side: "sell", ...liquid });
    expect(r.fill).toBeGreaterThanOrEqual(0.05);
  });
});

describe("liquidity-scaled bump (D4)", () => {
  it("low coverage (<0.5) triggers the ×3 bump and the illiquid flag", () => {
    const r = applySlippage(100, pct(1), { side: "buy", coverage: 0.4, barVolume: 100 });
    expect(r.illiquid).toBe(true);
    expect(r.fill).toBe(103); // 100 × (1 + 0.01×3)
  });

  it("a zero-volume fill bar triggers the bump even at good coverage", () => {
    const r = applySlippage(100, pct(1), { side: "sell", coverage: 0.9, barVolume: 0 });
    expect(r.illiquid).toBe(true);
    expect(r.fill).toBe(97); // 100 × (1 - 0.03)
  });

  it("liquid fill takes no bump", () => {
    const r = applySlippage(100, pct(1), { side: "buy", ...liquid });
    expect(r.illiquid).toBe(false);
    expect(r.fill).toBe(101);
  });

  it("isIlliquidFill predicate", () => {
    expect(isIlliquidFill(0.49, 1000)).toBe(true);
    expect(isIlliquidFill(0.9, 0)).toBe(true);
    expect(isIlliquidFill(0.9, 1000)).toBe(false);
  });
});

describe("side mapping", () => {
  it("entry/exit sides invert by direction", () => {
    expect(entrySide("long")).toBe("buy");
    expect(entrySide("short")).toBe("sell");
    expect(exitSide("long")).toBe("sell");
    expect(exitSide("short")).toBe("buy");
  });
});
