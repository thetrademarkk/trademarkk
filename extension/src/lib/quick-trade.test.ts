import { describe, expect, it } from "vitest";
import {
  applyCapturedExchange,
  buildQuickTradeValues,
  defaultProductForSegment,
  describeParsed,
} from "./quick-trade";

const baseInput = {
  accountId: "acc1",
  instrument: "BANKNIFTY24JUN52000CE",
  side: "buy" as const,
  qty: "30",
  entry: "120.5",
  exit: "150",
};

describe("buildQuickTradeValues", () => {
  it("maps a parsed option contract to TradeFormValues", () => {
    const r = buildQuickTradeValues(baseInput);
    if (!r.ok) throw new Error(r.error);
    expect(r.values.symbol).toBe("BANKNIFTY");
    expect(r.values.segment).toBe("OPT");
    expect(r.values.strike).toBe(52000);
    expect(r.values.optionType).toBe("CE");
    expect(r.values.direction).toBe("long");
    expect(r.values.qty).toBe(30);
    expect(r.values.avgEntry).toBe(120.5);
    expect(r.values.avgExit).toBe(150);
    expect(r.values.closedAt).toBeTruthy();
    expect(r.parsed.segment).toBe("OPT");
  });

  it("empty exit → open trade (no closedAt, no avgExit)", () => {
    const r = buildQuickTradeValues({ ...baseInput, exit: "" });
    if (!r.ok) throw new Error(r.error);
    expect(r.values.avgExit).toBeUndefined();
    expect(r.values.closedAt).toBeUndefined();
  });

  it("sell side maps to short", () => {
    const r = buildQuickTradeValues({ ...baseInput, side: "sell" });
    if (!r.ok) throw new Error(r.error);
    expect(r.values.direction).toBe("short");
  });

  it("plain equity symbol stays EQ", () => {
    const r = buildQuickTradeValues({ ...baseInput, instrument: "RELIANCE" });
    if (!r.ok) throw new Error(r.error);
    expect(r.values.segment).toBe("EQ");
    expect(r.values.strike).toBeUndefined();
    expect(r.values.optionType).toBeUndefined();
  });

  it("spaced Groww-style contract names parse with expiry", () => {
    const r = buildQuickTradeValues({ ...baseInput, instrument: "NIFTY 25 JUN 2026 24500 CALL" });
    if (!r.ok) throw new Error(r.error);
    expect(r.values.symbol).toBe("NIFTY");
    expect(r.values.optionType).toBe("CE");
    expect(r.values.strike).toBe(24500);
    expect(r.values.expiry).toBe("2026-06-25");
  });

  it("rejects missing instrument / qty / entry with readable errors", () => {
    expect(buildQuickTradeValues({ ...baseInput, instrument: "  " })).toMatchObject({ ok: false });
    expect(buildQuickTradeValues({ ...baseInput, qty: "" })).toMatchObject({ ok: false });
    expect(buildQuickTradeValues({ ...baseInput, entry: "abc" })).toMatchObject({ ok: false });
    const r = buildQuickTradeValues({ ...baseInput, qty: "1.5" });
    expect(r.ok).toBe(false);
  });

  it("trims notes and drops empty playbook ids", () => {
    const r = buildQuickTradeValues({ ...baseInput, notes: "  scalp  ", playbookId: "" });
    if (!r.ok) throw new Error(r.error);
    expect(r.values.notes).toBe("scalp");
    expect(r.values.playbookId).toBeUndefined();
  });
});

describe("buildQuickTradeValues — product + segment from capture", () => {
  it("derivatives default to NRML (carry-forward)", () => {
    const opt = buildQuickTradeValues(baseInput);
    if (!opt.ok) throw new Error(opt.error);
    expect(opt.values.segment).toBe("OPT");
    expect(opt.values.product).toBe("NRML");

    const fut = buildQuickTradeValues({ ...baseInput, instrument: "NIFTY24JUNFUT" });
    if (!fut.ok) throw new Error(fut.error);
    expect(fut.values.product).toBe("NRML");
  });

  it("cash equity defaults to MIS (intraday)", () => {
    const eq = buildQuickTradeValues({ ...baseInput, instrument: "RELIANCE" });
    if (!eq.ok) throw new Error(eq.error);
    expect(eq.values.segment).toBe("EQ");
    expect(eq.values.product).toBe("MIS");
  });

  it("MCX commodity by name → COMM segment + NRML product", () => {
    const r = buildQuickTradeValues({ ...baseInput, instrument: "CRUDEOIL24JUN6500CE" });
    if (!r.ok) throw new Error(r.error);
    expect(r.values.segment).toBe("COMM");
    expect(r.values.product).toBe("NRML");
    expect(r.values.strike).toBe(6500);
    expect(r.values.optionType).toBe("CE");
  });

  it("a bare NCDEX commodity gets COMM via the captured MCX/NCDEX exchange", () => {
    // "GUARSEED10" alone is a recognised agri base, but a thin name unknown to the
    // base list still classifies once the captured exchange is supplied.
    const r = buildQuickTradeValues({
      ...baseInput,
      instrument: "SOMEAGRI",
      exchange: "NCDEX",
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.values.segment).toBe("COMM");
    expect(r.values.product).toBe("NRML");
  });

  it("a bare currency name gets CDS via the captured CDS exchange", () => {
    const r = buildQuickTradeValues({ ...baseInput, instrument: "USDINR", exchange: "CDS" });
    if (!r.ok) throw new Error(r.error);
    expect(r.values.segment).toBe("CDS");
    expect(r.values.product).toBe("NRML");
  });

  it("an NSE equity captured with its exchange stays EQ/MIS (no spurious segment)", () => {
    const r = buildQuickTradeValues({ ...baseInput, instrument: "SBIN", exchange: "NSE" });
    if (!r.ok) throw new Error(r.error);
    expect(r.values.segment).toBe("EQ");
    expect(r.values.product).toBe("MIS");
    expect(r.values.symbol).toBe("SBIN");
  });
});

describe("applyCapturedExchange", () => {
  it("prefixes a bare symbol with a parseable exchange", () => {
    expect(applyCapturedExchange("CRUDEOIL", "MCX")).toBe("MCX:CRUDEOIL");
    expect(applyCapturedExchange("USDINR", "CDS")).toBe("CDS:USDINR");
    expect(applyCapturedExchange("JEERA", "NCDEX")).toBe("NCDEX:JEERA");
  });

  it("never double-prefixes an already-prefixed symbol", () => {
    expect(applyCapturedExchange("NSE:SBIN-EQ", "MCX")).toBe("NSE:SBIN-EQ");
  });

  it("ignores an unknown or empty exchange", () => {
    expect(applyCapturedExchange("RELIANCE", null)).toBe("RELIANCE");
    expect(applyCapturedExchange("RELIANCE", "")).toBe("RELIANCE");
    expect(applyCapturedExchange("RELIANCE", "WEIRD")).toBe("RELIANCE");
  });
});

describe("defaultProductForSegment", () => {
  it("derivatives → NRML, equity → MIS", () => {
    expect(defaultProductForSegment("EQ")).toBe("MIS");
    expect(defaultProductForSegment("FUT")).toBe("NRML");
    expect(defaultProductForSegment("OPT")).toBe("NRML");
    expect(defaultProductForSegment("COMM")).toBe("NRML");
    expect(defaultProductForSegment("CDS")).toBe("NRML");
  });
});

describe("describeParsed", () => {
  it("describes options, futures and equity", () => {
    const opt = buildQuickTradeValues(baseInput);
    if (!opt.ok) throw new Error(opt.error);
    expect(describeParsed(opt.parsed)).toBe("BANKNIFTY · Options 52000 CE");
    const fut = buildQuickTradeValues({ ...baseInput, instrument: "NIFTY24JUNFUT", exit: "" });
    if (!fut.ok) throw new Error(fut.error);
    expect(describeParsed(fut.parsed)).toBe("NIFTY · Futures");
    const eq = buildQuickTradeValues({ ...baseInput, instrument: "SBIN" });
    if (!eq.ok) throw new Error(eq.error);
    expect(describeParsed(eq.parsed)).toBe("SBIN · Equity");
  });

  it("describes commodity (agri-flagged) and currency", () => {
    const comm = buildQuickTradeValues({
      ...baseInput,
      instrument: "GOLD24JUN72000CE",
      exit: "",
    });
    if (!comm.ok) throw new Error(comm.error);
    expect(describeParsed(comm.parsed)).toBe("GOLD · Commodity 72000 CE");

    const agri = buildQuickTradeValues({ ...baseInput, instrument: "DHANIYA", exit: "" });
    if (!agri.ok) throw new Error(agri.error);
    expect(describeParsed(agri.parsed)).toBe("DHANIYA · Commodity agri");

    const cds = buildQuickTradeValues({ ...baseInput, instrument: "USDINR24JUNFUT", exit: "" });
    if (!cds.ok) throw new Error(cds.error);
    expect(describeParsed(cds.parsed)).toBe("USDINR · Currency");
  });
});
