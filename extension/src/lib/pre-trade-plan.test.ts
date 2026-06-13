import { describe, expect, it } from "vitest";
import { buildTradeSaveStatements } from "@/features/trades/save-statements";
import { buildPreTradePlanValues, parsePlanInstrument } from "./pre-trade-plan";

const base = {
  accountId: "acc1",
  instrument: "BANKNIFTY24JUN52000CE",
  segment: "OPT" as const,
  product: "NRML" as const,
  side: "buy" as const,
  qty: "30",
  plannedEntry: "120",
  plannedSl: "90",
  plannedTarget: "180",
};

describe("buildPreTradePlanValues", () => {
  it("maps a parsed option plan to TradeFormValues with all planned levels", () => {
    const r = buildPreTradePlanValues(base);
    if (!r.ok) throw new Error(r.error);
    expect(r.values.symbol).toBe("BANKNIFTY");
    expect(r.values.segment).toBe("OPT");
    expect(r.values.product).toBe("NRML");
    expect(r.values.strike).toBe(52000);
    expect(r.values.optionType).toBe("CE");
    expect(r.values.direction).toBe("long");
    expect(r.values.qty).toBe(30);
    expect(r.values.plannedEntry).toBe(120);
    expect(r.values.plannedSl).toBe(90);
    expect(r.values.plannedTarget).toBe(180);
    // Planned entry seeds avg_entry so the open row is valid; no exit ⇒ open.
    expect(r.values.avgEntry).toBe(120);
    expect(r.values.avgExit).toBeUndefined();
    expect(r.values.closedAt).toBeUndefined();
  });

  it("sell side plans a short", () => {
    const r = buildPreTradePlanValues({ ...base, side: "sell" });
    if (!r.ok) throw new Error(r.error);
    expect(r.values.direction).toBe("short");
  });

  it("plain equity symbol keeps the chosen EQ segment + product", () => {
    const r = buildPreTradePlanValues({
      ...base,
      instrument: "RELIANCE",
      segment: "EQ",
      product: "CNC",
      plannedEntry: "1400",
      plannedSl: "1380",
      plannedTarget: "1460",
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.values.segment).toBe("EQ");
    expect(r.values.product).toBe("CNC");
    expect(r.values.strike).toBeUndefined();
    expect(r.values.optionType).toBeUndefined();
  });

  it("keeps the user's COMM segment (parser can't infer it) and snaps product", () => {
    const r = buildPreTradePlanValues({
      ...base,
      instrument: "CRUDEOIL",
      segment: "COMM",
      product: "NRML",
      plannedEntry: "6500",
      plannedSl: "6400",
      plannedTarget: "6700",
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.values.segment).toBe("COMM");
    expect(r.values.product).toBe("NRML");
  });

  it("trusts the parsed OPT segment even if EQ was left selected", () => {
    const r = buildPreTradePlanValues({ ...base, segment: "EQ", product: "MIS" });
    if (!r.ok) throw new Error(r.error);
    expect(r.values.segment).toBe("OPT");
    expect(r.values.strike).toBe(52000);
    expect(r.values.optionType).toBe("CE");
  });

  it("snaps an invalid (segment, product) pairing to the segment's first product", () => {
    // NRML isn't valid for EQ → falls back to MIS (productsForSegment("EQ")[0]).
    const r = buildPreTradePlanValues({
      ...base,
      instrument: "TCS",
      segment: "EQ",
      product: "NRML",
      plannedEntry: "3900",
      plannedSl: "3850",
      plannedTarget: "4000",
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.values.segment).toBe("EQ");
    expect(r.values.product).toBe("MIS");
  });

  it("parses spaced Groww-style contract names with expiry", () => {
    const r = buildPreTradePlanValues({
      ...base,
      instrument: "NIFTY 25 JUN 2026 24500 CALL",
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.values.symbol).toBe("NIFTY");
    expect(r.values.optionType).toBe("CE");
    expect(r.values.strike).toBe(24500);
    expect(r.values.expiry).toBe("2026-06-25");
  });

  it("requires instrument, qty and all three planned levels", () => {
    expect(buildPreTradePlanValues({ ...base, instrument: "  " })).toMatchObject({ ok: false });
    expect(buildPreTradePlanValues({ ...base, qty: "" })).toMatchObject({ ok: false });
    expect(buildPreTradePlanValues({ ...base, plannedEntry: "" })).toMatchObject({ ok: false });
    expect(buildPreTradePlanValues({ ...base, plannedSl: "" })).toMatchObject({ ok: false });
    expect(buildPreTradePlanValues({ ...base, plannedTarget: "" })).toMatchObject({ ok: false });
    expect(buildPreTradePlanValues({ ...base, qty: "1.5" })).toMatchObject({ ok: false });
  });

  it("trims notes and drops an empty playbook id", () => {
    const r = buildPreTradePlanValues({ ...base, notes: "  breakout  ", playbookId: "" });
    if (!r.ok) throw new Error(r.error);
    expect(r.values.notes).toBe("breakout");
    expect(r.values.playbookId).toBeUndefined();
  });
});

describe("plan → trade-row statements (shared save path)", () => {
  it("writes a status=open row carrying planned_* + segment + product", () => {
    const r = buildPreTradePlanValues(base);
    if (!r.ok) throw new Error(r.error);
    const { statements } = buildTradeSaveStatements(r.values, "zerodha");
    const insert = statements.find((s) => /INSERT INTO trades/.test(s.sql));
    if (!insert) throw new Error("no trades insert");
    const a = insert.args!;
    // Column order (save-statements.ts): id, account_id, symbol, exchange,
    // segment, product, expiry, strike, option_type, direction, status, qty,
    // avg_entry, avg_exit, planned_entry, planned_sl, planned_target, ...
    expect(a[4]).toBe("OPT"); // segment
    expect(a[5]).toBe("NRML"); // product
    expect(a[8]).toBe("CE"); // option_type
    expect(a[9]).toBe("long"); // direction
    expect(a[10]).toBe("open"); // status — no exit
    expect(a[12]).toBe(120); // avg_entry seeded from planned entry
    expect(a[13]).toBeNull(); // avg_exit (open)
    expect(a[14]).toBe(120); // planned_entry
    expect(a[15]).toBe(90); // planned_sl
    expect(a[16]).toBe(180); // planned_target
  });

  it("an EQ delivery plan writes EQ + the chosen CNC product", () => {
    const r = buildPreTradePlanValues({
      ...base,
      instrument: "RELIANCE",
      segment: "EQ",
      product: "CNC",
      plannedEntry: "1400",
      plannedSl: "1380",
      plannedTarget: "1460",
    });
    if (!r.ok) throw new Error(r.error);
    const { statements } = buildTradeSaveStatements(r.values, "zerodha");
    const insert = statements.find((s) => /INSERT INTO trades/.test(s.sql))!;
    const a = insert.args!;
    expect(a[4]).toBe("EQ");
    expect(a[5]).toBe("CNC");
    expect(a[10]).toBe("open");
  });
});

describe("parsePlanInstrument", () => {
  it("reuses the shared contract parser", () => {
    expect(parsePlanInstrument("BANKNIFTY24JUN52000CE")).toMatchObject({
      symbol: "BANKNIFTY",
      segment: "OPT",
      strike: 52000,
      optionType: "CE",
    });
    expect(parsePlanInstrument("RELIANCE")).toMatchObject({ symbol: "RELIANCE", segment: "EQ" });
  });
});
