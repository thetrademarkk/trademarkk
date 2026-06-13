import { describe, expect, it } from "vitest";
import { parseContractName } from "@/features/trades/instrument-parse";
import {
  assembleUpstoxCapture,
  normalizeUpstoxExchange,
  normalizeUpstoxInstrumentText,
  resolveUpstoxSide,
  UPSTOX_ADAPTER_VERSION,
  type RawUpstoxPanelFields,
} from "./upstox";

describe("normalizeUpstoxInstrumentText", () => {
  it("keeps plain equity symbols", () => {
    expect(normalizeUpstoxInstrumentText("RELIANCE")).toBe("RELIANCE");
    expect(normalizeUpstoxInstrumentText("  infy ")).toBe("INFY");
  });

  it("strips a leading exchange prefix (NSE:, BSE )", () => {
    expect(normalizeUpstoxInstrumentText("NSE:RELIANCE")).toBe("RELIANCE");
    expect(normalizeUpstoxInstrumentText("BSE SBIN")).toBe("SBIN");
  });

  it("takes the tradingsymbol after Upstox's pipe-keyed instrument string", () => {
    expect(normalizeUpstoxInstrumentText("NSE_EQ|RELIANCE")).toBe("RELIANCE");
    expect(normalizeUpstoxInstrumentText("NSE_FO|NIFTY2661924500CE")).toBe("NIFTY2661924500CE");
  });

  it("strips standalone exchange tokens from spaced names", () => {
    expect(normalizeUpstoxInstrumentText("INFY NSE")).toBe("INFY");
    expect(normalizeUpstoxInstrumentText("NIFTY 24500 CE NFO")).toBe("NIFTY 24500 CE");
  });

  it("passes compact tradingsymbols through untouched", () => {
    expect(normalizeUpstoxInstrumentText("BANKNIFTY24JUN52000CE")).toBe("BANKNIFTY24JUN52000CE");
    expect(normalizeUpstoxInstrumentText("NIFTY2661924500CE")).toBe("NIFTY2661924500CE");
  });

  it("drops ordinal day suffixes so the app parser sees clean dates", () => {
    expect(normalizeUpstoxInstrumentText("NIFTY 13th JUN 24500 CE")).toBe("NIFTY 13 JUN 24500 CE");
  });

  it("keeps symbol punctuation (&, -, .)", () => {
    expect(normalizeUpstoxInstrumentText("M&M")).toBe("M&M");
    expect(normalizeUpstoxInstrumentText("BAJAJ-AUTO")).toBe("BAJAJ-AUTO");
  });

  it("empty / decoration-only input → empty string", () => {
    expect(normalizeUpstoxInstrumentText("")).toBe("");
    expect(normalizeUpstoxInstrumentText(" ₹ ")).toBe("");
  });

  it("normalized weekly Upstox symbol parses as the right option", () => {
    const parsed = parseContractName(normalizeUpstoxInstrumentText("NSE_FO|NIFTY2661924500CE"));
    expect(parsed).toMatchObject({ symbol: "NIFTY", segment: "OPT", strike: 24500 });
  });
});

describe("normalizeUpstoxExchange", () => {
  it("recognizes a bare exchange code", () => {
    expect(normalizeUpstoxExchange("NSE")).toBe("NSE");
    expect(normalizeUpstoxExchange("nfo")).toBe("NFO");
  });

  it("picks the exchange out of Upstox segment styling", () => {
    expect(normalizeUpstoxExchange("NSE_EQ")).toBe("NSE");
    expect(normalizeUpstoxExchange("NSE • Equity")).toBe("NSE");
    expect(normalizeUpstoxExchange("BSE | F&O")).toBe("BSE");
  });

  it("unknown / missing exchange text → null", () => {
    expect(normalizeUpstoxExchange("Equity")).toBeNull();
    expect(normalizeUpstoxExchange("")).toBeNull();
  });
});

describe("resolveUpstoxSide", () => {
  it("reads a buy/sell class fragment on the dialog", () => {
    expect(resolveUpstoxSide(["order-window", "buy"], "", "")).toBe("buy");
    expect(resolveUpstoxSide(["order-ticket--sell"], "", "")).toBe("sell");
    expect(resolveUpstoxSide(["order_window_buy"], "", "")).toBe("buy");
  });

  it("falls back to the active side-tab text", () => {
    expect(resolveUpstoxSide(["order-window"], "Buy", "")).toBe("buy");
    expect(resolveUpstoxSide(["order-window"], "SELL", "")).toBe("sell");
  });

  it("falls back to the confirm button copy", () => {
    expect(resolveUpstoxSide(["order-window"], "", "Confirm to buy")).toBe("buy");
    expect(resolveUpstoxSide(["order-window"], "", "Confirm to sell")).toBe("sell");
  });

  it("never guesses: ambiguous or missing markers → null", () => {
    expect(resolveUpstoxSide(["order-window"], "", "Place order")).toBeNull();
    expect(resolveUpstoxSide(["order-window", "buy", "sell"], "", "")).toBeNull();
    expect(resolveUpstoxSide(["order-window"], "Buy / Sell", "")).toBeNull();
  });

  it("does not match 'buy' inside an unrelated class token", () => {
    // "buyer-info" must NOT register as a buy side.
    expect(resolveUpstoxSide(["buyerinfo"], "", "")).toBeNull();
  });
});

const baseFields: RawUpstoxPanelFields = {
  symbolText: "RELIANCE",
  exchangeText: "NSE",
  qtyText: "50",
  priceText: "2980.40",
  priceDisabled: false,
  lastPriceText: "₹2,979.95",
  panelClasses: ["order-window", "buy"],
  activeTabText: "Buy",
  submitText: "Confirm to buy",
};

describe("assembleUpstoxCapture", () => {
  it("builds a versioned capture from a limit buy", () => {
    expect(assembleUpstoxCapture(baseFields)).toEqual({
      broker: "upstox",
      adapterVersion: UPSTOX_ADAPTER_VERSION,
      symbol: "RELIANCE",
      exchange: "NSE",
      side: "buy",
      qty: 50,
      price: 2980.4,
    });
  });

  it("market order (price input disabled) falls back to the last price", () => {
    const c = assembleUpstoxCapture({ ...baseFields, priceDisabled: true });
    expect(c?.price).toBe(2979.95);
  });

  it("a missing price input (treated as market) also falls back to the last price", () => {
    const c = assembleUpstoxCapture({ ...baseFields, priceDisabled: true, priceText: "" });
    expect(c?.price).toBe(2979.95);
  });

  it("zero price (untouched market field) also falls back to the last price", () => {
    const c = assembleUpstoxCapture({ ...baseFields, priceText: "0" });
    expect(c?.price).toBe(2979.95);
  });

  it("degrades to null fields instead of inventing qty/price", () => {
    const c = assembleUpstoxCapture({
      ...baseFields,
      qtyText: "",
      priceText: "",
      lastPriceText: "",
    });
    expect(c).toMatchObject({ qty: null, price: null });
  });

  it("returns null when the symbol can't be trusted (changed DOM)", () => {
    expect(assembleUpstoxCapture({ ...baseFields, symbolText: " " })).toBeNull();
  });

  it("returns null when the side can't be trusted (never guess direction)", () => {
    expect(
      assembleUpstoxCapture({
        ...baseFields,
        panelClasses: ["order-window"],
        activeTabText: "",
        submitText: "Place order",
      })
    ).toBeNull();
  });

  it("unknown exchange text is dropped, not forwarded", () => {
    const c = assembleUpstoxCapture({ ...baseFields, exchangeText: "Equity" });
    expect(c?.exchange).toBeNull();
  });

  it("reads exchange out of Upstox's category styling", () => {
    const c = assembleUpstoxCapture({ ...baseFields, exchangeText: "NSE • Equity" });
    expect(c?.exchange).toBe("NSE");
  });

  it("sell-side option order maps cleanly to the contract parser", () => {
    const c = assembleUpstoxCapture({
      ...baseFields,
      symbolText: "NSE_FO|NIFTY2661924500CE",
      exchangeText: "NFO",
      panelClasses: ["order-window", "sell"],
      activeTabText: "Sell",
      submitText: "Confirm to sell",
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
