import { describe, expect, it } from "vitest";
import { parseContractName, parseDateOnly, parseTimestamp } from "./instrument-parse";

describe("parseContractName — compact NSE names", () => {
  it("monthly option: BANKNIFTY24JUN52000CE", () => {
    expect(parseContractName("BANKNIFTY24JUN52000CE")).toEqual({
      symbol: "BANKNIFTY",
      segment: "OPT",
      strike: 52000,
      optionType: "CE",
      expiry: null,
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
    });
  });

  it("date trio + CALL word: NIFTY 25 JUN 2026 24500 CALL", () => {
    expect(parseContractName("NIFTY 25 JUN 2026 24500 CALL")).toEqual({
      symbol: "NIFTY",
      segment: "OPT",
      strike: 24500,
      optionType: "CE",
      expiry: "2026-06-25",
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
    });
  });

  it("company-style equity name stays EQ", () => {
    expect(parseContractName("Reliance Industries")).toMatchObject({
      symbol: "RELIANCE INDUSTRIES",
      segment: "EQ",
    });
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
