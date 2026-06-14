import { describe, expect, it } from "vitest";
import {
  classifyAgriCommodity,
  parseContractName,
  parseDateOnly,
  parseTimestamp,
} from "./instrument-parse";

describe("parseContractName — compact NSE names", () => {
  it("monthly option: BANKNIFTY24JUN52000CE", () => {
    expect(parseContractName("BANKNIFTY24JUN52000CE")).toEqual({
      symbol: "BANKNIFTY",
      segment: "OPT",
      strike: 52000,
      optionType: "CE",
      expiry: null,
      agri: false,
    });
  });

  it("monthly put: NIFTY26JUN24500PE", () => {
    const p = parseContractName("NIFTY26JUN24500PE");
    expect(p).toMatchObject({ symbol: "NIFTY", segment: "OPT", strike: 24500, optionType: "PE" });
  });

  it("weekly numeric month code: NIFTY2461324500CE (yy=24 m=6 dd=13)", () => {
    const p = parseContractName("NIFTY2461324500CE");
    expect(p).toMatchObject({ symbol: "NIFTY", segment: "OPT", strike: 24500, optionType: "CE" });
  });

  it("weekly letter month code (Oct): NIFTY24O1024500PE", () => {
    const p = parseContractName("NIFTY24O1024500PE");
    expect(p).toMatchObject({ symbol: "NIFTY", segment: "OPT", strike: 24500, optionType: "PE" });
  });

  it("symbol containing digits: 360ONE24JUN1000CE", () => {
    const p = parseContractName("360ONE24JUN1000CE");
    expect(p).toMatchObject({ symbol: "360ONE", strike: 1000, optionType: "CE" });
  });

  it("symbol containing &: M&M24JUN3000PE", () => {
    const p = parseContractName("M&M24JUN3000PE");
    expect(p).toMatchObject({ symbol: "M&M", strike: 3000, optionType: "PE" });
  });

  it("decimal strike (currency): USDINR24JUN83.5CE", () => {
    const p = parseContractName("USDINR24JUN83.5CE");
    expect(p).toMatchObject({ symbol: "USDINR", strike: 83.5, optionType: "CE" });
  });

  it("monthly future: BANKNIFTY24JUNFUT", () => {
    expect(parseContractName("BANKNIFTY24JUNFUT")).toMatchObject({
      symbol: "BANKNIFTY",
      segment: "FUT",
      strike: null,
      optionType: null,
    });
  });

  it("plain equity stays EQ", () => {
    expect(parseContractName("RELIANCE")).toMatchObject({ symbol: "RELIANCE", segment: "EQ" });
  });
});

describe("parseContractName — Fyers-style symbols", () => {
  it("strips exchange prefix + series: NSE:SBIN-EQ", () => {
    expect(parseContractName("NSE:SBIN-EQ")).toMatchObject({ symbol: "SBIN", segment: "EQ" });
  });

  it("hyphenated symbol keeps its hyphen: NSE:BAJAJ-AUTO-EQ", () => {
    expect(parseContractName("NSE:BAJAJ-AUTO-EQ")).toMatchObject({
      symbol: "BAJAJ-AUTO",
      segment: "EQ",
    });
  });

  it("prefixed option: NSE:NIFTY24JUN24500CE", () => {
    expect(parseContractName("NSE:NIFTY24JUN24500CE")).toMatchObject({
      symbol: "NIFTY",
      segment: "OPT",
      strike: 24500,
      optionType: "CE",
    });
  });

  it("prefixed future: NSE:BANKNIFTY24JUNFUT", () => {
    expect(parseContractName("NSE:BANKNIFTY24JUNFUT")).toMatchObject({
      symbol: "BANKNIFTY",
      segment: "FUT",
    });
  });
});

describe("parseContractName — spaced names (Groww / Dhan)", () => {
  it("strike before CE: BANKNIFTY 52000 CE", () => {
    expect(parseContractName("BANKNIFTY 52000 CE")).toMatchObject({
      symbol: "BANKNIFTY",
      segment: "OPT",
      strike: 52000,
      optionType: "CE",
    });
  });

  it("full date token: BANKNIFTY 26JUN2026 52000 CE → expiry parsed", () => {
    expect(parseContractName("BANKNIFTY 26JUN2026 52000 CE")).toEqual({
      symbol: "BANKNIFTY",
      segment: "OPT",
      strike: 52000,
      optionType: "CE",
      expiry: "2026-06-26",
      agri: false,
    });
  });

  it("date trio + CALL word: NIFTY 25 JUN 2026 24500 CALL", () => {
    expect(parseContractName("NIFTY 25 JUN 2026 24500 CALL")).toEqual({
      symbol: "NIFTY",
      segment: "OPT",
      strike: 24500,
      optionType: "CE",
      expiry: "2026-06-25",
      agri: false,
    });
  });

  it("PUT word maps to PE", () => {
    expect(parseContractName("BANKNIFTY 51000 PUT")).toMatchObject({
      strike: 51000,
      optionType: "PE",
    });
  });

  it("spaced future with expiry: NIFTY 25 JUN 2026 FUT", () => {
    expect(parseContractName("NIFTY 25 JUN 2026 FUT")).toEqual({
      symbol: "NIFTY",
      segment: "FUT",
      strike: null,
      optionType: null,
      expiry: "2026-06-25",
      agri: false,
    });
  });

  it("company-style equity name stays EQ", () => {
    expect(parseContractName("Reliance Industries")).toMatchObject({
      symbol: "RELIANCE INDUSTRIES",
      segment: "EQ",
    });
  });
});

describe("parseContractName — commodity (MCX → COMM)", () => {
  it("MCX: prefixed future → COMM (segment, not FUT)", () => {
    expect(parseContractName("MCX:CRUDEOIL24JUNFUT")).toMatchObject({
      symbol: "CRUDEOIL",
      segment: "COMM",
      strike: null,
      optionType: null,
    });
  });

  it("MCX: prefixed option keeps strike + CE/PE on COMM", () => {
    expect(parseContractName("MCX:CRUDEOIL24JUN6500CE")).toMatchObject({
      symbol: "CRUDEOIL",
      segment: "COMM",
      strike: 6500,
      optionType: "CE",
    });
  });

  it("bare commodity contract name (no prefix) → COMM", () => {
    expect(parseContractName("CRUDEOIL")).toMatchObject({ symbol: "CRUDEOIL", segment: "COMM" });
    expect(parseContractName("GOLD")).toMatchObject({ symbol: "GOLD", segment: "COMM" });
    expect(parseContractName("NATURALGAS")).toMatchObject({ segment: "COMM" });
    expect(parseContractName("SILVER")).toMatchObject({ segment: "COMM" });
  });

  it("commodity future by name (GOLDM24JUNFUT) → COMM", () => {
    expect(parseContractName("GOLDM24JUNFUT")).toMatchObject({
      symbol: "GOLDM",
      segment: "COMM",
    });
  });

  it("commodity option by name → COMM keeps strike", () => {
    expect(parseContractName("GOLD24JUN72000CE")).toMatchObject({
      symbol: "GOLD",
      segment: "COMM",
      strike: 72000,
      optionType: "CE",
    });
  });
});

describe("parseContractName — currency (USDINR/EURINR → CDS)", () => {
  it("bare currency pair → CDS", () => {
    expect(parseContractName("USDINR")).toMatchObject({ symbol: "USDINR", segment: "CDS" });
    expect(parseContractName("EURINR")).toMatchObject({ symbol: "EURINR", segment: "CDS" });
    expect(parseContractName("GBPINR")).toMatchObject({ segment: "CDS" });
    expect(parseContractName("JPYINR")).toMatchObject({ segment: "CDS" });
  });

  it("currency future → CDS (not FUT)", () => {
    expect(parseContractName("USDINR24JUNFUT")).toMatchObject({
      symbol: "USDINR",
      segment: "CDS",
      strike: null,
    });
  });

  it("CDS: exchange prefix → CDS", () => {
    expect(parseContractName("NSE:USDINR24JUNFUT")).toMatchObject({
      symbol: "USDINR",
      segment: "CDS",
    });
  });

  it("decimal-strike currency option → CDS + decimal strike + CE/PE", () => {
    expect(parseContractName("USDINR24JUN83.5CE")).toMatchObject({
      symbol: "USDINR",
      segment: "CDS",
      strike: 83.5,
      optionType: "CE",
    });
  });

  it("JPYINR sub-rupee decimal strike → CDS", () => {
    expect(parseContractName("JPYINR24JUN0.55PE")).toMatchObject({
      symbol: "JPYINR",
      segment: "CDS",
      strike: 0.55,
      optionType: "PE",
    });
  });

  it("an equity that merely contains INR is not misclassified as CDS", () => {
    expect(parseContractName("INRBANK")).toMatchObject({ symbol: "INRBANK", segment: "EQ" });
  });
});

describe("parseContractName — NCDEX agri (→ COMM, agri-flagged)", () => {
  it("NCDEX: prefixed agri name → COMM and prefix stripped", () => {
    expect(parseContractName("NCDEX:JEERA")).toMatchObject({
      symbol: "JEERA",
      segment: "COMM",
      agri: true,
    });
  });

  it("NCD: prefixed agri name → COMM, agri true", () => {
    expect(parseContractName("NCD:WHEAT")).toMatchObject({
      symbol: "WHEAT",
      segment: "COMM",
      agri: true,
    });
  });

  it("bare NCDEX agri base (no prefix) classifies as COMM agri", () => {
    expect(parseContractName("DHANIYA")).toMatchObject({ segment: "COMM", agri: true });
    expect(parseContractName("TURMERIC")).toMatchObject({ segment: "COMM", agri: true });
    expect(parseContractName("JEERAUNJHA")).toMatchObject({ segment: "COMM", agri: true });
  });

  it("lot-size-suffixed agri SEED variant still classifies as agri (GUARSEED10)", () => {
    expect(parseContractName("GUARSEED10")).toMatchObject({
      symbol: "GUARSEED10",
      segment: "COMM",
      agri: true,
    });
  });

  it("processed GUARGUM is COMM but NON-agri — CTT applies (CORR-02)", () => {
    // Guar Gum is the processed derivative of Guar Seed: still a commodity, but
    // it pays CTT, so agri MUST be false to match classifyAgriCommodity / the tax
    // page (turnover.ts). Lot-suffixed (GUARGUM5) and NCDEX-prefixed both apply.
    expect(parseContractName("GUARGUM5")).toMatchObject({ segment: "COMM", agri: false });
    expect(parseContractName("GUARGUM")).toMatchObject({ segment: "COMM", agri: false });
    expect(parseContractName("NCDEX:GUARGUM")).toMatchObject({ segment: "COMM", agri: false });
    // Parity with the authoritative classifier the tax-turnover path uses.
    expect(parseContractName("GUARGUM5").agri).toBe(classifyAgriCommodity("GUARGUM5"));
  });

  it("a generic equity is never swept into agri COMM", () => {
    expect(parseContractName("RELIANCE")).toMatchObject({ segment: "EQ", agri: false });
    expect(parseContractName("INFY")).toMatchObject({ segment: "EQ", agri: false });
  });
});

describe("parseContractName — agri vs non-agri commodity (CTT exemption)", () => {
  it("metals / energy MCX commodities are NON-agri (CTT applies)", () => {
    expect(parseContractName("CRUDEOIL")).toMatchObject({ segment: "COMM", agri: false });
    expect(parseContractName("GOLD24JUN72000CE")).toMatchObject({ segment: "COMM", agri: false });
    expect(parseContractName("SILVER")).toMatchObject({ segment: "COMM", agri: false });
    expect(parseContractName("MCX:NATURALGAS24JUNFUT")).toMatchObject({
      segment: "COMM",
      agri: false,
    });
  });

  it("agri MCX contracts (KAPAS/COTTON/CARDAMOM/MENTHAOIL) are CTT-exempt", () => {
    expect(parseContractName("KAPAS24APRFUT")).toMatchObject({ segment: "COMM", agri: true });
    expect(parseContractName("COTTON")).toMatchObject({ segment: "COMM", agri: true });
    expect(parseContractName("CARDAMOM24JUNFUT")).toMatchObject({ segment: "COMM", agri: true });
    expect(parseContractName("MENTHAOIL24JUNFUT")).toMatchObject({ segment: "COMM", agri: true });
  });

  it("currency derivatives carry agri: false (never a commodity)", () => {
    expect(parseContractName("USDINR24JUNFUT")).toMatchObject({ segment: "CDS", agri: false });
  });
});

describe("parseDateOnly / parseTimestamp", () => {
  it("ISO date passes through", () => {
    expect(parseDateOnly("2026-06-12")).toBe("2026-06-12");
  });

  it("day-first Indian format", () => {
    expect(parseDateOnly("12-06-2026")).toBe("2026-06-12");
    expect(parseDateOnly("12/06/2026")).toBe("2026-06-12");
  });

  it("month-name format", () => {
    expect(parseDateOnly("12-Jun-2026")).toBe("2026-06-12");
    expect(parseDateOnly("12 Jun 2026")).toBe("2026-06-12");
  });

  it("invalid returns null", () => {
    expect(parseDateOnly("not a date")).toBeNull();
    expect(parseTimestamp("")).toBeNull();
  });

  it("separate date + time columns combine (day-first)", () => {
    expect(parseTimestamp("12-06-2026", "09:21:34")).toBe(
      new Date("2026-06-12T09:21:34").toISOString()
    );
  });

  it("datetime in a single column", () => {
    expect(parseTimestamp("12-06-2026 09:40:11")).toBe(
      new Date("2026-06-12T09:40:11").toISOString()
    );
  });

  it("12-hour clock with PM", () => {
    expect(parseTimestamp("12-06-2026", "3:45:10 PM")).toBe(
      new Date("2026-06-12T15:45:10").toISOString()
    );
  });

  it("ISO datetime", () => {
    expect(parseTimestamp("2026-06-12T09:30:01")).toBe(
      new Date("2026-06-12T09:30:01").toISOString()
    );
  });

  it("date without time defaults to midnight", () => {
    expect(parseTimestamp("12-06-2026")).toBe(new Date("2026-06-12T00:00:00").toISOString());
  });
});

describe("classifyAgriCommodity — SEBI Rule-3 exempt list (SEG-CHG)", () => {
  it("exempts core Rule-3 agri commodities", () => {
    for (const s of [
      "CHANA",
      "GUARSEED",
      "JEERA",
      "DHANIYA",
      "SOYBEAN",
      "CASTORSEED",
      "WHEAT",
      "COTTON",
      "TURMERIC",
      "MUSTARDSEED",
      "MENTHAOIL",
      "CARDAMOM",
    ]) {
      expect(classifyAgriCommodity(s)).toBe(true);
    }
  });
  it("Guar SEED is exempt but Guar GUM (processed) is NOT — not a substring match", () => {
    expect(classifyAgriCommodity("GUARSEED")).toBe(true);
    expect(classifyAgriCommodity("GUARGUM")).toBe(false);
    expect(classifyAgriCommodity("GUAR")).toBe(true); // bare guar seed
  });
  it("processed agri products & oilcakes are NON-agri (CTT applies)", () => {
    for (const s of ["GUARGUM", "COCUDAKL", "SOYAOIL", "REFSOYOIL", "CPO", "MUSTARDOIL"]) {
      expect(classifyAgriCommodity(s)).toBe(false);
    }
  });
  it("AGRIDEX index is NON-agri (pays CTT 0.01%)", () => {
    expect(classifyAgriCommodity("AGRIDEX")).toBe(false);
  });
  it("non-agri MCX commodities (bullion/energy/base metals) are NOT agri", () => {
    for (const s of ["GOLD", "SILVER", "CRUDEOIL", "NATURALGAS", "COPPER", "ZINC"]) {
      expect(classifyAgriCommodity(s)).toBe(false);
    }
  });
  it("strips exchange prefix and contract-month suffix before matching", () => {
    expect(classifyAgriCommodity("NCDEX:GUARSEED24JUN")).toBe(true);
    expect(classifyAgriCommodity("MCX:COTTON24JUN")).toBe(true);
    expect(classifyAgriCommodity("CRUDEOIL24JUNFUT")).toBe(false);
  });
});
