import { describe, expect, it } from "vitest";
import {
  INDEX_META,
  INDEX_SYMBOLS,
  LOT_SIZE,
  STRIKE_STEP,
  isValidStrike,
  lotsToQty,
  nearestStrike,
} from "./instruments";

describe("instrument constants", () => {
  it("has the three indices with correct lot sizes", () => {
    expect(INDEX_SYMBOLS).toEqual(["NIFTY", "BANKNIFTY", "SENSEX"]);
    expect(LOT_SIZE).toEqual({ NIFTY: 75, BANKNIFTY: 35, SENSEX: 20 });
  });

  it("has correct strike steps", () => {
    expect(STRIKE_STEP).toEqual({ NIFTY: 50, BANKNIFTY: 100, SENSEX: 100 });
  });

  it("INDEX_META mirrors the constants", () => {
    for (const s of INDEX_SYMBOLS) {
      expect(INDEX_META[s].lotSize).toBe(LOT_SIZE[s]);
      expect(INDEX_META[s].strikeStep).toBe(STRIKE_STEP[s]);
    }
    expect(INDEX_META.SENSEX.dataStart).toBe("2022-01-01");
  });
});

describe("nearestStrike", () => {
  it("rounds NIFTY to the 50 grid", () => {
    expect(nearestStrike("NIFTY", 24812)).toBe(24800);
    expect(nearestStrike("NIFTY", 24826)).toBe(24850);
  });

  it("rounds ties to the higher strike (deterministic)", () => {
    // 24825 is exactly between 24800 and 24850 → higher.
    expect(nearestStrike("NIFTY", 24825)).toBe(24850);
  });

  it("rounds BANKNIFTY/SENSEX to the 100 grid", () => {
    expect(nearestStrike("BANKNIFTY", 52040)).toBe(52000);
    expect(nearestStrike("SENSEX", 81270)).toBe(81300);
  });
});

describe("isValidStrike", () => {
  it("accepts on-grid strikes, rejects off-grid", () => {
    expect(isValidStrike("NIFTY", 24800)).toBe(true);
    expect(isValidStrike("NIFTY", 24825)).toBe(false);
    expect(isValidStrike("SENSEX", 81300)).toBe(true);
    expect(isValidStrike("SENSEX", 81350)).toBe(false);
    expect(isValidStrike("NIFTY", 0)).toBe(false);
  });
});

describe("lotsToQty", () => {
  it("scales lots by the index lot size", () => {
    expect(lotsToQty("NIFTY", 1)).toBe(75);
    expect(lotsToQty("BANKNIFTY", 3)).toBe(105);
    expect(lotsToQty("SENSEX", 2)).toBe(40);
  });
});
