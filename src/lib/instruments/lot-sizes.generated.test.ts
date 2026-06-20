import { describe, it, expect } from "vitest";
import { GENERATED_LOTS } from "./lot-sizes.generated";
import { LOT_SIZE_REFERENCE, lookupLotSize, defaultLotSize } from "./lot-sizes";

/**
 * The generated long-tail (NSE/BSE stock-F&O + MCX commodity minis from the Groww
 * instrument master) must EXTEND coverage without disturbing the hand-curated
 * values, and every generated entry must be a clean, well-formed reference row.
 */
describe("generated lot-size coverage", () => {
  it("adds a large authoritative long tail (hundreds of contracts)", () => {
    expect(GENERATED_LOTS.length).toBeGreaterThan(150);
    // The combined reference is now broad, not a 50-symbol stub.
    expect(LOT_SIZE_REFERENCE.length).toBeGreaterThan(200);
  });

  it("every generated entry is a clean OPT-stock or COMM-commodity row", () => {
    for (const e of GENERATED_LOTS) {
      expect(e.symbol).toMatch(/^[A-Z][A-Z0-9&-]*$/);
      expect(e.symbol).not.toMatch(/TEST|DUMMY/);
      expect(e.lotSize).toBeGreaterThan(0);
      expect(Number.isInteger(e.lotSize)).toBe(true);
      if (e.segment === "OPT") expect(["NSE", "BSE"]).toContain(e.exchange);
      else if (e.segment === "COMM") expect(e.exchange).toBe("MCX");
      else throw new Error(`unexpected generated segment ${e.segment} for ${e.symbol}`);
    }
  });

  it("resolves common single-stock F&O underlyings the hand list never had", () => {
    for (const sym of ["ADANIPORTS", "DLF", "TRENT", "VEDL", "PNB"]) {
      const opt = lookupLotSize(sym, "OPT");
      expect(opt, `${sym} OPT`).not.toBeNull();
      expect(opt!.lotSize).toBeGreaterThan(0);
      // FUT shares the same lot as OPT on the same underlying.
      expect(defaultLotSize(sym, "FUT")).toBe(opt!.lotSize);
    }
  });

  it("resolves MCX commodity mini/micro variants", () => {
    expect(defaultLotSize("NATGASMINI", "COMM")).toBeGreaterThan(0);
    expect(defaultLotSize("LEADMINI", "COMM")).toBeGreaterThan(0);
    expect(defaultLotSize("ZINCMINI", "COMM")).toBeGreaterThan(0);
  });

  it("resolves active NCDEX agri commodities (quintals per lot)", () => {
    // NCDEX quotes in ₹/quintal; GUARSEED10 = 10 MT = 100 quintals.
    expect(defaultLotSize("GUARSEED", "COMM")).toBe(100);
    expect(defaultLotSize("GUARGUM", "COMM")).toBe(50);
    expect(defaultLotSize("JEERAUNJHA", "COMM")).toBe(30);
    expect(lookupLotSize("DHANIYA", "COMM")?.exchange).toBe("NCDEX");
    // SEBI-suspended commodities are intentionally absent (not tradable).
    expect(defaultLotSize("CHANA", "COMM")).toBeNull();
    expect(defaultLotSize("WHEAT", "COMM")).toBeNull();
  });

  it("never overrides a hand-curated value (curated wins, additive only)", () => {
    // Curated entries precede GENERATED_LOTS in the first-match-wins map.
    expect(defaultLotSize("RELIANCE", "OPT")).toBe(500);
    expect(defaultLotSize("NIFTY", "OPT")).toBe(65);
    expect(defaultLotSize("GOLD", "COMM")).toBe(100);
    const curated = new Set(["RELIANCE", "NIFTY", "GOLD", "SILVER", "CRUDEOIL"]);
    for (const e of GENERATED_LOTS) expect(curated.has(e.symbol)).toBe(false);
  });
});
