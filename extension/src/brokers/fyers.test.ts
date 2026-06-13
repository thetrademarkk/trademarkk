import { describe, expect, it } from "vitest";
import { parseContractName } from "@/features/trades/instrument-parse";
import {
  assembleFyersCapture,
  FYERS_ADAPTER_VERSION,
  normalizeFyersExchange,
  normalizeFyersInstrumentText,
  resolveFyersSide,
  type RawFyersPanelFields,
} from "./fyers";

describe("normalizeFyersInstrumentText", () => {
  it("preserves Fyers' native exchange-prefixed equity key for the parser", () => {
    // Fyers' canonical symbol is "<EXCHANGE>:SYMBOL-SERIES" — parseContractName
    // strips the prefix + series itself, so the normalizer keeps it verbatim.
    expect(normalizeFyersInstrumentText("NSE:SBIN-EQ")).toBe("NSE:SBIN-EQ");
    expect(normalizeFyersInstrumentText("  nse:reliance-eq ")).toBe("NSE:RELIANCE-EQ");
    expect(normalizeFyersInstrumentText("BSE:TCS-A")).toBe("BSE:TCS-A");
  });

  it("preserves Fyers' native exchange-prefixed derivative keys", () => {
    expect(normalizeFyersInstrumentText("NSE:NIFTY24JUN24500CE")).toBe("NSE:NIFTY24JUN24500CE");
    expect(normalizeFyersInstrumentText("MCX:CRUDEOIL24JUNFUT")).toBe("MCX:CRUDEOIL24JUNFUT");
  });

  it("trims decoration around a native key but keeps prefix/suffix", () => {
    expect(normalizeFyersInstrumentText("NSE:SBIN-EQ ●")).toBe("NSE:SBIN-EQ");
  });

  it("keeps a plain equity symbol when no exchange prefix is present", () => {
    expect(normalizeFyersInstrumentText("SBIN")).toBe("SBIN");
    expect(normalizeFyersInstrumentText("  infy ")).toBe("INFY");
  });

  it("takes the tradingsymbol after a pipe-keyed instrument string", () => {
    expect(normalizeFyersInstrumentText("NSE_EQ|SBIN")).toBe("SBIN");
    expect(normalizeFyersInstrumentText("NSE_FNO|NIFTY24JUN24500CE")).toBe("NIFTY24JUN24500CE");
  });

  it("strips a leading exchange prefix from a NON-native bare name", () => {
    // "NSE RELIANCE" (space, no series suffix) isn't a Fyers key — clean it.
    expect(normalizeFyersInstrumentText("NSE RELIANCE")).toBe("RELIANCE");
  });

  it("strips standalone exchange tokens from spaced names", () => {
    expect(normalizeFyersInstrumentText("RELIANCE NSE")).toBe("RELIANCE");
    expect(normalizeFyersInstrumentText("NIFTY 24500 CE NFO")).toBe("NIFTY 24500 CE");
  });

  it("passes a compact derivative tradingsymbol through untouched", () => {
    expect(normalizeFyersInstrumentText("NIFTY24JUN24500CE")).toBe("NIFTY24JUN24500CE");
    expect(normalizeFyersInstrumentText("BANKNIFTY24JUN52000CE")).toBe("BANKNIFTY24JUN52000CE");
  });

  it("keeps symbol punctuation (&, -, .)", () => {
    expect(normalizeFyersInstrumentText("M&M")).toBe("M&M");
    expect(normalizeFyersInstrumentText("BAJAJ-AUTO")).toBe("BAJAJ-AUTO");
  });

  it("empty / decoration-only input → empty string", () => {
    expect(normalizeFyersInstrumentText("")).toBe("");
    expect(normalizeFyersInstrumentText(" ₹ ")).toBe("");
  });

  it("normalized native equity key parses as the right plain symbol", () => {
    const parsed = parseContractName(normalizeFyersInstrumentText("NSE:SBIN-EQ"));
    expect(parsed).toMatchObject({ symbol: "SBIN", segment: "EQ" });
  });

  it("normalized native option key parses as the right contract", () => {
    const parsed = parseContractName(normalizeFyersInstrumentText("NSE:NIFTY24JUN24500CE"));
    expect(parsed).toMatchObject({
      symbol: "NIFTY",
      segment: "OPT",
      strike: 24500,
      optionType: "CE",
    });
  });
});

describe("normalizeFyersExchange", () => {
  it("recognizes a bare exchange code", () => {
    expect(normalizeFyersExchange("NSE")).toBe("NSE");
    expect(normalizeFyersExchange("nfo")).toBe("NFO");
    expect(normalizeFyersExchange("mcx")).toBe("MCX");
  });

  it("picks the exchange out of Fyers segment styling", () => {
    expect(normalizeFyersExchange("NSE:")).toBe("NSE");
    expect(normalizeFyersExchange("NSE • Equity")).toBe("NSE");
    expect(normalizeFyersExchange("MCX Commodity")).toBe("MCX");
  });

  it("reads the exchange out of a native Fyers symbol key", () => {
    expect(normalizeFyersExchange("NSE:SBIN-EQ")).toBe("NSE");
    expect(normalizeFyersExchange("MCX:CRUDEOIL24JUNFUT")).toBe("MCX");
  });

  it("unknown / missing exchange text → null", () => {
    expect(normalizeFyersExchange("Equity")).toBeNull();
    expect(normalizeFyersExchange("")).toBeNull();
  });
});

describe("resolveFyersSide", () => {
  it("reads a buy/sell class fragment on the window", () => {
    expect(resolveFyersSide(["orderWindow", "buy"], "", "")).toBe("buy");
    expect(resolveFyersSide(["order-window--sell"], "", "")).toBe("sell");
    expect(resolveFyersSide(["order_window_buy"], "", "")).toBe("buy");
  });

  it("falls back to the active side-tab text", () => {
    expect(resolveFyersSide(["orderWindow"], "Buy", "")).toBe("buy");
    expect(resolveFyersSide(["orderWindow"], "SELL", "")).toBe("sell");
  });

  it("falls back to the order button copy", () => {
    expect(resolveFyersSide(["orderWindow"], "", "Buy SBIN")).toBe("buy");
    expect(resolveFyersSide(["orderWindow"], "", "Place sell order")).toBe("sell");
  });

  it("never guesses: ambiguous or missing markers → null", () => {
    expect(resolveFyersSide(["orderWindow"], "", "Place order")).toBeNull();
    expect(resolveFyersSide(["orderWindow", "buy", "sell"], "", "")).toBeNull();
    expect(resolveFyersSide(["orderWindow"], "Buy / Sell", "")).toBeNull();
  });

  it("does not match 'buy' inside an unrelated class token", () => {
    // "buyer-info" must NOT register as a buy side.
    expect(resolveFyersSide(["buyerinfo"], "", "")).toBeNull();
  });
});

const baseFields: RawFyersPanelFields = {
  symbolText: "NSE:SBIN-EQ",
  exchangeText: "NSE",
  qtyText: "50",
  priceText: "612.40",
  priceDisabled: false,
  lastPriceText: "₹611.95",
  panelClasses: ["orderWindow", "buy"],
  activeTabText: "Buy",
  submitText: "Buy SBIN",
};

describe("assembleFyersCapture", () => {
  it("builds a versioned capture from a limit buy", () => {
    expect(assembleFyersCapture(baseFields)).toEqual({
      broker: "fyers",
      adapterVersion: FYERS_ADAPTER_VERSION,
      symbol: "NSE:SBIN-EQ",
      exchange: "NSE",
      side: "buy",
      qty: 50,
      price: 612.4,
    });
  });

  it("market order (price input disabled) falls back to the last price", () => {
    const c = assembleFyersCapture({ ...baseFields, priceDisabled: true });
    expect(c?.price).toBe(611.95);
  });

  it("a missing price input (treated as market) also falls back to the last price", () => {
    const c = assembleFyersCapture({ ...baseFields, priceDisabled: true, priceText: "" });
    expect(c?.price).toBe(611.95);
  });

  it("zero price (untouched market field) also falls back to the last price", () => {
    const c = assembleFyersCapture({ ...baseFields, priceText: "0" });
    expect(c?.price).toBe(611.95);
  });

  it("degrades to null fields instead of inventing qty/price", () => {
    const c = assembleFyersCapture({
      ...baseFields,
      qtyText: "",
      priceText: "",
      lastPriceText: "",
    });
    expect(c).toMatchObject({ qty: null, price: null });
  });

  it("returns null when the symbol can't be trusted (changed DOM)", () => {
    expect(assembleFyersCapture({ ...baseFields, symbolText: " " })).toBeNull();
  });

  it("returns null when the side can't be trusted (never guess direction)", () => {
    expect(
      assembleFyersCapture({
        ...baseFields,
        panelClasses: ["orderWindow"],
        activeTabText: "",
        submitText: "Place order",
      })
    ).toBeNull();
  });

  it("reads the exchange from the native symbol key when no tag is present", () => {
    const c = assembleFyersCapture({ ...baseFields, exchangeText: "" });
    expect(c?.exchange).toBe("NSE");
  });

  it("falls back to the symbol's exchange when the tag text is unknown", () => {
    const c = assembleFyersCapture({ ...baseFields, exchangeText: "Equity" });
    expect(c?.exchange).toBe("NSE");
  });

  it("buy-side native option order maps cleanly to the contract parser", () => {
    const c = assembleFyersCapture({
      ...baseFields,
      symbolText: "NSE:NIFTY24JUN24500CE",
      exchangeText: "NFO",
      qtyText: "75",
      priceText: "182.50",
    });
    expect(c).toMatchObject({ side: "buy", qty: 75, price: 182.5, exchange: "NFO" });
    expect(parseContractName(c!.symbol)).toMatchObject({
      symbol: "NIFTY",
      segment: "OPT",
      strike: 24500,
      optionType: "CE",
    });
  });

  it("sell-side native option market order falls back to LTP and parses", () => {
    const c = assembleFyersCapture({
      ...baseFields,
      symbolText: "NSE:BANKNIFTY24JUN52000PE",
      exchangeText: "NFO",
      panelClasses: ["orderWindow", "sell"],
      activeTabText: "Sell",
      submitText: "Place sell order",
      qtyText: "30",
      priceDisabled: true,
      lastPriceText: "145.30",
    });
    expect(c).toMatchObject({ side: "sell", qty: 30, price: 145.3, exchange: "NFO" });
    expect(parseContractName(c!.symbol)).toMatchObject({
      symbol: "BANKNIFTY",
      segment: "OPT",
      strike: 52000,
      optionType: "PE",
    });
  });
});
