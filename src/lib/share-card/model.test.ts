import { describe, expect, it } from "vitest";
import { rLabel, slugify } from "./model";

describe("slugify", () => {
  it("joins parts and strips unsafe filename characters", () => {
    expect(slugify(["M&M", 1450, "CE"])).toBe("M-M-1450-CE");
  });

  it("drops null/empty parts", () => {
    expect(slugify(["RELIANCE", null, undefined, ""])).toBe("RELIANCE");
  });

  it("collapses runs of specials and trims edge dashes", () => {
    expect(slugify(["  NIFTY 50  ", "24,500"])).toBe("NIFTY-50-24-500");
  });

  it("returns empty string for no usable parts", () => {
    expect(slugify([null, undefined, ""])).toBe("");
  });
});

describe("rLabel", () => {
  it("signs positive values", () => {
    expect(rLabel(1.5)).toBe("+1.5R");
  });

  it("rounds to 2 decimals", () => {
    expect(rLabel(-0.546)).toBe("-0.55R");
    expect(rLabel(0.333333)).toBe("+0.33R");
  });

  it("drops trailing zeros naturally", () => {
    expect(rLabel(2)).toBe("+2R");
    expect(rLabel(-1.1)).toBe("-1.1R");
  });

  it("treats zero as unsigned", () => {
    expect(rLabel(0)).toBe("0R");
  });
});
