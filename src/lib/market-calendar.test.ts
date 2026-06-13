import { describe, expect, it } from "vitest";
import {
  MARKET_HOLIDAYS_2026,
  getFestiveGreeting,
  holidayName,
  isMarketHoliday,
  isTradingDay,
  isWeekend,
  nextTradingDay,
  toIstDateKey,
} from "./market-calendar";

describe("toIstDateKey", () => {
  it("passes through a YYYY-MM-DD calendar day unchanged", () => {
    expect(toIstDateKey("2026-01-26")).toBe("2026-01-26");
  });

  it("projects a UTC instant into the IST calendar day", () => {
    // 2026-01-25 20:00 UTC is 2026-01-26 01:30 IST.
    expect(toIstDateKey(new Date("2026-01-25T20:00:00.000Z"))).toBe("2026-01-26");
  });
});

describe("isMarketHoliday", () => {
  it("Republic Day (2026-01-26) is a holiday for NSE/BSE/MCX", () => {
    expect(isMarketHoliday("2026-01-26", "NSE")).toBe(true);
    expect(isMarketHoliday("2026-01-26", "BSE")).toBe(true);
    expect(isMarketHoliday("2026-01-26", "MCX")).toBe(true);
  });

  it("a normal mid-week non-holiday is not a holiday", () => {
    // 2026-06-10 is a Wednesday with no listed holiday.
    expect(isMarketHoliday("2026-06-10", "NSE")).toBe(false);
  });

  it("does not treat a weekend as a holiday on its own", () => {
    // 2026-06-14 is a Sunday but not a *listed* holiday.
    expect(isMarketHoliday("2026-06-14", "NSE")).toBe(false);
  });
});

describe("isWeekend", () => {
  it("flags Sunday and Saturday, not weekdays", () => {
    expect(isWeekend("2026-06-14")).toBe(true); // Sunday
    expect(isWeekend("2026-06-27")).toBe(true); // Saturday
    expect(isWeekend("2026-06-10")).toBe(false); // Wednesday
  });
});

describe("isTradingDay", () => {
  it("Republic Day is non-trading", () => {
    expect(isTradingDay("2026-01-26", "NSE")).toBe(false);
  });

  it("a normal mid-week non-holiday is a trading day", () => {
    expect(isTradingDay("2026-06-10", "NSE")).toBe(true);
    expect(isTradingDay("2026-06-10", "MCX")).toBe(true);
  });

  it("a Sunday is non-trading", () => {
    expect(isTradingDay("2026-06-14", "NSE")).toBe(false);
    expect(isTradingDay("2026-06-14", "MCX")).toBe(false);
  });
});

describe("nextTradingDay", () => {
  it("skips a weekend", () => {
    // Wed 2026-06-10 -> Thu 2026-06-11 (next day already trades).
    expect(nextTradingDay("2026-06-10", "NSE")).toBe("2026-06-11");
    // Fri 2026-01-23 -> skips Sat/Sun -> Mon 2026-01-26 is Republic Day -> Tue 2026-01-27.
    expect(nextTradingDay("2026-01-23", "NSE")).toBe("2026-01-27");
  });

  it("skips a holiday that bleeds into a weekend", () => {
    // Fri 2026-06-26 (Muharram) -> Sat 27 / Sun 28 weekend -> Mon 2026-06-29.
    expect(nextTradingDay("2026-06-26", "NSE")).toBe("2026-06-29");
    // Christmas Fri 2026-12-25 -> Sat 26 / Sun 27 -> Mon 2026-12-28.
    expect(nextTradingDay("2026-12-25", "NSE")).toBe("2026-12-28");
  });
});

describe("holidayName", () => {
  it("returns the holiday name on a holiday and null otherwise", () => {
    expect(holidayName("2026-01-26", "NSE")).toBe("Republic Day");
    expect(holidayName("2026-06-10", "NSE")).toBeNull();
  });
});

describe("getFestiveGreeting", () => {
  it("returns a friendly message on a holiday", () => {
    expect(getFestiveGreeting("2026-01-26")).toBe(
      "Happy Republic Day — markets are closed today 🇮🇳"
    );
  });

  it("returns null on a plain trading day", () => {
    expect(getFestiveGreeting("2026-06-10")).toBeNull();
  });

  it("returns null on a plain weekend (no listed holiday)", () => {
    expect(getFestiveGreeting("2026-06-14")).toBeNull();
  });
});

describe("MARKET_HOLIDAYS_2026 data integrity", () => {
  it("lists 16 NSE/BSE equity holidays", () => {
    const nse = MARKET_HOLIDAYS_2026.filter((h) => h.exchanges.includes("NSE"));
    const bse = MARKET_HOLIDAYS_2026.filter((h) => h.exchanges.includes("BSE"));
    expect(nse).toHaveLength(16);
    expect(bse).toHaveLength(16);
  });

  it("every entry uses a valid YYYY-MM-DD 2026 date", () => {
    for (const h of MARKET_HOLIDAYS_2026) {
      expect(h.date).toMatch(/^2026-\d{2}-\d{2}$/);
      expect(h.exchanges.length).toBeGreaterThan(0);
    }
  });
});
