import { describe, expect, it } from "vitest";
import { buildQuickTradeValues, describeParsed } from "./quick-trade";

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
});
