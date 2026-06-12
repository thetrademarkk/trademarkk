import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { detectBroker } from "./csv-brokers";
import { pairFillsToTrades, type RawFill } from "./csv";

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
});
