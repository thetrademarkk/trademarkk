import { describe, expect, it } from "vitest";
import { parseContractName } from "@/features/trades/instrument-parse";
import {
  assembleFill,
  assembleFills,
  isExecutedStatus,
  KITE_POSITIONS_VERSION,
  parseFilledQty,
  parseTradeTime,
  resolveTradeSide,
  type RawTradebookRow,
} from "./kite-positions";

const DAY = "2026-06-12";

const baseRow = (over: Partial<RawTradebookRow> = {}): RawTradebookRow => ({
  symbolText: "INFY",
  exchangeText: "NSE",
  sideText: "BUY",
  sideClasses: ["buy"],
  qtyText: "10 / 10",
  priceText: "1456.75",
  statusText: "COMPLETE",
  timeText: "10:30:45",
  ...over,
});

describe("isExecutedStatus", () => {
  it("matches Kite's completed/executed states", () => {
    expect(isExecutedStatus("COMPLETE")).toBe(true);
    expect(isExecutedStatus("Completed")).toBe(true);
    expect(isExecutedStatus("EXECUTED")).toBe(true);
  });
  it("rejects pending/cancelled/rejected states", () => {
    expect(isExecutedStatus("OPEN")).toBe(false);
    expect(isExecutedStatus("REJECTED")).toBe(false);
    expect(isExecutedStatus("CANCELLED AMO")).toBe(false);
  });
});

describe("resolveTradeSide", () => {
  it("reads the buy/sell row/cell class", () => {
    expect(resolveTradeSide(["buy"], "")).toBe("buy");
    expect(resolveTradeSide(["sell"], "")).toBe("sell");
  });
  it("falls back to BUY/SELL text", () => {
    expect(resolveTradeSide([], "BUY")).toBe("buy");
    expect(resolveTradeSide([], "Sell")).toBe("sell");
  });
  it("never guesses — ambiguous or missing markers → null", () => {
    expect(resolveTradeSide([], "")).toBeNull();
    expect(resolveTradeSide(["buy", "sell"], "")).toBeNull();
    expect(resolveTradeSide([], "Modify")).toBeNull();
  });
});

describe("parseFilledQty", () => {
  it("reads the filled side of Kite's filled/total cell", () => {
    expect(parseFilledQty("10 / 10")).toBe(10);
    expect(parseFilledQty("75 / 150")).toBe(75);
    expect(parseFilledQty("1,250 / 1,250")).toBe(1250);
  });
  it("reads a plain quantity", () => {
    expect(parseFilledQty("30")).toBe(30);
  });
  it("rejects zero / garbage (never invents a qty)", () => {
    expect(parseFilledQty("0 / 10")).toBeNull();
    expect(parseFilledQty("")).toBeNull();
    expect(parseFilledQty("--")).toBeNull();
  });
});

describe("parseTradeTime", () => {
  it("anchors a bare clock to the page's trading day", () => {
    const iso = parseTradeTime("10:30:45", DAY);
    expect(iso).not.toBeNull();
    expect(new Date(iso!).getMinutes()).toBe(30);
    expect(iso!.slice(0, 10)).toBe(
      new Date(`${DAY}T10:30:45`).toISOString().slice(0, 10)
    );
  });
  it("parses a full broker date+time", () => {
    const iso = parseTradeTime("2026-06-10 14:05:00", DAY);
    expect(iso).not.toBeNull();
    expect(iso!.slice(0, 10)).toBe(new Date("2026-06-10T14:05:00").toISOString().slice(0, 10));
  });
  it("handles HH:MM without seconds", () => {
    expect(parseTradeTime("09:15", DAY)).not.toBeNull();
  });
  it("unreadable time → null (never invents one)", () => {
    expect(parseTradeTime("", DAY)).toBeNull();
    expect(parseTradeTime("just now", DAY)).toBeNull();
    expect(parseTradeTime("10:30:45", "")).toBeNull();
  });
});

describe("assembleFill", () => {
  it("builds a versioned executed buy fill", () => {
    const fill = assembleFill(baseRow(), DAY);
    expect(fill).toMatchObject({
      broker: "kite",
      adapterVersion: KITE_POSITIONS_VERSION,
      symbol: "INFY",
      exchange: "NSE",
      side: "buy",
      qty: 10,
      price: 1456.75,
    });
    expect(fill!.time).not.toBeNull();
  });

  it("maps an option sell row and parses the contract", () => {
    const fill = assembleFill(
      baseRow({
        symbolText: "NIFTY2661924500CE",
        exchangeText: "NFO",
        sideText: "SELL",
        sideClasses: ["sell"],
        qtyText: "75 / 75",
        priceText: "145.30",
      }),
      DAY
    );
    expect(fill).toMatchObject({ side: "sell", qty: 75, price: 145.3, exchange: "NFO" });
    expect(parseContractName(fill!.symbol)).toMatchObject({
      symbol: "NIFTY",
      segment: "OPT",
      strike: 24500,
      optionType: "CE",
    });
  });

  it("skips rejected / cancelled / pending rows (never imports them)", () => {
    expect(assembleFill(baseRow({ statusText: "REJECTED" }), DAY)).toBeNull();
    expect(assembleFill(baseRow({ statusText: "CANCELLED AMO" }), DAY)).toBeNull();
    expect(assembleFill(baseRow({ statusText: "OPEN" }), DAY)).toBeNull();
  });

  it("allows an executed row even when the status cell is empty", () => {
    expect(assembleFill(baseRow({ statusText: "" }), DAY)).not.toBeNull();
  });

  it("a non-executed, non-rejected status is still skipped", () => {
    expect(assembleFill(baseRow({ statusText: "AMO REQ RECEIVED" }), DAY)).toBeNull();
  });

  it("skips (never guesses) when side is ambiguous", () => {
    expect(assembleFill(baseRow({ sideClasses: [], sideText: "" }), DAY)).toBeNull();
  });

  it("skips when qty or price is zero/garbage", () => {
    expect(assembleFill(baseRow({ qtyText: "0 / 0" }), DAY)).toBeNull();
    expect(assembleFill(baseRow({ priceText: "0" }), DAY)).toBeNull();
    expect(assembleFill(baseRow({ priceText: "" }), DAY)).toBeNull();
  });

  it("skips when the symbol is unparseable/empty", () => {
    expect(assembleFill(baseRow({ symbolText: " " }), DAY)).toBeNull();
  });

  it("drops an unknown exchange token instead of forwarding it", () => {
    const fill = assembleFill(baseRow({ exchangeText: "WEIRD" }), DAY);
    expect(fill!.exchange).toBeNull();
  });
});

describe("assembleFills", () => {
  it("keeps only the trustworthy rows from a mixed tradebook", () => {
    const rows: RawTradebookRow[] = [
      baseRow(), // good buy
      baseRow({ sideClasses: ["sell"], sideText: "SELL", priceText: "1470.00" }), // good sell
      baseRow({ statusText: "REJECTED" }), // dropped
      baseRow({ sideClasses: [], sideText: "" }), // ambiguous → dropped
      baseRow({ qtyText: "0 / 10" }), // zero qty → dropped
    ];
    const fills = assembleFills(rows, DAY);
    expect(fills).toHaveLength(2);
    expect(fills.map((f) => f.side)).toEqual(["buy", "sell"]);
  });

  it("empty input → empty output", () => {
    expect(assembleFills([], DAY)).toEqual([]);
  });
});
