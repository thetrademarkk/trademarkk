import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRADER_PROFILE,
  DEFAULT_TRADER_TYPE,
  TRADER_PROFILE_KEY,
  TRADER_TYPES,
  dashboardEmphasisForTraderType,
  sanitizeTraderProfile,
  traderTypeDefaults,
  type TraderType,
} from "./trader-profile";
import { productsForSegment } from "@/features/trades/schemas";

describe("trader-profile — default segment/product mapping (SEG-08)", () => {
  it("maps each trader type to the documented (segment, product) default", () => {
    expect(traderTypeDefaults("intraday-equity")).toEqual({ segment: "EQ", product: "MIS" });
    expect(traderTypeDefaults("swing")).toEqual({ segment: "EQ", product: "CNC" });
    expect(traderTypeDefaults("fno")).toEqual({ segment: "OPT", product: "NRML" });
    expect(traderTypeDefaults("commodity")).toEqual({ segment: "COMM", product: "NRML" });
    expect(traderTypeDefaults("currency")).toEqual({ segment: "CDS", product: "NRML" });
    expect(traderTypeDefaults("mixed")).toEqual({ segment: "EQ", product: "MIS" });
  });

  it("every default product is valid for its segment (form validation parity)", () => {
    for (const type of TRADER_TYPES) {
      const { segment, product } = traderTypeDefaults(type);
      expect(productsForSegment(segment)).toContain(product);
    }
  });

  it("intraday-equity is the only type defaulting to a same-day product", () => {
    const intradayProducts = TRADER_TYPES.filter((t) => traderTypeDefaults(t).product === "MIS");
    // intraday-equity + mixed (neutral) both default to MIS; the rest are overnight.
    expect(intradayProducts.sort()).toEqual(["intraday-equity", "mixed"]);
  });
});

describe("trader-profile — dashboard emphasis default (SEG-08)", () => {
  it("intraday-equity leans intraday", () => {
    expect(dashboardEmphasisForTraderType("intraday-equity")).toBe("intraday");
  });

  it("swing/F&O/commodity/currency lean positional (predominantly overnight)", () => {
    for (const t of ["swing", "fno", "commodity", "currency"] as TraderType[]) {
      expect(dashboardEmphasisForTraderType(t)).toBe("positional");
    }
  });

  it("mixed stays balanced — hides nothing", () => {
    expect(dashboardEmphasisForTraderType("mixed")).toBe("balanced");
  });
});

describe("trader-profile — sanitize / round-trip (SEG-08)", () => {
  it("accepts every known trader type", () => {
    for (const t of TRADER_TYPES) {
      expect(sanitizeTraderProfile({ traderType: t })).toEqual({ traderType: t });
    }
  });

  it("degrades unknown / legacy / garbage to the mixed default", () => {
    expect(sanitizeTraderProfile(null)).toEqual(DEFAULT_TRADER_PROFILE);
    expect(sanitizeTraderProfile(undefined)).toEqual(DEFAULT_TRADER_PROFILE);
    expect(sanitizeTraderProfile("scalper")).toEqual(DEFAULT_TRADER_PROFILE);
    expect(sanitizeTraderProfile(42)).toEqual(DEFAULT_TRADER_PROFILE);
    expect(sanitizeTraderProfile({})).toEqual(DEFAULT_TRADER_PROFILE);
    expect(sanitizeTraderProfile({ traderType: "options-pro" })).toEqual(DEFAULT_TRADER_PROFILE);
    expect(sanitizeTraderProfile({ traderType: 1 })).toEqual(DEFAULT_TRADER_PROFILE);
  });

  it("ignores extra keys but keeps the valid trader type (forward-compat)", () => {
    expect(sanitizeTraderProfile({ traderType: "swing", extra: "x", v: 9 })).toEqual({
      traderType: "swing",
    });
  });

  it("survives a JSON serialize → parse round trip", () => {
    for (const t of TRADER_TYPES) {
      const stored = JSON.stringify({ traderType: t });
      expect(sanitizeTraderProfile(JSON.parse(stored))).toEqual({ traderType: t });
    }
  });

  it("the default trader type is mixed and the settings key is versioned", () => {
    expect(DEFAULT_TRADER_TYPE).toBe("mixed");
    expect(DEFAULT_TRADER_PROFILE).toEqual({ traderType: "mixed" });
    expect(TRADER_PROFILE_KEY).toBe("trader_profile.v1");
  });
});
