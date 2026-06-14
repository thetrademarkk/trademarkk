import { describe, expect, it } from "vitest";
import { parseContractName } from "@/features/trades/instrument-parse";
import {
  assembleDhanCapture,
  DHAN_ADAPTER_VERSION,
  normalizeDhanExchange,
  normalizeDhanInstrumentText,
  resolveDhanSide,
  type RawDhanPanelFields,
} from "./dhan";

describe("normalizeDhanInstrumentText", () => {
  it("keeps plain equity symbols", () => {
    expect(normalizeDhanInstrumentText("RELIANCE")).toBe("RELIANCE");
    expect(normalizeDhanInstrumentText("  infy ")).toBe("INFY");
  });

  it("strips a leading exchange prefix (NSE:, BSE )", () => {
    expect(normalizeDhanInstrumentText("NSE:RELIANCE")).toBe("RELIANCE");
    expect(normalizeDhanInstrumentText("NSE: RELIANCE")).toBe("RELIANCE");
    expect(normalizeDhanInstrumentText("BSE SBIN")).toBe("SBIN");
  });

  it("takes the tradingsymbol after a pipe-keyed instrument string", () => {
    expect(normalizeDhanInstrumentText("NSE_EQ|RELIANCE")).toBe("RELIANCE");
    expect(normalizeDhanInstrumentText("NSE_FNO|NIFTY24AUG24000CE")).toBe("NIFTY24AUG24000CE");
  });

  it("strips standalone exchange tokens from spaced names", () => {
    expect(normalizeDhanInstrumentText("RELIANCE NSE")).toBe("RELIANCE");
    expect(normalizeDhanInstrumentText("NIFTY 24500 CE NFO")).toBe("NIFTY 24500 CE");
  });

  it("passes Dhan's compact derivative tradingsymbols through untouched", () => {
    // Dhan is derivatives-heavy and renders F&O as compact tradingsymbols.
    expect(normalizeDhanInstrumentText("NIFTY24AUG24000CE")).toBe("NIFTY24AUG24000CE");
    expect(normalizeDhanInstrumentText("BANKNIFTY24JUN52000CE")).toBe("BANKNIFTY24JUN52000CE");
    expect(normalizeDhanInstrumentText("NIFTY2461324500PE")).toBe("NIFTY2461324500PE");
  });

  it("preserves the TradingView terminal's spaced contract names for the parser", () => {
    expect(normalizeDhanInstrumentText("NIFTY 25 JUN 2026 24500 CALL")).toBe(
      "NIFTY 25 JUN 2026 24500 CALL"
    );
    expect(normalizeDhanInstrumentText("BANKNIFTY 26JUN2026 52000 PE")).toBe(
      "BANKNIFTY 26JUN2026 52000 PE"
    );
  });

  it("drops ordinal day suffixes so the app parser sees clean dates", () => {
    expect(normalizeDhanInstrumentText("NIFTY 25th JUN 2026 24500 CALL")).toBe(
      "NIFTY 25 JUN 2026 24500 CALL"
    );
  });

  it("keeps symbol punctuation (&, -, .)", () => {
    expect(normalizeDhanInstrumentText("M&M")).toBe("M&M");
    expect(normalizeDhanInstrumentText("BAJAJ-AUTO")).toBe("BAJAJ-AUTO");
  });

  it("empty / decoration-only input → empty string", () => {
    expect(normalizeDhanInstrumentText("")).toBe("");
    expect(normalizeDhanInstrumentText(" ₹ ")).toBe("");
  });

  it("normalized compact Dhan option parses as the right contract", () => {
    const parsed = parseContractName(normalizeDhanInstrumentText("NSE_FNO|NIFTY24AUG24000CE"));
    expect(parsed).toMatchObject({
      symbol: "NIFTY",
      segment: "OPT",
      strike: 24000,
      optionType: "CE",
    });
  });

  it("normalized spaced Dhan option parses as the right contract", () => {
    const parsed = parseContractName(normalizeDhanInstrumentText("NIFTY 25 JUN 2026 24500 CALL"));
    expect(parsed).toMatchObject({
      symbol: "NIFTY",
      segment: "OPT",
      strike: 24500,
      optionType: "CE",
      expiry: "2026-06-25",
    });
  });
});

describe("normalizeDhanExchange", () => {
  it("reads MCX / CDS / NCD commodity & currency exchange tokens", () => {
    expect(normalizeDhanExchange("MCX")).toBe("MCX");
    expect(normalizeDhanExchange("MCX • Commodity")).toBe("MCX");
    expect(normalizeDhanExchange("CDS")).toBe("CDS");
    expect(normalizeDhanExchange("NCD")).toBe("NCD");
  });

  it("recognizes a bare exchange code", () => {
    expect(normalizeDhanExchange("NSE")).toBe("NSE");
    expect(normalizeDhanExchange("nfo")).toBe("NFO");
    expect(normalizeDhanExchange("mcx")).toBe("MCX");
  });

  it("picks the exchange out of Dhan segment styling", () => {
    expect(normalizeDhanExchange("NSE_EQ")).toBe("NSE");
    expect(normalizeDhanExchange("NSE • Equity")).toBe("NSE");
    expect(normalizeDhanExchange("NSE F&O")).toBe("NSE");
    expect(normalizeDhanExchange("BSE FNO")).toBe("BSE");
  });

  it("unknown / missing exchange text → null", () => {
    expect(normalizeDhanExchange("Equity")).toBeNull();
    expect(normalizeDhanExchange("")).toBeNull();
  });
});

describe("resolveDhanSide", () => {
  it("reads a buy/sell class fragment on the window", () => {
    expect(resolveDhanSide(["orderWindow", "buy"], "", "")).toBe("buy");
    expect(resolveDhanSide(["order-window--sell"], "", "")).toBe("sell");
    expect(resolveDhanSide(["order_window_buy"], "", "")).toBe("buy");
  });

  it("falls back to the active side-tab text", () => {
    expect(resolveDhanSide(["orderWindow"], "Buy", "")).toBe("buy");
    expect(resolveDhanSide(["orderWindow"], "SELL", "")).toBe("sell");
  });

  it("falls back to the order button copy", () => {
    expect(resolveDhanSide(["orderWindow"], "", "Buy RELIANCE")).toBe("buy");
    expect(resolveDhanSide(["orderWindow"], "", "Place sell order")).toBe("sell");
  });

  it("never guesses: ambiguous or missing markers → null", () => {
    expect(resolveDhanSide(["orderWindow"], "", "Place order")).toBeNull();
    expect(resolveDhanSide(["orderWindow", "buy", "sell"], "", "")).toBeNull();
    expect(resolveDhanSide(["orderWindow"], "Buy / Sell", "")).toBeNull();
  });

  it("does not match 'buy' inside an unrelated class token", () => {
    // "buyer-info" must NOT register as a buy side.
    expect(resolveDhanSide(["buyerinfo"], "", "")).toBeNull();
  });
});

const baseFields: RawDhanPanelFields = {
  symbolText: "RELIANCE",
  exchangeText: "NSE",
  qtyText: "50",
  priceText: "2980.40",
  priceDisabled: false,
  lastPriceText: "₹2,979.95",
  panelClasses: ["orderWindow", "buy"],
  activeTabText: "Buy",
  submitText: "Buy RELIANCE",
};

describe("assembleDhanCapture", () => {
  it("builds a versioned capture from a limit buy", () => {
    expect(assembleDhanCapture(baseFields)).toEqual({
      broker: "dhan",
      adapterVersion: DHAN_ADAPTER_VERSION,
      symbol: "RELIANCE",
      exchange: "NSE",
      side: "buy",
      qty: 50,
      price: 2980.4,
    });
  });

  it("market order (price input disabled) falls back to the last price", () => {
    const c = assembleDhanCapture({ ...baseFields, priceDisabled: true });
    expect(c?.price).toBe(2979.95);
  });

  it("a missing price input (treated as market) also falls back to the last price", () => {
    const c = assembleDhanCapture({ ...baseFields, priceDisabled: true, priceText: "" });
    expect(c?.price).toBe(2979.95);
  });

  it("zero price (untouched market field) also falls back to the last price", () => {
    const c = assembleDhanCapture({ ...baseFields, priceText: "0" });
    expect(c?.price).toBe(2979.95);
  });

  it("degrades to null fields instead of inventing qty/price", () => {
    const c = assembleDhanCapture({
      ...baseFields,
      qtyText: "",
      priceText: "",
      lastPriceText: "",
    });
    expect(c).toMatchObject({ qty: null, price: null });
  });

  it("returns null when the symbol can't be trusted (changed DOM)", () => {
    expect(assembleDhanCapture({ ...baseFields, symbolText: " " })).toBeNull();
  });

  it("returns null when the side can't be trusted (never guess direction)", () => {
    expect(
      assembleDhanCapture({
        ...baseFields,
        panelClasses: ["orderWindow"],
        activeTabText: "",
        submitText: "Place order",
      })
    ).toBeNull();
  });

  it("unknown exchange text is dropped, not forwarded", () => {
    const c = assembleDhanCapture({ ...baseFields, exchangeText: "Equity" });
    expect(c?.exchange).toBeNull();
  });

  it("reads exchange out of Dhan's segment styling", () => {
    const c = assembleDhanCapture({ ...baseFields, exchangeText: "NSE F&O" });
    expect(c?.exchange).toBe("NSE");
  });

  it("buy-side compact option order maps cleanly to the contract parser", () => {
    const c = assembleDhanCapture({
      ...baseFields,
      symbolText: "NIFTY24AUG24000CE",
      exchangeText: "NFO",
      qtyText: "75",
      priceText: "182.50",
    });
    expect(c).toMatchObject({ side: "buy", qty: 75, price: 182.5, exchange: "NFO" });
    expect(parseContractName(c!.symbol)).toMatchObject({
      symbol: "NIFTY",
      segment: "OPT",
      strike: 24000,
      optionType: "CE",
    });
  });

  it("sell-side spaced option market order falls back to LTP and parses", () => {
    const c = assembleDhanCapture({
      ...baseFields,
      symbolText: "NIFTY 25 JUN 2026 24500 CALL",
      exchangeText: "NFO",
      panelClasses: ["orderWindow", "sell"],
      activeTabText: "Sell",
      submitText: "Place sell order",
      qtyText: "75",
      priceDisabled: true,
      lastPriceText: "145.30",
    });
    expect(c).toMatchObject({ side: "sell", qty: 75, price: 145.3, exchange: "NFO" });
    expect(parseContractName(c!.symbol)).toMatchObject({
      symbol: "NIFTY",
      segment: "OPT",
      strike: 24500,
      optionType: "CE",
    });
  });

  it("MCX commodity future → COMM segment, MCX exchange read from styling", () => {
    const c = assembleDhanCapture({
      ...baseFields,
      symbolText: "CRUDEOIL24JUNFUT",
      exchangeText: "MCX • Commodity",
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

  it("NCDEX agri commodity (spaced security name) → COMM flagged agri", () => {
    const c = assembleDhanCapture({
      ...baseFields,
      symbolText: "NCDEX: GUARSEED10",
      exchangeText: "NCD",
      qtyText: "10",
      priceText: "5125",
    });
    // The contract parser still classifies the agri commodity from its base.
    expect(parseContractName(c!.symbol)).toMatchObject({ segment: "COMM", agri: true });
  });

  it("CDS currency future → CDS segment with the CDS exchange", () => {
    const c = assembleDhanCapture({
      ...baseFields,
      symbolText: "USDINR24JUNFUT",
      exchangeText: "CDS",
      qtyText: "1",
      priceText: "83.4525",
    });
    expect(c).toMatchObject({ exchange: "CDS", price: 83.4525 });
    expect(parseContractName(c!.symbol)).toMatchObject({
      symbol: "USDINR",
      segment: "CDS",
      agri: false,
    });
  });
});
