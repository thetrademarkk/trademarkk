import { describe, expect, it } from "vitest";
import { deriveTradeNumbers } from "./utils";
import type { TradeFormValues } from "./schemas";

const base: TradeFormValues = {
  accountId: "a",
  symbol: "BANKNIFTY",
  segment: "OPT",
  strike: 52000,
  optionType: "CE",
  direction: "long",
  qty: 30,
  avgEntry: 200,
  avgExit: 250,
  openedAt: "2026-06-11T09:30",
  tagIds: [],
};

describe("deriveTradeNumbers (multi-leg)", () => {
  it("totals gross across legs (long straddle)", () => {
    const d = deriveTradeNumbers(
      {
        ...base,
        extraLegs: [
          {
            strike: 52000,
            optionType: "PE",
            direction: "long",
            qty: 30,
            avgEntry: 180,
            avgExit: 120,
          },
        ],
      },
      "zero" // zero-charge profile isolates the gross math
    );
    // CE: +50×30 = 1500; PE: −60×30 = −1800 → −300
    expect(d.gross).toBe(-300);
    expect(d.status).toBe("closed");
  });

  it("any open leg keeps the whole trade open", () => {
    const d = deriveTradeNumbers(
      {
        ...base,
        extraLegs: [{ direction: "short", qty: 30, avgEntry: 180, avgExit: undefined }],
      },
      "zerodha"
    );
    expect(d.status).toBe("open");
    expect(d.net).toBe(0);
  });

  it("charges sum per leg (flat ₹20/order options → 2 legs = 4 orders)", () => {
    const d = deriveTradeNumbers(
      {
        ...base,
        extraLegs: [
          {
            strike: 52000,
            optionType: "PE",
            direction: "long",
            qty: 30,
            avgEntry: 200,
            avgExit: 250,
          },
        ],
      },
      "zerodha"
    );
    const single = deriveTradeNumbers(base, "zerodha");
    // identical legs → exactly double the charges of the single-leg trade
    expect(d.charges).toBeCloseTo(single.charges * 2, 2);
    expect(d.gross).toBe(single.gross * 2);
  });
});
