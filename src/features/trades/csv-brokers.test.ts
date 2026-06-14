import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { detectBroker, mapProduct } from "./csv-brokers";
import { pairFillsToTrades, type RawFill } from "./csv";
import { computeCharges } from "@/lib/charges/charges";
import { getChargeProfile } from "@/config/brokers";

/** Parses a fixture CSV string exactly like the import dialog does. */
function load(fixture: string) {
  const res = Papa.parse<Record<string, string>>(fixture.trim(), {
    header: true,
    skipEmptyLines: true,
  });
  const headers = res.meta.fields ?? [];
  return { headers, rows: res.data };
}

const iso = (s: string) => new Date(s).toISOString();

// ───────────────────────────── Upstox ─────────────────────────────
const UPSTOX = `
Date,Time,Exchange,Segment,Scrip Name,Side,Quantity,Price,Trade Num,Order Num
12-06-2026,09:21:34,NSE,FO,BANKNIFTY24JUN52000CE,BUY,30,245.50,11111,O1
12-06-2026,10:05:12,NSE,FO,BANKNIFTY24JUN52000CE,SELL,30,310.00,11112,O2
12-06-2026,11:15:09,NSE,EQ,RELIANCE,BUY,10,2950.00,11113,O3
`;

describe("Upstox tradebook", () => {
  const { headers, rows } = load(UPSTOX);

  it("detects the broker from headers", () => {
    expect(detectBroker(headers)?.id).toBe("upstox");
  });

  it("maps fills with contract names parsed", () => {
    const fills = detectBroker(headers)!.toFills(rows, headers);
    expect(fills).toHaveLength(3);
    expect(fills[0]).toMatchObject({
      symbol: "BANKNIFTY",
      segment: "OPT",
      strike: 52000,
      optionType: "CE",
      side: "buy",
      qty: 30,
      price: 245.5,
      time: iso("2026-06-12T09:21:34"),
    });
    expect(fills[1]).toMatchObject({ side: "sell", price: 310 });
    expect(fills[2]).toMatchObject({ symbol: "RELIANCE", segment: "EQ", strike: null, qty: 10 });
  });

  it("pairs into trades and dedupes idempotently (stable ids)", () => {
    const spec = detectBroker(headers)!;
    const a = pairFillsToTrades(spec.toFills(rows, headers), "acc", "zero");
    const b = pairFillsToTrades(spec.toFills(rows, headers), "acc", "zero");
    expect(a).toHaveLength(2); // 1 closed option round-trip + 1 open equity
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
    const opt = a.find((t) => t.segment === "OPT")!;
    expect(opt).toMatchObject({
      symbol: "BANKNIFTY",
      strike: 52000,
      option_type: "CE",
      status: "closed",
      qty: 30,
    });
    expect(opt.gross_pnl).toBe((310 - 245.5) * 30);
  });
});

// ──────────────────────────── Angel One ────────────────────────────
const ANGEL_ONE = `
Trade Date,Trade Time,Exchange,Segment,Symbol Name,Transaction Type,Quantity,Trade Price,Expiry Date,Strike Price,Option Type,Order No,Trade No
12-06-2026,09:30:15,NFO,OPT,NIFTY,BUY,75,120.50,25-06-2026,24500,CE,A1,T1
12-06-2026,09:48:02,NFO,OPT,NIFTY,SELL,75,150.25,25-06-2026,24500,CE,A2,T2
12-06-2026,13:02:44,NSE,EQ,TCS,BUY,5,3890.10,,,,A3,T3
`;

describe("Angel One tradebook", () => {
  const { headers, rows } = load(ANGEL_ONE);

  it("detects the broker from headers", () => {
    expect(detectBroker(headers)?.id).toBe("angelone");
  });

  it("uses explicit strike/option-type/expiry columns", () => {
    const fills = detectBroker(headers)!.toFills(rows, headers);
    expect(fills).toHaveLength(3);
    expect(fills[0]).toMatchObject({
      symbol: "NIFTY",
      segment: "OPT",
      strike: 24500,
      optionType: "CE",
      expiry: "2026-06-25",
      side: "buy",
      qty: 75,
      price: 120.5,
    });
    expect(fills[2]).toMatchObject({ symbol: "TCS", segment: "EQ", strike: null, expiry: null });
  });

  it("closed option trade carries the expiry through", () => {
    const trades = pairFillsToTrades(detectBroker(headers)!.toFills(rows, headers), "acc", "zero");
    const opt = trades.find((t) => t.segment === "OPT")!;
    expect(opt).toMatchObject({ expiry: "2026-06-25", strike: 24500, status: "closed" });
  });
});

// ─────────────────────────────── Dhan ───────────────────────────────
const DHAN = `
Date,Time,Exchange,Segment,Security Name,Buy/Sell,Quantity,Trade Price,Order No,Trade No
2026-06-12,09:35:20,NSE,FNO,NIFTY 25 JUN 2026 24500 CALL,B,75,118.00,D1,DT1
2026-06-12,10:22:41,NSE,FNO,NIFTY 25 JUN 2026 24500 CALL,S,75,141.35,D2,DT2
2026-06-12,12:01:05,NSE,EQ,HDFCBANK,B,12,1612.40,D3,DT3
`;

describe("Dhan trade history", () => {
  const { headers, rows } = load(DHAN);

  it("detects the broker from headers", () => {
    expect(detectBroker(headers)?.id).toBe("dhan");
  });

  it("parses spaced CALL/PUT security names with embedded expiry", () => {
    const fills = detectBroker(headers)!.toFills(rows, headers);
    expect(fills).toHaveLength(3);
    expect(fills[0]).toMatchObject({
      symbol: "NIFTY",
      segment: "OPT",
      strike: 24500,
      optionType: "CE",
      expiry: "2026-06-25",
      side: "buy",
      qty: 75,
      price: 118,
      time: iso("2026-06-12T09:35:20"),
    });
    expect(fills[1]).toMatchObject({ side: "sell", price: 141.35 });
    expect(fills[2]).toMatchObject({ symbol: "HDFCBANK", segment: "EQ" });
  });
});

// ─────────────────────────────── Fyers ───────────────────────────────
const FYERS = `
Client ID,Symbol,Trade Date and Time,Exchange,Segment,Transaction Type,Product,Qty,Traded Price,Order No,Trade No
AB1234,NSE:NIFTY24JUN24500PE,12-06-2026 09:40:11,NSE,FO,BUY,MARGIN,75,98.40,F1,FT1
AB1234,NSE:NIFTY24JUN24500PE,12-06-2026 09:58:43,NSE,FO,SELL,MARGIN,75,121.00,F2,FT2
AB1234,NSE:SBIN-EQ,12-06-2026 14:10:00,NSE,EQ,BUY,CNC,40,852.30,F3,FT3
`;

describe("Fyers tradebook", () => {
  const { headers, rows } = load(FYERS);

  it("detects the broker from headers", () => {
    expect(detectBroker(headers)?.id).toBe("fyers");
  });

  it("strips NSE: prefix and -EQ series; parses compact contracts", () => {
    const fills = detectBroker(headers)!.toFills(rows, headers);
    expect(fills).toHaveLength(3);
    expect(fills[0]).toMatchObject({
      symbol: "NIFTY",
      segment: "OPT",
      strike: 24500,
      optionType: "PE",
      side: "buy",
      qty: 75,
      price: 98.4,
      time: iso("2026-06-12T09:40:11"),
    });
    expect(fills[2]).toMatchObject({
      symbol: "SBIN",
      segment: "EQ",
      side: "buy",
      qty: 40,
      price: 852.3,
    });
  });
});

// ─────────────────────────────── Groww ───────────────────────────────
const GROWW = `
Contract name,Type,Quantity,Average price,Order status,Execution date and time,Exchange
BANKNIFTY 26JUN2026 52000 CE,BUY,30,245.50,EXECUTED,2026-06-12 09:21:34,NSE
BANKNIFTY 26JUN2026 52000 CE,SELL,30,310.10,EXECUTED,2026-06-12 10:05:12,NSE
BANKNIFTY 26JUN2026 51000 PE,BUY,30,180.00,CANCELLED,2026-06-12 10:30:00,NSE
`;

describe("Groww order history", () => {
  const { headers, rows } = load(GROWW);

  it("detects the broker from headers", () => {
    expect(detectBroker(headers)?.id).toBe("groww");
  });

  it("imports only EXECUTED rows and parses contract names", () => {
    const fills = detectBroker(headers)!.toFills(rows, headers);
    expect(fills).toHaveLength(2); // cancelled row skipped
    expect(fills[0]).toMatchObject({
      symbol: "BANKNIFTY",
      segment: "OPT",
      strike: 52000,
      optionType: "CE",
      expiry: "2026-06-26",
      side: "buy",
      qty: 30,
      price: 245.5,
      time: iso("2026-06-12T09:21:34"),
    });
  });

  it("round-trips into one closed trade", () => {
    const trades = pairFillsToTrades(detectBroker(headers)!.toFills(rows, headers), "acc", "zero");
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      symbol: "BANKNIFTY",
      strike: 52000,
      option_type: "CE",
      expiry: "2026-06-26",
      direction: "long",
      status: "closed",
      avg_entry: 245.5,
      avg_exit: 310.1,
    });
  });
});

// ─────────────────────────────── Zerodha ───────────────────────────────
const ZERODHA = `
symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time,expiry_date
BANKNIFTY24JUN52000CE,,2026-06-12,NFO,FO,,buy,false,30,245.50,Z1,ZO1,2026-06-12T09:21:34,2026-06-25
BANKNIFTY24JUN52000CE,,2026-06-12,NFO,FO,,sell,false,30,310.00,Z2,ZO2,2026-06-12T10:05:12,2026-06-25
`;

describe("Zerodha Console tradebook (legacy path preserved)", () => {
  const { headers, rows } = load(ZERODHA);

  it("detects the broker from headers", () => {
    expect(detectBroker(headers)?.id).toBe("zerodha");
  });

  it("keeps the raw contract symbol in fills (id scheme unchanged) yet parses the trade", () => {
    const fills = detectBroker(headers)!.toFills(rows, headers);
    expect(fills[0]!.symbol).toBe("BANKNIFTY24JUN52000CE");
    expect(fills[0]!.segment).toBeUndefined();
    const trades = pairFillsToTrades(fills, "acc", "zero");
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      symbol: "BANKNIFTY",
      segment: "OPT",
      strike: 52000,
      option_type: "CE",
    });
  });
});

// The generic rowsToFills path (Zerodha mapper) must read day-first broker
// timestamps via parseTimestamp — `new Date("12-06-2026")` would misread it as
// Dec 06, shifting the trade to the wrong calendar day (and wrong tax FY).
const ZERODHA_DAYFIRST = `
symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time,expiry_date
RELIANCE,,12-06-2026,NSE,EQ,EQ,buy,false,10,2950.00,Z1,ZO1,12-06-2026 09:21:34,
RELIANCE,,12-06-2026,NSE,EQ,EQ,sell,false,10,2980.00,Z2,ZO2,12-06-2026 15:05:12,
`;

describe("Zerodha day-first timestamp parses to the correct calendar date", () => {
  const { headers, rows } = load(ZERODHA_DAYFIRST);
  it("parses '12-06-2026' as 12 Jun (day-first), not 06 Dec", () => {
    const trades = pairFillsToTrades(detectBroker(headers)!.toFills(rows, headers), "acc", "zero");
    expect(trades).toHaveLength(1);
    // 12 Jun (the broker's day-first date), not 06 Dec. `iso()` applies the same
    // local→UTC conversion as parseTimestamp, so the assert is timezone-agnostic;
    // the old `new Date("12-06-2026")` path would have yielded a December date.
    expect(trades[0]!.opened_at).toBe(iso("2026-06-12T09:21:34"));
    expect(trades[0]!.closed_at).toBe(iso("2026-06-12T15:05:12"));
  });
});

// ───────────────────── SEG-03: Product column mapping ─────────────────────
describe("mapProduct — broker product code → Product enum", () => {
  it("maps the canonical codes", () => {
    expect(mapProduct("CNC")).toBe("CNC");
    expect(mapProduct("MIS")).toBe("MIS");
    expect(mapProduct("NRML")).toBe("NRML");
  });

  it("maps MARGIN/CO/BO/cover/bracket → NRML (carry basis)", () => {
    expect(mapProduct("MARGIN")).toBe("NRML");
    expect(mapProduct("CO")).toBe("NRML");
    expect(mapProduct("BO")).toBe("NRML");
    expect(mapProduct("COVER")).toBe("NRML");
    expect(mapProduct("BRACKET")).toBe("NRML");
  });

  it("maps verbose / alias forms", () => {
    expect(mapProduct("DELIVERY")).toBe("CNC");
    expect(mapProduct("Intraday")).toBe("MIS");
    expect(mapProduct("NORMAL")).toBe("NRML");
    expect(mapProduct("Carry Forward")).toBe("NRML");
    expect(mapProduct("BTST")).toBe("BTST");
    expect(mapProduct("STBT")).toBe("STBT");
  });

  it("blank / unrecognised → null (lets buildTrade infer)", () => {
    expect(mapProduct("")).toBeNull();
    expect(mapProduct(undefined)).toBeNull();
    expect(mapProduct("???")).toBeNull();
  });
});

describe("Fyers Product column → fill.product", () => {
  const { headers, rows } = load(FYERS);
  it("reads the broker Product column per row", () => {
    const fills = detectBroker(headers)!.toFills(rows, headers);
    expect(fills.find((f) => f.symbol === "NIFTY")?.product).toBe("NRML"); // MARGIN → NRML
    expect(fills.find((f) => f.symbol === "SBIN")?.product).toBe("CNC"); // CNC
  });

  it("threads the parsed product into the built trade (CNC equity = delivery)", () => {
    const trades = pairFillsToTrades(detectBroker(headers)!.toFills(rows, headers), "acc", "fyers");
    const sbin = trades.find((t) => t.symbol === "SBIN")!;
    // Open SBIN buy would infer MIS without a column; the CNC column wins.
    expect(sbin.product).toBe("CNC");
    expect(sbin.segment).toBe("EQ");
  });
});

const ANGEL_ONE_PRODUCT = `
Trade Date,Trade Time,Exchange,Segment,Symbol Name,Transaction Type,Quantity,Trade Price,Product Type,Order No,Trade No
12-06-2026,09:30:15,NSE,EQ,TCS,BUY,5,3890.00,DELIVERY,A1,T1
13-06-2026,10:30:15,NSE,EQ,TCS,SELL,5,3950.00,DELIVERY,A2,T2
12-06-2026,11:30:15,NSE,EQ,WIPRO,BUY,20,520.00,INTRADAY,A3,T3
12-06-2026,14:30:15,NSE,EQ,WIPRO,SELL,20,524.00,INTRADAY,A4,T4
`;

describe("Angel One Product Type column → delivery vs intraday charges", () => {
  const { headers, rows } = load(ANGEL_ONE_PRODUCT);
  it("classifies CNC (DELIVERY) vs MIS (INTRADAY) from the column", () => {
    const fills = detectBroker(headers)!.toFills(rows, headers);
    expect(fills.find((f) => f.symbol === "TCS")?.product).toBe("CNC");
    expect(fills.find((f) => f.symbol === "WIPRO")?.product).toBe("MIS");
  });

  it("imported EQ-CNC row computes DELIVERY charges (both-sides STT + DP), not intraday", () => {
    const trades = pairFillsToTrades(
      detectBroker(headers)!.toFills(rows, headers),
      "acc",
      "angelone"
    );
    const tcs = trades.find((t) => t.symbol === "TCS")!;
    expect(tcs.product).toBe("CNC");
    expect(tcs.status).toBe("closed");
    // Cross-check against the charge engine directly with the SAME inputs.
    const profile = getChargeProfile("angelone");
    const expected = computeCharges(profile, {
      segment: "EQ",
      product: "CNC",
      qty: 5,
      entryPrice: 3890,
      exitPrice: 3950,
      direction: "long",
      orders: 2,
    });
    expect(tcs.charges).toBe(Math.round(expected.total * 100) / 100);
    // Delivery STT is 0.1% BOTH sides + ₹15.34 DP, far above the intraday line.
    const asIntraday = computeCharges(profile, {
      segment: "EQ",
      product: "MIS",
      qty: 5,
      entryPrice: 3890,
      exitPrice: 3950,
      direction: "long",
      orders: 2,
    });
    expect(expected.total).toBeGreaterThan(asIntraday.total);
    expect(expected.dpCharge).toBeGreaterThan(0);
  });
});

// ───────────────── SEG-03: MCX (COMM) + currency (CDS) on import ─────────────────
const FYERS_MCX = `
Client ID,Symbol,Trade Date and Time,Exchange,Segment,Transaction Type,Product,Qty,Traded Price,Order No,Trade No
AB1,MCX:CRUDEOIL24JUNFUT,12-06-2026 11:00:00,MCX,COM,BUY,NRML,100,6500.00,O1,T1
AB1,MCX:CRUDEOIL24JUNFUT,12-06-2026 14:00:00,MCX,COM,SELL,NRML,100,6560.00,O2,T2
`;

describe("Fyers MCX symbol → COMM segment on import", () => {
  const { headers, rows } = load(FYERS_MCX);
  it("classifies an MCX contract as COMM (not EQ/FUT) and carries product", () => {
    const fills = detectBroker(headers)!.toFills(rows, headers);
    expect(fills).toHaveLength(2);
    expect(fills[0]).toMatchObject({ symbol: "CRUDEOIL", segment: "COMM", product: "NRML" });
    const trades = pairFillsToTrades(fills, "acc", "fyers");
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      symbol: "CRUDEOIL",
      segment: "COMM",
      product: "NRML",
      status: "closed",
      // Non-agri MCX commodity persists the MCX segment default (SEG-CHG).
      exchange: "MCX",
    });
  });
});

// An NCDEX agri commodity must persist exchange === "NCDEX" so the charge engine
// applies the NCDEX exchange-transaction rate (the MCX default undercharges it).
const FYERS_NCDEX = `
Client ID,Symbol,Trade Date and Time,Exchange,Segment,Transaction Type,Product,Qty,Traded Price,Order No,Trade No
AB1,NCDEX:GUARSEED10,12-06-2026 11:00:00,NCDEX,COM,BUY,NRML,10,5400.00,O1,T1
AB1,NCDEX:GUARSEED10,12-06-2026 14:00:00,NCDEX,COM,SELL,NRML,10,5460.00,O2,T2
`;

describe("NCDEX agri commodity → exchange 'NCDEX' on import (SEG-CHG)", () => {
  const { headers, rows } = load(FYERS_NCDEX);
  it("persists exchange='NCDEX' (not the MCX default) for an NCDEX agri base", () => {
    const fills = detectBroker(headers)!.toFills(rows, headers);
    expect(fills[0]).toMatchObject({ symbol: "GUARSEED10", segment: "COMM" });
    const trades = pairFillsToTrades(fills, "acc", "fyers");
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      symbol: "GUARSEED10",
      segment: "COMM",
      exchange: "NCDEX",
    });
  });
});

const FYERS_CDS = `
Client ID,Symbol,Trade Date and Time,Exchange,Segment,Transaction Type,Product,Qty,Traded Price,Order No,Trade No
AB1,NSE:USDINR24JUN83.5CE,12-06-2026 11:00:00,CDS,FO,BUY,NRML,1000,0.42,O1,T1
AB1,NSE:USDINR24JUN83.5CE,12-06-2026 14:00:00,CDS,FO,SELL,NRML,1000,0.58,O2,T2
`;

describe("Fyers USDINR decimal-strike option → CDS segment on import", () => {
  const { headers, rows } = load(FYERS_CDS);
  it("classifies USDINR as CDS, preserving decimal strike + CE", () => {
    const fills = detectBroker(headers)!.toFills(rows, headers);
    expect(fills[0]).toMatchObject({
      symbol: "USDINR",
      segment: "CDS",
      strike: 83.5,
      optionType: "CE",
      product: "NRML",
    });
    const trades = pairFillsToTrades(fills, "acc", "fyers");
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      symbol: "USDINR",
      segment: "CDS",
      strike: 83.5,
      option_type: "CE",
    });
    // CDS carries no STT/CTT — the transaction-tax line is zero.
    const charges = computeCharges(getChargeProfile("fyers"), {
      segment: "CDS",
      product: "NRML",
      qty: 1000,
      entryPrice: 0.42,
      exitPrice: 0.58,
      direction: "long",
      orders: 2,
    });
    expect(charges.stt).toBe(0);
  });
});

// ───────────────────────── cross-cutting safety ─────────────────────────
describe("detector + pairing safety", () => {
  it("unknown headers fall back to manual mapping (null)", () => {
    expect(detectBroker(["foo", "bar", "baz"])).toBeNull();
  });

  it("same base symbol, different strikes never merge and get distinct ids", () => {
    const mk = (strike: number, side: "buy" | "sell", time: string): RawFill => ({
      symbol: "NIFTY",
      segment: "OPT",
      strike,
      optionType: "CE",
      side,
      qty: 75,
      price: 100,
      time: iso(time),
      expiry: "2026-06-25",
    });
    const fills = [
      mk(24500, "buy", "2026-06-12T09:30:00"),
      mk(24600, "buy", "2026-06-12T09:30:00"),
      mk(24500, "sell", "2026-06-12T10:00:00"),
      mk(24600, "sell", "2026-06-12T10:00:00"),
    ];
    const trades = pairFillsToTrades(fills, "acc", "zero");
    expect(trades).toHaveLength(2);
    expect(new Set(trades.map((t) => t.id)).size).toBe(2);
    expect(trades.map((t) => t.strike).sort()).toEqual([24500, 24600]);
  });

  it("adding a product to a fill does NOT change the dedupe id (back-compat)", () => {
    const base: RawFill = {
      symbol: "TCS",
      segment: "EQ",
      strike: null,
      optionType: null,
      side: "buy",
      qty: 5,
      price: 3890,
      time: iso("2026-06-12T09:30:00"),
      expiry: null,
    };
    const exit: RawFill = { ...base, side: "sell", price: 3950, time: iso("2026-06-13T15:00:00") };
    const withoutProduct = pairFillsToTrades([base, exit], "acc", "zero");
    const withProduct = pairFillsToTrades(
      [
        { ...base, product: "CNC" },
        { ...exit, product: "CNC" },
      ],
      "acc",
      "zero"
    );
    expect(withProduct.map((t) => t.id)).toEqual(withoutProduct.map((t) => t.id));
    expect(withProduct[0]!.product).toBe("CNC");
    expect(withoutProduct[0]!.product).toBe("CNC"); // inferred (overnight EQ)
  });

  it("re-parsing the same broker rows yields identical ids across all 6 mappers", () => {
    for (const fixture of [UPSTOX, ANGEL_ONE, DHAN, FYERS, GROWW, ZERODHA]) {
      const { headers, rows } = load(fixture);
      const spec = detectBroker(headers)!;
      const a = pairFillsToTrades(spec.toFills(rows, headers), "acc", "zero");
      const b = pairFillsToTrades(spec.toFills(rows, headers), "acc", "zero");
      expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
    }
  });
});
