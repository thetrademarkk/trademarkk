import { describe, expect, it } from "vitest";
import { isPendingCapture } from "./capture";

const valid = {
  broker: "kite",
  adapterVersion: 1,
  symbol: "INFY",
  exchange: "NSE",
  side: "buy",
  qty: 75,
  price: 1520.4,
  capturedAt: 1765500000000,
};

describe("isPendingCapture", () => {
  it("accepts a complete capture", () => {
    expect(isPendingCapture(valid)).toBe(true);
  });

  it("accepts null exchange/qty/price (optional fields)", () => {
    expect(isPendingCapture({ ...valid, exchange: null, qty: null, price: null })).toBe(true);
  });

  it("rejects non-objects and missing fields", () => {
    expect(isPendingCapture(null)).toBe(false);
    expect(isPendingCapture("kite")).toBe(false);
    expect(isPendingCapture({ ...valid, capturedAt: undefined })).toBe(false);
  });

  it("rejects unknown brokers and sides (privilege boundary)", () => {
    expect(isPendingCapture({ ...valid, broker: "evil" })).toBe(false);
    expect(isPendingCapture({ ...valid, side: "long" })).toBe(false);
  });

  it("rejects empty symbols and non-finite numbers", () => {
    expect(isPendingCapture({ ...valid, symbol: "  " })).toBe(false);
    expect(isPendingCapture({ ...valid, qty: Number.NaN })).toBe(false);
    expect(isPendingCapture({ ...valid, price: Number.POSITIVE_INFINITY })).toBe(false);
  });
});
