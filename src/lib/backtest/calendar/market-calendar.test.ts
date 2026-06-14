import { describe, expect, it } from "vitest";
import {
  addDays,
  expiryFor,
  isHoliday,
  isTradingDay,
  isWeekend,
  monthlyExpiry,
  nextTradingDay,
  prevTradingDay,
  rollBackToTradingDay,
  tradingDays,
  tradingDaysToExpiry,
  weekdayOf,
  weeklyExpiryOnOrAfter,
} from "./market-calendar";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_START, NSE_BSE_HOLIDAYS } from "./calendar.data";
import { EXPIRY_RULES, expiryRuleFor } from "./expiry-rules";

describe("date helpers", () => {
  it("weekdayOf is IST-stable (midday-UTC anchored)", () => {
    expect(weekdayOf("2024-01-04")).toBe(4); // Thursday
    expect(weekdayOf("2025-06-15")).toBe(0); // Sunday
  });

  it("isWeekend flags Sat/Sun only", () => {
    expect(isWeekend("2024-06-15")).toBe(true); // Sat
    expect(isWeekend("2024-06-16")).toBe(true); // Sun
    expect(isWeekend("2024-06-17")).toBe(false); // Mon
  });

  it("addDays crosses month/year boundaries", () => {
    expect(addDays("2024-02-28", 2)).toBe("2024-03-01"); // leap year
    expect(addDays("2023-12-31", 1)).toBe("2024-01-01");
    expect(addDays("2024-01-01", -1)).toBe("2023-12-31");
  });
});

describe("isTradingDay", () => {
  it("Republic Day is closed", () => {
    expect(isHoliday("2024-01-26")).toBe(true);
    expect(isTradingDay("2024-01-26", "NIFTY")).toBe(false);
  });

  it("a normal weekday is open", () => {
    expect(isTradingDay("2024-06-12", "NIFTY")).toBe(true); // a Wednesday, no holiday
  });

  it("weekends are closed even without a listed holiday", () => {
    expect(isHoliday("2024-06-15")).toBe(false);
    expect(isTradingDay("2024-06-15", "NIFTY")).toBe(false);
  });

  it("gates each index before its data start", () => {
    // SENSEX data starts 2022; NIFTY/BANKNIFTY 2021-05.
    expect(isTradingDay("2021-06-03", "SENSEX")).toBe(false); // before SENSEX start
    expect(isTradingDay("2021-06-03", "NIFTY")).toBe(true); // after NIFTY start
    expect(isTradingDay("2021-04-01", "NIFTY")).toBe(false); // before NIFTY start (2021-05)
    expect(DATA_START.SENSEX).toBe("2022-01-01");
  });

  it("rejects a malformed day key", () => {
    expect(() => isTradingDay("2024/01/26", "NIFTY")).toThrow();
  });
});

describe("trading-day navigation", () => {
  it("nextTradingDay skips the weekend", () => {
    // 2024-06-21 is a Friday with no holiday → next is Monday 06-24.
    expect(nextTradingDay("2024-06-21", "NIFTY")).toBe("2024-06-24");
  });

  it("nextTradingDay skips a holiday + weekend run", () => {
    // 2024-03-29 Good Friday, 30/31 weekend → next is Mon 2024-04-01.
    expect(nextTradingDay("2024-03-28", "NIFTY")).toBe("2024-04-01");
  });

  it("prevTradingDay skips backwards over a holiday", () => {
    // Day before Republic Day 2024-01-26 (Fri) is Thursday 01-25.
    expect(prevTradingDay("2024-01-26", "NIFTY")).toBe("2024-01-25");
  });

  it("tradingDays enumerates the spine without weekends/holidays", () => {
    const days = tradingDays("2024-01-22", "2024-01-29", "NIFTY");
    // Mon22 Tue23 Wed24 Thu25 [Fri26 holiday] [Sat/Sun] Mon29
    expect(days).toEqual(["2024-01-22", "2024-01-23", "2024-01-24", "2024-01-25", "2024-01-29"]);
  });
});

describe("expiry-rule windows (dated)", () => {
  it("NIFTY is Thursday throughout", () => {
    expect(expiryRuleFor("NIFTY", "2021-06-01").weekday).toBe(4);
    expect(expiryRuleFor("NIFTY", "2025-06-01").weekday).toBe(4);
  });

  it("BANKNIFTY weekly is unavailable after 2024-11-20", () => {
    expect(expiryRuleFor("BANKNIFTY", "2024-06-01").weeklyAvailable).toBe(true);
    expect(expiryRuleFor("BANKNIFTY", "2025-06-01").weeklyAvailable).toBe(false);
  });

  it("SENSEX flips Friday → Tuesday in 2025", () => {
    expect(expiryRuleFor("SENSEX", "2024-06-01").weekday).toBe(5);
    expect(expiryRuleFor("SENSEX", "2025-06-01").weekday).toBe(2);
  });
});

/**
 * GOLDEN expiry table — the single most important correctness test in the
 * calendar. A wrong weekday silently corrupts EVERY weekly backtest, so we pin
 * the resolved expiry for a query day against >=20 KNOWN historical expiries
 * spanning all three indices, both weekly + monthly, and the 2024-25 churn.
 *
 * Each row: [index, kind, queryDay, expectedExpiry]. The queryDay is some
 * trading day in the week/month whose expiry is `expectedExpiry`.
 */
describe("GOLDEN expiry resolution table (>=20 known expiries)", () => {
  const GOLDEN: ReadonlyArray<
    [Parameters<typeof expiryFor>[0], Parameters<typeof expiryFor>[2], string, string]
  > = [
    // ── NIFTY weekly (Thursday) ──
    ["NIFTY", "WEEKLY", "2021-06-01", "2021-06-03"],
    ["NIFTY", "WEEKLY", "2022-01-03", "2022-01-06"],
    ["NIFTY", "WEEKLY", "2023-03-20", "2023-03-23"],
    ["NIFTY", "WEEKLY", "2024-01-01", "2024-01-04"],
    ["NIFTY", "WEEKLY", "2024-07-22", "2024-07-25"],
    // queryDay IS the Thursday expiry → 0 roll
    ["NIFTY", "WEEKLY", "2024-01-04", "2024-01-04"],
    // ── NIFTY monthly (last Thursday) ──
    ["NIFTY", "MONTHLY", "2021-05-03", "2021-05-27"],
    ["NIFTY", "MONTHLY", "2022-12-01", "2022-12-29"],
    ["NIFTY", "MONTHLY", "2023-06-01", "2023-06-29"],
    ["NIFTY", "MONTHLY", "2024-02-01", "2024-02-29"], // leap-year last Thursday
    // ── SENSEX weekly Friday (≤2024) ──
    ["SENSEX", "WEEKLY", "2023-03-13", "2023-03-17"],
    ["SENSEX", "WEEKLY", "2023-12-26", "2023-12-29"],
    ["SENSEX", "WEEKLY", "2024-01-01", "2024-01-05"],
    ["SENSEX", "WEEKLY", "2024-09-09", "2024-09-13"],
    // ── SENSEX weekly Tuesday (2025) ──
    ["SENSEX", "WEEKLY", "2025-01-06", "2025-01-07"],
    ["SENSEX", "WEEKLY", "2025-03-17", "2025-03-18"],
    ["SENSEX", "WEEKLY", "2025-06-16", "2025-06-17"],
    // ── BANKNIFTY weekly Thursday (pre-discontinuation) ──
    ["BANKNIFTY", "WEEKLY", "2023-06-26", "2023-06-29"],
    ["BANKNIFTY", "WEEKLY", "2024-01-22", "2024-01-25"],
    ["BANKNIFTY", "WEEKLY", "2024-11-11", "2024-11-14"],
    // ── BANKNIFTY monthly Thursday (after weekly discontinuation 2024-11-20) ──
    // WEEKLY rule falls back to MONTHLY because weeklyAvailable === false.
    ["BANKNIFTY", "WEEKLY", "2025-01-06", "2025-01-30"],
    ["BANKNIFTY", "MONTHLY", "2024-12-02", "2024-12-26"],
    ["BANKNIFTY", "MONTHLY", "2025-06-02", "2025-06-26"],
  ];

  it.each(GOLDEN)("%s %s on %s → expiry %s", (index, kind, query, expected) => {
    expect(expiryFor(index, query, kind)).toBe(expected);
  });

  it("has at least 20 golden rows", () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(20);
  });
});

describe("holiday roll-back of expiries (the silent-corruption guard)", () => {
  it("NIFTY Thursday expiry on a holiday rolls back to Wednesday", () => {
    // 2022-04-14 (Thu) = Ambedkar/Mahavir Jayanti holiday → expiry rolls to Wed 04-13.
    expect(isHoliday("2022-04-14")).toBe(true);
    expect(expiryFor("NIFTY", "2022-04-11", "WEEKLY")).toBe("2022-04-13");
  });

  it("SENSEX Friday expiry on Good Friday rolls back to Thursday", () => {
    // 2023-04-07 (Fri) = Good Friday holiday → SENSEX weekly rolls to Thu 04-06.
    expect(isHoliday("2023-04-07")).toBe(true);
    expect(expiryFor("SENSEX", "2023-04-03", "WEEKLY")).toBe("2023-04-06");
  });

  it("does NOT roll when the expiry weekday itself is a trading day", () => {
    // 2024-04-17 (Wed) is Ram Navami, but NIFTY expiry is Thu 04-18 (open) → no roll.
    expect(isHoliday("2024-04-17")).toBe(true);
    expect(isTradingDay("2024-04-18", "NIFTY")).toBe(true);
    expect(expiryFor("NIFTY", "2024-04-15", "WEEKLY")).toBe("2024-04-18");
  });

  it("rollBackToTradingDay walks back over a holiday+weekend", () => {
    // 2024-03-30 (Sat) → 03-29 Good Friday → 03-28 Thursday (open).
    expect(rollBackToTradingDay("2024-03-30", "NIFTY")).toBe("2024-03-28");
  });

  it("NEXT_WEEKLY clears the current week when the rule weekday is a holiday (CORR-05)", () => {
    // 2022-04-14 (Thu) is a holiday → NIFTY WEEKLY rolls back to Wed 2022-04-13.
    // NEXT_WEEKLY must advance a FULL week from the UNROLLED Thursday (04-14), to
    // the next week's Thursday 2022-04-21 — NOT collapse back onto 04-13.
    expect(isHoliday("2022-04-14")).toBe(true);
    expect(isTradingDay("2022-04-21", "NIFTY")).toBe(true);
    const weekly = expiryFor("NIFTY", "2022-04-11", "WEEKLY");
    const nextWeekly = expiryFor("NIFTY", "2022-04-11", "NEXT_WEEKLY");
    expect(weekly).toBe("2022-04-13"); // rolled back over the Thursday holiday
    expect(nextWeekly).toBe("2022-04-21");
    expect(nextWeekly > weekly).toBe(true); // the silent-collapse guard
  });
});

describe("NEXT_WEEKLY + weekly/monthly building blocks", () => {
  it("NEXT_WEEKLY is one week past the nearest weekly", () => {
    expect(expiryFor("NIFTY", "2024-01-01", "WEEKLY")).toBe("2024-01-04");
    expect(expiryFor("NIFTY", "2024-01-01", "NEXT_WEEKLY")).toBe("2024-01-11");
  });

  it("weeklyExpiryOnOrAfter returns the current week's expiry", () => {
    expect(weeklyExpiryOnOrAfter("NIFTY", "2024-07-22")).toBe("2024-07-25");
  });

  it("monthlyExpiry returns the last matching weekday of the month", () => {
    expect(monthlyExpiry("NIFTY", "2023-06-15")).toBe("2023-06-29");
  });

  it("WEEKLY rolls to next week once the current week's expiry has passed", () => {
    // Friday 2024-01-05 is after Thursday 01-04's expiry → next weekly 01-11.
    expect(expiryFor("NIFTY", "2024-01-05", "WEEKLY")).toBe("2024-01-11");
  });
});

describe("tradingDaysToExpiry (daysFromExpiry filter source)", () => {
  it("is 0 on the expiry day itself", () => {
    expect(tradingDaysToExpiry("NIFTY", "2024-01-04", "WEEKLY")).toBe(0);
  });

  it("counts trading days to the upcoming Thursday", () => {
    // Mon 2024-01-01 → Thu 2024-01-04 = Tue,Wed,Thu = 3 trading days.
    expect(tradingDaysToExpiry("NIFTY", "2024-01-01", "WEEKLY")).toBe(3);
  });
});

describe("holiday table integrity", () => {
  it("covers 2021–2027", () => {
    for (let y = 2021; y <= 2027; y++) {
      expect(NSE_BSE_HOLIDAYS[y]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("every holiday is a valid YYYY-MM-DD and not a weekend listing error", () => {
    for (const days of Object.values(NSE_BSE_HOLIDAYS)) {
      for (const d of days) {
        expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});

describe("generated public JSON matches the TS source of truth", () => {
  it("nse-bse-calendar.json holidays/rules/data-starts are not drifted", () => {
    const path = join(process.cwd(), "public", "backtest", "calendar", "nse-bse-calendar.json");
    const json = JSON.parse(readFileSync(path, "utf8")) as {
      holidays: Record<string, string[]>;
      dataStart: Record<string, string>;
      expiryRules: Record<string, { weekday: number; weeklyAvailable: boolean }[]>;
    };
    // Holidays: same dates per year (run scripts/gen-market-calendar.mjs after a data edit).
    for (const [year, days] of Object.entries(NSE_BSE_HOLIDAYS)) {
      expect(json.holidays[year]).toEqual([...days]);
    }
    expect(json.dataStart).toEqual(DATA_START);
    // Expiry rule weekdays + availability survive the round-trip.
    for (const idx of Object.keys(EXPIRY_RULES)) {
      const tsWeekdays = EXPIRY_RULES[idx as keyof typeof EXPIRY_RULES].map((w) => w.weekday);
      const jsonWeekdays = (json.expiryRules[idx] ?? []).map((w) => w.weekday);
      expect(jsonWeekdays).toEqual(tsWeekdays);
    }
  });
});
