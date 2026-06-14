import { describe, expect, it } from "vitest";
import { parseContractName } from "@/features/trades/instrument-parse";
import {
  assembleGrowwCapture,
  GROWW_ADAPTER_VERSION,
  normalizeGrowwExchange,
  normalizeGrowwInstrumentText,
  resolveGrowwSide,
  type RawGrowwPanelFields,
} from "./groww";

describe("normalizeGrowwInstrumentText", () => {
  it("keeps plain equity symbols", () => {
    expect(normalizeGrowwInstrumentText("RELIANCE")).toBe("RELIANCE");
    expect(normalizeGrowwInstrumentText("  infy ")).toBe("INFY");
  });

  it("strips a leading exchange prefix (NSE:, BSE )", () => {
    expect(normalizeGrowwInstrumentText("NSE:RELIANCE")).toBe("RELIANCE");
    expect(normalizeGrowwInstrumentText("NSE: RELIANCE")).toBe("RELIANCE");
    expect(normalizeGrowwInstrumentText("BSE SBIN")).toBe("SBIN");
  });

  it("takes the tradingsymbol after a pipe-keyed instrument string", () => {
    expect(normalizeGrowwInstrumentText("NSE_EQ|RELIANCE")).toBe("RELIANCE");
    expect(normalizeGrowwInstrumentText("NSE_FO|NIFTY2661924500CE")).toBe("NIFTY2661924500CE");
  });

  it("strips standalone exchange tokens from spaced names", () => {
    expect(normalizeGrowwInstrumentText("RELIANCE NSE")).toBe("RELIANCE");
    expect(normalizeGrowwInstrumentText("NIFTY 24500 CE NFO")).toBe("NIFTY 24500 CE");
  });

  it("strips a leading NCDEX prefix without leaving a stray 'EX'", () => {
    // The real exchange code is "NCDEX"; the truncated "NCD" alternation alone
    // would match "NCD" first and leave "EX: GUARSEED10" behind.
    expect(normalizeGrowwInstrumentText("NCDEX: GUARSEED10")).toBe("GUARSEED10");
    expect(normalizeGrowwInstrumentText("NCDEX DHANIYA")).toBe("DHANIYA");
  });

  it("preserves Groww's spaced F&O contract names for the parser", () => {
    // Groww renders derivatives as spaced names with CALL/PUT words.
    expect(normalizeGrowwInstrumentText("NIFTY 25 JUN 2026 24500 CALL")).toBe(
      "NIFTY 25 JUN 2026 24500 CALL"
    );
    expect(normalizeGrowwInstrumentText("BANKNIFTY 26JUN2026 52000 CE")).toBe(
      "BANKNIFTY 26JUN2026 52000 CE"
    );
  });

  it("passes compact tradingsymbols through untouched", () => {
    expect(normalizeGrowwInstrumentText("BANKNIFTY24JUN52000CE")).toBe("BANKNIFTY24JUN52000CE");
    expect(normalizeGrowwInstrumentText("NIFTY2661924500CE")).toBe("NIFTY2661924500CE");
  });

  it("drops ordinal day suffixes so the app parser sees clean dates", () => {
    expect(normalizeGrowwInstrumentText("NIFTY 25th JUN 2026 24500 CALL")).toBe(
      "NIFTY 25 JUN 2026 24500 CALL"
    );
  });

  it("keeps symbol punctuation (&, -, .)", () => {
    expect(normalizeGrowwInstrumentText("M&M")).toBe("M&M");
    expect(normalizeGrowwInstrumentText("BAJAJ-AUTO")).toBe("BAJAJ-AUTO");
  });

  it("empty / decoration-only input → empty string", () => {
    expect(normalizeGrowwInstrumentText("")).toBe("");
    expect(normalizeGrowwInstrumentText(" ₹ ")).toBe("");
  });

  it("normalized spaced Groww option parses as the right contract", () => {
    const parsed = parseContractName(normalizeGrowwInstrumentText("NIFTY 25 JUN 2026 24500 CALL"));
    expect(parsed).toMatchObject({
      symbol: "NIFTY",
      segment: "OPT",
      strike: 24500,
      optionType: "CE",
      expiry: "2026-06-25",
    });
  });

  it("normalized compact Groww symbol also parses as the right option", () => {
    const parsed = parseContractName(normalizeGrowwInstrumentText("NSE_FO|BANKNIFTY24JUN52000CE"));
    expect(parsed).toMatchObject({ symbol: "BANKNIFTY", segment: "OPT", strike: 52000 });
  });
});

describe("normalizeGrowwExchange", () => {
  it("recognizes a bare exchange code", () => {
    expect(normalizeGrowwExchange("NSE")).toBe("NSE");
    expect(normalizeGrowwExchange("nfo")).toBe("NFO");
  });

  it("picks the exchange out of Groww segment styling", () => {
    expect(normalizeGrowwExchange("NSE_EQ")).toBe("NSE");
    expect(normalizeGrowwExchange("NSE • Equity")).toBe("NSE");
    expect(normalizeGrowwExchange("BSE F&O")).toBe("BSE");
  });

  it("reads the National Commodity & Derivatives Exchange code 'NCDEX'", () => {
    expect(normalizeGrowwExchange("NCDEX")).toBe("NCDEX");
    expect(normalizeGrowwExchange("NCDEX • Commodity")).toBe("NCDEX");
  });

  it("unknown / missing exchange text → null", () => {
    expect(normalizeGrowwExchange("Equity")).toBeNull();
    expect(normalizeGrowwExchange("")).toBeNull();
  });
});

describe("resolveGrowwSide", () => {
  it("reads a buy/sell class fragment on the pad", () => {
    expect(resolveGrowwSide(["orderPad", "buy"], "", "")).toBe("buy");
    expect(resolveGrowwSide(["order-pad--sell"], "", "")).toBe("sell");
    expect(resolveGrowwSide(["order_pad_buy"], "", "")).toBe("buy");
  });

  it("falls back to the active side-tab text", () => {
    expect(resolveGrowwSide(["orderPad"], "Buy", "")).toBe("buy");
    expect(resolveGrowwSide(["orderPad"], "SELL", "")).toBe("sell");
  });

  it("falls back to the order button copy", () => {
    expect(resolveGrowwSide(["orderPad"], "", "Buy RELIANCE")).toBe("buy");
    expect(resolveGrowwSide(["orderPad"], "", "Place sell order")).toBe("sell");
  });

  it("never guesses: ambiguous or missing markers → null", () => {
    expect(resolveGrowwSide(["orderPad"], "", "Place order")).toBeNull();
    expect(resolveGrowwSide(["orderPad", "buy", "sell"], "", "")).toBeNull();
    expect(resolveGrowwSide(["orderPad"], "Buy / Sell", "")).toBeNull();
  });

  it("does not match 'buy' inside an unrelated class token", () => {
    // "buyer-info" must NOT register as a buy side.
    expect(resolveGrowwSide(["buyerinfo"], "", "")).toBeNull();
  });
});

const baseFields: RawGrowwPanelFields = {
  symbolText: "RELIANCE",
  exchangeText: "NSE",
  qtyText: "50",
  priceText: "2980.40",
  priceDisabled: false,
  lastPriceText: "₹2,979.95",
  panelClasses: ["orderPad", "buy"],
  activeTabText: "Buy",
  submitText: "Buy RELIANCE",
};

describe("assembleGrowwCapture", () => {
  it("builds a versioned capture from a limit buy", () => {
    expect(assembleGrowwCapture(baseFields)).toEqual({
      broker: "groww",
      adapterVersion: GROWW_ADAPTER_VERSION,
      symbol: "RELIANCE",
      exchange: "NSE",
      side: "buy",
      qty: 50,
      price: 2980.4,
    });
  });

  it("market order (price input disabled) falls back to the last price", () => {
    const c = assembleGrowwCapture({ ...baseFields, priceDisabled: true });
    expect(c?.price).toBe(2979.95);
  });

  it("a missing price input (treated as market) also falls back to the last price", () => {
    const c = assembleGrowwCapture({ ...baseFields, priceDisabled: true, priceText: "" });
    expect(c?.price).toBe(2979.95);
  });

  it("zero price (untouched market field) also falls back to the last price", () => {
    const c = assembleGrowwCapture({ ...baseFields, priceText: "0" });
    expect(c?.price).toBe(2979.95);
  });

  it("degrades to null fields instead of inventing qty/price", () => {
    const c = assembleGrowwCapture({
      ...baseFields,
      qtyText: "",
      priceText: "",
      lastPriceText: "",
    });
    expect(c).toMatchObject({ qty: null, price: null });
  });

  it("returns null when the symbol can't be trusted (changed DOM)", () => {
    expect(assembleGrowwCapture({ ...baseFields, symbolText: " " })).toBeNull();
  });

  it("returns null when the side can't be trusted (never guess direction)", () => {
    expect(
      assembleGrowwCapture({
        ...baseFields,
        panelClasses: ["orderPad"],
        activeTabText: "",
        submitText: "Place order",
      })
    ).toBeNull();
  });

  it("unknown exchange text is dropped, not forwarded", () => {
    const c = assembleGrowwCapture({ ...baseFields, exchangeText: "Equity" });
    expect(c?.exchange).toBeNull();
  });

  it("reads exchange out of Groww's segment styling", () => {
    const c = assembleGrowwCapture({ ...baseFields, exchangeText: "NSE • Equity" });
    expect(c?.exchange).toBe("NSE");
  });

  it("NCDEX agri commodity → exchange survives as NCDEX with a clean symbol", () => {
    const c = assembleGrowwCapture({
      ...baseFields,
      symbolText: "NCDEX: GUARSEED10",
      // The real National Commodity & Derivatives Exchange code is "NCDEX".
      exchangeText: "NCDEX • Commodity",
      qtyText: "10",
      priceText: "5125",
    });
    expect(c).toMatchObject({ exchange: "NCDEX" });
    expect(c!.symbol).toBe("GUARSEED10"); // prefix stripped, no leading-space corruption
    expect(parseContractName(c!.symbol)).toMatchObject({ segment: "COMM", agri: true });
  });

  it("sell-side spaced option order maps cleanly to the contract parser", () => {
    const c = assembleGrowwCapture({
      ...baseFields,
      symbolText: "NIFTY 25 JUN 2026 24500 CALL",
      exchangeText: "NFO",
      panelClasses: ["orderPad", "sell"],
      activeTabText: "Sell",
      submitText: "Place sell order",
      qtyText: "75",
      priceText: "145.30",
    });
    expect(c).toMatchObject({ side: "sell", qty: 75, price: 145.3, exchange: "NFO" });
    expect(parseContractName(c!.symbol)).toMatchObject({
      symbol: "NIFTY",
      segment: "OPT",
      strike: 24500,
      optionType: "CE",
    });
  });
});
