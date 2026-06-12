import { describe, expect, it } from "vitest";
import { PROFILE_ACCENTS, accentById, coverGradient, isAccentId, swatchGradient } from "./accents";

describe("PROFILE_ACCENTS", () => {
  it("ids are unique, lowercase slugs", () => {
    const ids = PROFILE_ACCENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+$/);
  });

  it("every colour is a 6-digit hex (alpha is applied separately)", () => {
    for (const a of PROFILE_ACCENTS) {
      expect(a.from).toMatch(/^#[0-9a-f]{6}$/);
      expect(a.to).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("isAccentId / accentById", () => {
  it("accepts every preset id", () => {
    for (const a of PROFILE_ACCENTS) {
      expect(isAccentId(a.id)).toBe(true);
      expect(accentById(a.id)).toEqual(a);
    }
  });

  it("rejects unknown / empty / hex-injection values", () => {
    expect(isAccentId("magenta")).toBe(false);
    expect(isAccentId("#ff0000")).toBe(false);
    expect(isAccentId("")).toBe(false);
    expect(accentById("nope")).toBeNull();
    expect(accentById(null)).toBeNull();
    expect(accentById(undefined)).toBeNull();
    expect(accentById("")).toBeNull();
  });
});

describe("coverGradient", () => {
  const ocean = accentById("ocean")!;

  it("renders a low-alpha linear gradient by default (35% = 0x59)", () => {
    expect(coverGradient(ocean)).toBe("linear-gradient(120deg, #0284c759, #6366f159)");
  });

  it("clamps alpha into 0..1", () => {
    expect(coverGradient(ocean, 5)).toContain("#0284c7ff");
    expect(coverGradient(ocean, -2)).toContain("#0284c700");
  });

  it("pads single-digit alpha hex", () => {
    // 0.05 * 255 ≈ 13 → "0d" (must stay 2 digits or the colour breaks)
    expect(coverGradient(ocean, 0.05)).toContain("#0284c70d");
  });
});

describe("swatchGradient", () => {
  it("is full strength (no alpha suffix)", () => {
    const ember = accentById("ember")!;
    expect(swatchGradient(ember)).toBe("linear-gradient(135deg, #ea580c, #dc2626)");
  });
});
