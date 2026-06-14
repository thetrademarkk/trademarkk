import { describe, expect, it } from "vitest";
import { parseContractName } from "@/features/trades/instrument-parse";
import {
  assembleCapture,
  KITE_ADAPTER_VERSION,
  normalizeKiteInstrumentText,
  parsePriceText,
  parseQtyText,
  resolveSide,
  type RawOrderPanelFields,
} from "./kite";

describe("normalizeKiteInstrumentText", () => {
  it("keeps plain equity symbols", () => {
    expect(normalizeKiteInstrumentText("SBIN")).toBe("SBIN");
    expect(normalizeKiteInstrumentText("  infy ")).toBe("INFY");
  });

  it("strips standalone exchange tokens", () => {
    expect(normalizeKiteInstrumentText("INFY NSE")).toBe("INFY");
    expect(normalizeKiteInstrumentText("SBIN (BSE)")).toBe("SBIN");
  });

  it("passes compact tradingsymbols through untouched", () => {
    expect(normalizeKiteInstrumentText("BANKNIFTY24JUN52000CE")).toBe("BANKNIFTY24JUN52000CE");
    expect(normalizeKiteInstrumentText("NIFTY2661924500CE")).toBe("NIFTY2661924500CE");
  });

  it("drops ordinal day suffixes so the app parser sees clean dates", () => {
    expect(normalizeKiteInstrumentText("NIFTY 25th JUN 24500 CE")).toBe("NIFTY 25 JUN 24500 CE");
  });

  it("keeps symbol punctuation (&, -, ., :)", () => {
    expect(normalizeKiteInstrumentText("M&M")).toBe("M&M");
    expect(normalizeKiteInstrumentText("BAJAJ-AUTO")).toBe("BAJAJ-AUTO");
    expect(normalizeKiteInstrumentText("NSE:SBIN-EQ")).toBe("NSE:SBIN-EQ");
  });

  it("empty / decoration-only input → empty string", () => {
    expect(normalizeKiteInstrumentText("")).toBe("");
    expect(normalizeKiteInstrumentText(" ₹ ")).toBe("");
  });

  it("normalized weekly Kite symbol parses as the right option", () => {
    const parsed = parseContractName(normalizeKiteInstrumentText("NIFTY2661924500CE NFO"));
    expect(parsed).toMatchObject({ symbol: "NIFTY", segment: "OPT", strike: 24500 });
  });
});

describe("parseQtyText", () => {
  it("parses plain and comma-grouped quantities", () => {
    expect(parseQtyText("75")).toBe(75);
    expect(parseQtyText("1,250")).toBe(1250);
    expect(parseQtyText(" 30 ")).toBe(30);
  });

  it("rejects zero, negatives, fractions and garbage", () => {
    expect(parseQtyText("0")).toBeNull();
    expect(parseQtyText("-5")).toBeNull();
    expect(parseQtyText("12.5")).toBeNull();
    expect(parseQtyText("abc")).toBeNull();
    expect(parseQtyText("")).toBeNull();
  });
});

describe("parsePriceText", () => {
  it("parses currency-decorated and comma-grouped prices", () => {
    expect(parsePriceText("1,520.40")).toBe(1520.4);
    expect(parsePriceText("₹120.50")).toBe(120.5);
    expect(parsePriceText("LTP 145.30")).toBe(145.3);
  });

  it("rejects zero, negative and non-numeric text", () => {
    expect(parsePriceText("0")).toBeNull();
    expect(parsePriceText("0.00")).toBeNull();
    expect(parsePriceText("-12")).toBeNull();
    expect(parsePriceText("")).toBeNull();
    expect(parsePriceText("market")).toBeNull();
  });
});

describe("resolveSide", () => {
  it("reads the order-window buy/sell class", () => {
    expect(resolveSide(["order-window", "buy"], "")).toBe("buy");
    expect(resolveSide(["order-window", "sell"], "")).toBe("sell");
  });

  it("falls back to the submit button text", () => {
    expect(resolveSide(["order-window"], "Buy")).toBe("buy");
    expect(resolveSide(["order-window"], "SELL")).toBe("sell");
  });

  it("never guesses: ambiguous or missing markers → null", () => {
    expect(resolveSide(["order-window"], "Place order")).toBeNull();
    expect(resolveSide(["order-window", "buy", "sell"], "")).toBeNull();
  });
});

const baseFields: RawOrderPanelFields = {
  symbolText: "INFY",
  exchangeText: "NSE",
  qtyText: "75",
  priceText: "1520.40",
  priceDisabled: false,
  lastPriceText: "₹1,519.95",
  panelClasses: ["order-window", "buy"],
  submitText: "Buy",
};

describe("assembleCapture", () => {
  it("builds a versioned capture from a limit buy", () => {
    expect(assembleCapture(baseFields)).toEqual({
      broker: "kite",
      adapterVersion: KITE_ADAPTER_VERSION,
      symbol: "INFY",
      exchange: "NSE",
      side: "buy",
      qty: 75,
      price: 1520.4,
    });
  });

  it("market order (price input disabled) falls back to the last price", () => {
    const c = assembleCapture({ ...baseFields, priceDisabled: true });
    expect(c?.price).toBe(1519.95);
  });

  it("zero price (untouched market field) also falls back to the last price", () => {
    const c = assembleCapture({ ...baseFields, priceText: "0" });
    expect(c?.price).toBe(1519.95);
  });

  it("degrades to null fields instead of inventing qty/price", () => {
    const c = assembleCapture({
      ...baseFields,
      qtyText: "",
      priceText: "",
      lastPriceText: "",
    });
    expect(c).toMatchObject({ qty: null, price: null });
  });

  it("returns null when the symbol or the side can't be trusted", () => {
    expect(assembleCapture({ ...baseFields, symbolText: " " })).toBeNull();
    expect(
      assembleCapture({ ...baseFields, panelClasses: ["order-window"], submitText: "Swap" })
    ).toBeNull();
  });

  it("unknown exchange text is dropped, not forwarded", () => {
    const c = assembleCapture({ ...baseFields, exchangeText: "NSE ₹1,519.95" });
    expect(c?.exchange).toBeNull();
  });

  it("sell-side option order maps cleanly", () => {
    const c = assembleCapture({
      ...baseFields,
      symbolText: "NIFTY2661924500CE",
      exchangeText: "NFO",
      panelClasses: ["order-window", "sell"],
      submitText: "Sell",
      qtyText: "150",
      priceText: "145.30",
    });
    expect(c).toMatchObject({ side: "sell", qty: 150, price: 145.3, exchange: "NFO" });
    expect(parseContractName(c!.symbol)).toMatchObject({
      symbol: "NIFTY",
      segment: "OPT",
      strike: 24500,
      optionType: "CE",
    });
  });

  it("MCX commodity future → COMM segment with the MCX exchange", () => {
    const c = assembleCapture({
      ...baseFields,
      symbolText: "CRUDEOIL24JUNFUT",
      exchangeText: "MCX",
      panelClasses: ["order-window", "buy"],
      submitText: "Buy",
      qtyText: "100",
      priceText: "6540",
    });
    expect(c).toMatchObject({ side: "buy", qty: 100, price: 6540, exchange: "MCX" });
    expect(parseContractName(c!.symbol)).toMatchObject({
      symbol: "CRUDEOIL",
      segment: "COMM",
      agri: false,
    });
  });

  it("MCX commodity OPTION → COMM keeping strike + CE/PE", () => {
    const c = assembleCapture({
      ...baseFields,
      symbolText: "GOLD24JUN72000CE",
      exchangeText: "MCX",
      panelClasses: ["order-window", "sell"],
      submitText: "Sell",
      qtyText: "1",
      priceText: "350",
    });
    expect(c).toMatchObject({ side: "sell", exchange: "MCX" });
    expect(parseContractName(c!.symbol)).toMatchObject({
      symbol: "GOLD",
      segment: "COMM",
      strike: 72000,
      optionType: "CE",
    });
  });

  it("NCDEX agri commodity → COMM flagged agri (CTT-exempt)", () => {
    const c = assembleCapture({
      ...baseFields,
      symbolText: "DHANIYA",
      // The real National Commodity & Derivatives Exchange code is "NCDEX" —
      // it must survive into the capture so the charge engine bills NCDEX
      // (not MCX) slabs rather than dropping the exchange entirely.
      exchangeText: "NCDEX",
      panelClasses: ["order-window", "buy"],
      submitText: "Buy",
      qtyText: "1",
      priceText: "7100",
    });
    expect(c).toMatchObject({ exchange: "NCDEX" });
    expect(c!.symbol).toBe("DHANIYA"); // no leading-space corruption
    expect(parseContractName(c!.symbol)).toMatchObject({
      symbol: "DHANIYA",
      segment: "COMM",
      agri: true,
    });
  });

  it("CDS currency future → CDS segment with the CDS exchange", () => {
    const c = assembleCapture({
      ...baseFields,
      symbolText: "USDINR24JUNFUT",
      exchangeText: "CDS",
      panelClasses: ["order-window", "buy"],
      submitText: "Buy",
      qtyText: "1",
      priceText: "83.4525",
    });
    expect(c).toMatchObject({ side: "buy", price: 83.4525, exchange: "CDS" });
    expect(parseContractName(c!.symbol)).toMatchObject({
      symbol: "USDINR",
      segment: "CDS",
      agri: false,
    });
  });

  it("CDS currency OPTION → CDS keeping the decimal strike + CE/PE", () => {
    const c = assembleCapture({
      ...baseFields,
      symbolText: "USDINR24JUN83.5CE",
      exchangeText: "CDS",
      panelClasses: ["order-window", "buy"],
      submitText: "Buy",
      qtyText: "1",
      priceText: "0.45",
    });
    expect(parseContractName(c!.symbol)).toMatchObject({
      symbol: "USDINR",
      segment: "CDS",
      strike: 83.5,
      optionType: "CE",
    });
  });
});
