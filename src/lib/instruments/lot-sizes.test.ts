import { describe, it, expect } from "vitest";
import {
  LOT_SIZE_REFERENCE,
  LOT_SIZE_AS_OF,
  lookupLotSize,
  defaultLotSize,
  lotSymbolBase,
  segmentUsesLots,
  lotsToUnits,
  unitsToLots,
  exactLotCount,
} from "./lot-sizes";
import { computeCharges } from "@/lib/charges/charges";
import { getChargeProfile } from "@/config/brokers";

describe("lot-size reference data", () => {
  it("every entry has a positive whole lot size, a segment, an exchange and an asOf date", () => {
    expect(LOT_SIZE_REFERENCE.length).toBeGreaterThan(0);
    for (const e of LOT_SIZE_REFERENCE) {
      expect(e.lotSize).toBeGreaterThan(0);
      expect(Number.isInteger(e.lotSize)).toBe(true);
      expect(["FUT", "OPT", "COMM", "CDS"]).toContain(e.segment);
      expect(["NSE", "BSE", "MCX", "NCDEX"]).toContain(e.exchange);
      expect(e.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (e.tickSize !== undefined) expect(e.tickSize).toBeGreaterThan(0);
    }
  });

  it("has no duplicate symbols (single source of truth, one entry per base)", () => {
    const symbols = LOT_SIZE_REFERENCE.map((e) => e.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it("exposes a stable as-of date", () => {
    expect(LOT_SIZE_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // The BT-02 / SEG-08 demo-seed lot sizes — must NOT diverge from this table.
  it("matches the known index lots reused from the seed (NIFTY 65 / BANKNIFTY 35 / SENSEX 20)", () => {
    expect(defaultLotSize("NIFTY", "OPT")).toBe(65);
    expect(defaultLotSize("BANKNIFTY", "OPT")).toBe(35);
    expect(defaultLotSize("SENSEX", "OPT")).toBe(20);
    expect(defaultLotSize("FINNIFTY", "OPT")).toBe(65);
    expect(defaultLotSize("MIDCPNIFTY", "OPT")).toBe(140);
    expect(defaultLotSize("BANKEX", "OPT")).toBe(30);
  });

  it("matches the known MCX commodity lots (GOLD 100 / SILVER 30 / CRUDEOIL 100 / NATURALGAS 1250)", () => {
    expect(defaultLotSize("GOLD", "COMM")).toBe(100);
    expect(defaultLotSize("GOLDM", "COMM")).toBe(10);
    expect(defaultLotSize("SILVER", "COMM")).toBe(30);
    expect(defaultLotSize("SILVERM", "COMM")).toBe(5);
    expect(defaultLotSize("CRUDEOIL", "COMM")).toBe(100);
    expect(defaultLotSize("NATURALGAS", "COMM")).toBe(1250);
    expect(defaultLotSize("COPPER", "COMM")).toBe(2500);
  });

  it("matches the CDS currency lots (USD/EUR/GBP-INR = 1000, JPYINR = 100000)", () => {
    expect(defaultLotSize("USDINR", "CDS")).toBe(1000);
    expect(defaultLotSize("EURINR", "CDS")).toBe(1000);
    expect(defaultLotSize("GBPINR", "CDS")).toBe(1000);
    expect(defaultLotSize("JPYINR", "CDS")).toBe(100000);
  });

  it("provides representative stock-F&O lots that can be overridden", () => {
    expect(defaultLotSize("RELIANCE", "OPT")).toBe(500);
    expect(defaultLotSize("HDFCBANK", "OPT")).toBe(550);
    expect(defaultLotSize("TCS", "OPT")).toBe(175);
    expect(defaultLotSize("INFY", "OPT")).toBe(400);
  });
});

describe("lotSymbolBase normalisation", () => {
  it("uppercases and strips exchange prefixes", () => {
    expect(lotSymbolBase("nse:nifty")).toBe("NIFTY");
    expect(lotSymbolBase("MCX:CRUDEOIL")).toBe("CRUDEOIL");
  });

  it("strips contract suffixes that begin at the first digit", () => {
    expect(lotSymbolBase("CRUDEOIL25JUNFUT")).toBe("CRUDEOIL");
    expect(lotSymbolBase("NIFTY24JUN24500CE")).toBe("NIFTY");
    expect(lotSymbolBase("BANKNIFTY2461352000PE")).toBe("BANKNIFTY");
  });

  it("strips a Fyers -EQ-style trailing series left after the digit strip", () => {
    expect(lotSymbolBase("USDINR24JUN83.5CE")).toBe("USDINR");
  });

  it("returns '' for blank input", () => {
    expect(lotSymbolBase("")).toBe("");
    expect(lotSymbolBase("   ")).toBe("");
  });
});

describe("lookupLotSize segment behaviour", () => {
  it("EQ is never lot-traded — always null", () => {
    expect(lookupLotSize("NIFTY", "EQ")).toBeNull();
    expect(lookupLotSize("RELIANCE", "EQ")).toBeNull();
    expect(defaultLotSize("RELIANCE", "EQ")).toBeNull();
  });

  it("a FUT lookup answers from the (OPT-keyed) index entry — same underlying, same lot", () => {
    // The reference keys index/stock under OPT; a futures trade shares the lot.
    expect(defaultLotSize("NIFTY", "FUT")).toBe(65);
    expect(defaultLotSize("RELIANCE", "FUT")).toBe(500);
    expect(lookupLotSize("NIFTY", "FUT")?.lotSize).toBe(65);
  });

  it("recognises a full contract name, not just the bare base", () => {
    expect(defaultLotSize("NIFTY24JUN24500CE", "OPT")).toBe(65);
    expect(defaultLotSize("MCX:CRUDEOIL25JUNFUT", "COMM")).toBe(100);
    expect(defaultLotSize("USDINR25JUNFUT", "CDS")).toBe(1000);
  });

  it("an unknown symbol returns null (never blocks a trade)", () => {
    expect(lookupLotSize("WHATEVERXYZ", "OPT")).toBeNull();
    expect(defaultLotSize("WHATEVERXYZ", "COMM")).toBeNull();
    expect(defaultLotSize("", "OPT")).toBeNull();
  });

  it("does not cross segments — a commodity base isn't returned for a CDS lookup", () => {
    expect(lookupLotSize("CRUDEOIL", "CDS")).toBeNull();
    expect(lookupLotSize("USDINR", "COMM")).toBeNull();
    // An index symbol isn't a commodity.
    expect(lookupLotSize("NIFTY", "COMM")).toBeNull();
  });
});

describe("segmentUsesLots", () => {
  it("every derivative uses lots; EQ does not", () => {
    expect(segmentUsesLots("EQ")).toBe(false);
    expect(segmentUsesLots("FUT")).toBe(true);
    expect(segmentUsesLots("OPT")).toBe(true);
    expect(segmentUsesLots("COMM")).toBe(true);
    expect(segmentUsesLots("CDS")).toBe(true);
  });
});

describe("lots <-> units conversion", () => {
  it("lotsToUnits multiplies and rounds to a whole quantity", () => {
    expect(lotsToUnits(2, 75)).toBe(150);
    expect(lotsToUnits(1, 100)).toBe(100); // 1 lot CRUDEOIL
    expect(lotsToUnits(1, 1000)).toBe(1000); // 1 lot USDINR
    expect(lotsToUnits(3, 35)).toBe(105); // 3 lots BANKNIFTY
  });

  it("lotsToUnits returns null for an unusable lot size", () => {
    expect(lotsToUnits(2, 0)).toBeNull();
    expect(lotsToUnits(2, -5)).toBeNull();
    expect(lotsToUnits(NaN, 75)).toBeNull();
    expect(lotsToUnits(2, Infinity)).toBeNull();
  });

  it("unitsToLots divides (may be fractional, for display)", () => {
    expect(unitsToLots(150, 75)).toBe(2);
    expect(unitsToLots(100, 75)).toBeCloseTo(1.333, 3);
    expect(unitsToLots(50, 0)).toBeNull();
  });

  it("exactLotCount only returns a whole-lot count when units divide evenly", () => {
    expect(exactLotCount(150, 75)).toBe(2);
    expect(exactLotCount(75, 75)).toBe(1);
    expect(exactLotCount(100, 75)).toBeNull(); // 1.33 lots — never imply a fractional lot
    expect(exactLotCount(105, 35)).toBe(3);
    expect(exactLotCount(150.5, 75)).toBeNull(); // non-integer units
    expect(exactLotCount(150, 0)).toBeNull();
  });

  it("round-trips: lotsToUnits then exactLotCount returns the original lot count", () => {
    for (const [lots, size] of [
      [1, 75],
      [2, 35],
      [5, 100],
      [1, 1000],
    ] as const) {
      const units = lotsToUnits(lots, size)!;
      expect(exactLotCount(units, size)).toBe(lots);
    }
  });
});

// ── Charge parity: a lot-entered qty must produce IDENTICAL charges + P&L to
// typing the equivalent unit qty directly. The lot helper is a presentation
// convenience only — it must NEVER alter money. Cross-check against the engine
// for NIFTY-OPT, MCX-FUT and CDS at hand-verifiable inputs.
describe("lot entry preserves charges + P&L (no silent money change)", () => {
  const profile = getChargeProfile("zerodha");

  // 1 lot lands on a hand-verifiable unit qty per symbol (NIFTY 65, CRUDEOIL 100,
  // USDINR 1000). The charges.golden NIFTY row uses 75 qty as a charge sample —
  // a valid input even though it's no longer exactly one lot.
  it("1 lot of NIFTY-OPT / CRUDEOIL-COMM / USDINR-CDS equals the expected unit quantities", () => {
    expect(lotsToUnits(1, defaultLotSize("NIFTY", "OPT")!)).toBe(65);
    expect(lotsToUnits(1, defaultLotSize("CRUDEOIL", "COMM")!)).toBe(100);
    expect(lotsToUnits(1, defaultLotSize("USDINR", "CDS")!)).toBe(1000);
  });

  it("2 lots NIFTY OPT (lotSize 65) == 130 units, byte-identical charges", () => {
    const lotSize = defaultLotSize("NIFTY", "OPT")!;
    expect(lotSize).toBe(65);
    const unitsFromLots = lotsToUnits(2, lotSize)!;
    expect(unitsFromLots).toBe(130);

    const viaLots = computeCharges(profile, {
      segment: "OPT",
      product: "NRML",
      qty: unitsFromLots,
      entryPrice: 120,
      exitPrice: 150,
      direction: "long",
    });
    const viaUnits = computeCharges(profile, {
      segment: "OPT",
      product: "NRML",
      qty: 130,
      entryPrice: 120,
      exitPrice: 150,
      direction: "long",
    });
    expect(viaLots).toEqual(viaUnits);
  });

  it("1 lot CRUDEOIL MCX FUT (lotSize 100) == 100 units, identical charges", () => {
    const lotSize = defaultLotSize("CRUDEOIL", "COMM")!;
    expect(lotSize).toBe(100);
    const units = lotsToUnits(1, lotSize)!;
    expect(units).toBe(100);

    const viaLots = computeCharges(profile, {
      segment: "COMM",
      product: "NRML",
      exchange: "MCX",
      qty: units,
      entryPrice: 6000,
      exitPrice: 6050,
      direction: "long",
      commodityOption: false,
      agriCommodity: false,
    });
    const viaUnits = computeCharges(profile, {
      segment: "COMM",
      product: "NRML",
      exchange: "MCX",
      qty: 100,
      entryPrice: 6000,
      exitPrice: 6050,
      direction: "long",
      commodityOption: false,
      agriCommodity: false,
    });
    expect(viaLots).toEqual(viaUnits);
  });

  it("1 lot USDINR CDS (lotSize 1000) == 1000 units, identical charges", () => {
    const lotSize = defaultLotSize("USDINR", "CDS")!;
    expect(lotSize).toBe(1000);
    const units = lotsToUnits(1, lotSize)!;
    expect(units).toBe(1000);

    const viaLots = computeCharges(profile, {
      segment: "CDS",
      product: "NRML",
      qty: units,
      entryPrice: 83,
      exitPrice: 83.5,
      direction: "long",
      isOption: false,
    });
    const viaUnits = computeCharges(profile, {
      segment: "CDS",
      product: "NRML",
      qty: 1000,
      entryPrice: 83,
      exitPrice: 83.5,
      direction: "long",
      isOption: false,
    });
    expect(viaLots).toEqual(viaUnits);
  });
});
