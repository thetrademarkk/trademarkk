import { describe, it, expect } from "vitest";
import {
  addDays,
  EVENT_RESOLVERS,
  eventKey,
  expiriesOn,
  isExpiryDay,
  isMarketClosed,
  istDateKey,
  istWeekday,
  isTradingDay,
  isTradingHoliday,
  isWeekend,
  previousTradingDay,
  resolveActiveEvents,
  shortDate,
  TRADING_HOLIDAYS,
} from "./events";

/** A UTC instant for a given IST wall-clock date+time (IST = UTC+5:30). */
function istInstant(dateKey: string, hh = 10, mm = 0): Date {
  // IST 10:00 == UTC 04:30 same day.
  const [y, m, d] = dateKey.split("-").map(Number);
  const utc = Date.UTC(y!, m! - 1, d!, hh - 5, mm - 30);
  return new Date(utc);
}

describe("istDateKey (IST boundary correctness)", () => {
  it("maps an instant to its IST calendar date", () => {
    // 2026-06-11 10:00 IST → 2026-06-11 04:30 UTC.
    expect(istDateKey(istInstant("2026-06-11", 10, 0))).toBe("2026-06-11");
  });

  it("late-evening IST still falls on the same IST date (not the next UTC day)", () => {
    // 2026-06-11 23:30 IST == 2026-06-11 18:00 UTC — same IST date.
    expect(istDateKey(istInstant("2026-06-11", 23, 30))).toBe("2026-06-11");
  });

  it("just-after-UTC-midnight IST instant is the correct IST date", () => {
    // 2026-06-11 00:05 IST == 2026-06-10 18:35 UTC — still IST 2026-06-11.
    expect(istDateKey(istInstant("2026-06-11", 0, 5))).toBe("2026-06-11");
  });

  it("a UTC instant late on the prior day rolls into the next IST date", () => {
    // 2026-06-10 20:00 UTC == 2026-06-11 01:30 IST.
    expect(istDateKey(new Date("2026-06-10T20:00:00Z"))).toBe("2026-06-11");
  });

  it("returns empty for an invalid date", () => {
    expect(istDateKey(new Date(NaN))).toBe("");
  });
});

describe("weekday / weekend", () => {
  it("computes the IST weekday", () => {
    expect(istWeekday("2026-06-11")).toBe(4); // Thursday
    expect(istWeekday("2026-06-14")).toBe(0); // Sunday
    expect(istWeekday("2026-06-13")).toBe(6); // Saturday
  });

  it("flags weekends", () => {
    expect(isWeekend("2026-06-13")).toBe(true); // Sat
    expect(isWeekend("2026-06-14")).toBe(true); // Sun
    expect(isWeekend("2026-06-11")).toBe(false); // Thu
  });
});

describe("holiday calendar", () => {
  it("recognizes a curated holiday", () => {
    expect(isTradingHoliday("2026-01-26")).toBe(true); // Republic Day
    expect(isTradingHoliday("2026-04-03")).toBe(true); // Good Friday
  });

  it("a normal weekday is not a holiday", () => {
    expect(isTradingHoliday("2026-06-11")).toBe(false);
  });

  it("every curated holiday key is a valid YYYY-MM-DD", () => {
    for (const key of TRADING_HOLIDAYS) {
      expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(istDateKey(istInstant(key))).toBe(key);
    }
  });
});

describe("isTradingDay", () => {
  it("a normal weekday is a trading day", () => {
    expect(isTradingDay("2026-06-11")).toBe(true); // Thu
    expect(isTradingDay("2026-06-12")).toBe(true); // Fri
  });
  it("weekends are NOT trading days", () => {
    expect(isTradingDay("2026-06-13")).toBe(false); // Sat
    expect(isTradingDay("2026-06-14")).toBe(false); // Sun
  });
  it("curated holidays are NOT trading days", () => {
    expect(isTradingDay("2026-04-03")).toBe(false); // Good Friday
    expect(isTradingDay("2026-01-26")).toBe(false); // Republic Day
  });
});

describe("addDays / previousTradingDay", () => {
  it("adds and subtracts calendar days (UTC-noon stable)", () => {
    expect(addDays("2026-06-11", 1)).toBe("2026-06-12");
    expect(addDays("2026-06-11", -1)).toBe("2026-06-10");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01"); // 2026 is not a leap year
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("skips weekends to the previous trading day", () => {
    // Monday 2026-06-15 → previous trading day is Friday 2026-06-12.
    expect(previousTradingDay("2026-06-15")).toBe("2026-06-12");
  });

  it("skips a holiday cluster to the previous trading day", () => {
    // Good Friday 2026-04-03 is a holiday; the day before (Thu 04-02) is open.
    expect(previousTradingDay("2026-04-03")).toBe("2026-04-02");
  });
});

describe("expiriesOn — weekly index expiry derivation", () => {
  it("NIFTY expiry falls on a Thursday", () => {
    expect(expiriesOn("2026-06-11")).toContain("NIFTY"); // Thu
  });

  it("SENSEX expiry falls on a Tuesday", () => {
    expect(expiriesOn("2026-06-09")).toContain("SENSEX"); // Tue
  });

  it("a Wednesday is neither index's expiry (no shift in play)", () => {
    expect(expiriesOn("2026-06-10")).toEqual([]); // Wed, clean week
  });

  it("a weekend is never an expiry day", () => {
    expect(expiriesOn("2026-06-13")).toEqual([]); // Sat
    expect(expiriesOn("2026-06-14")).toEqual([]); // Sun
  });

  it("a holiday is never an expiry day even if it lands on the nominal weekday", () => {
    // 2025-12-25 (Christmas) is a Thursday holiday — NOT an expiry day itself.
    expect(expiriesOn("2025-12-25")).toEqual([]);
  });

  it("holiday-shifts a Thursday-holiday NIFTY expiry to the prior trading day", () => {
    // 2025-04-10 (Mahavir Jayanti) is a Thursday holiday → NIFTY expiry shifts
    // to Wednesday 2025-04-09.
    expect(expiriesOn("2025-04-10")).toEqual([]); // the holiday itself: none
    expect(expiriesOn("2025-04-09")).toContain("NIFTY"); // shifted-to Wed
  });

  it("holiday-shifts a Tuesday-holiday SENSEX expiry to the prior trading day", () => {
    // 2025-10-21 (Diwali) is a Tuesday holiday → SENSEX expiry shifts to Mon
    // 2025-10-20.
    expect(expiriesOn("2025-10-21")).toEqual([]);
    expect(expiriesOn("2025-10-20")).toContain("SENSEX"); // shifted-to Mon
  });

  it("isExpiryDay mirrors expiriesOn", () => {
    expect(isExpiryDay("2026-06-11")).toBe(true); // NIFTY Thu
    expect(isExpiryDay("2026-06-09")).toBe(true); // SENSEX Tue
    expect(isExpiryDay("2026-06-10")).toBe(false); // Wed
    expect(isExpiryDay("2026-06-13")).toBe(false); // Sat
  });
});

describe("resolveActiveEvents", () => {
  it("a normal trading day → a Market Open event", () => {
    const events = resolveActiveEvents(istInstant("2026-06-10", 9, 0)); // Wed
    expect(events.map((e) => e.type)).toEqual(["market-open"]);
    expect(events[0]!.date).toBe("2026-06-10");
    expect(events[0]!.tags).toContain("market-open");
    expect(events[0]!.badge).toMatch(/Market Open · /);
  });

  it("a NIFTY expiry Thursday → Expiry Day (first) + Market Open", () => {
    const events = resolveActiveEvents(istInstant("2026-06-11", 10, 0)); // Thu
    expect(events.map((e) => e.type)).toEqual(["expiry-day", "market-open"]);
    const expiry = events[0]!;
    expect(expiry.title).toContain("NIFTY");
    expect(expiry.tags).toContain("expiry");
    expect(expiry.badge).toContain("Expiry Day");
  });

  it("a SENSEX expiry Tuesday names SENSEX in the title", () => {
    const events = resolveActiveEvents(istInstant("2026-06-09", 10, 0)); // Tue
    const expiry = events.find((e) => e.type === "expiry-day");
    expect(expiry?.title).toContain("SENSEX");
  });

  it("a weekend → NO events (markets closed)", () => {
    expect(resolveActiveEvents(istInstant("2026-06-13", 11, 0))).toEqual([]); // Sat
    expect(resolveActiveEvents(istInstant("2026-06-14", 11, 0))).toEqual([]); // Sun
  });

  it("a curated holiday → NO events", () => {
    expect(resolveActiveEvents(istInstant("2026-04-03", 10, 0))).toEqual([]); // Good Friday
  });

  it("is deterministic — same instant yields identical events", () => {
    const a = resolveActiveEvents(istInstant("2026-06-11", 10, 0));
    const b = resolveActiveEvents(istInstant("2026-06-11", 15, 30));
    expect(a).toEqual(b); // intraday clock does not change the day-level events
  });

  it("orders expiry before market-open", () => {
    const events = resolveActiveEvents(istInstant("2026-06-11", 10, 0));
    expect(events[0]!.order).toBeLessThanOrEqual(events[1]!.order);
    expect(events[0]!.type).toBe("expiry-day");
  });
});

describe("isMarketClosed", () => {
  it("true on weekends and holidays, false on trading days", () => {
    expect(isMarketClosed(istInstant("2026-06-13", 11, 0))).toBe(true); // Sat
    expect(isMarketClosed(istInstant("2026-04-03", 11, 0))).toBe(true); // holiday
    expect(isMarketClosed(istInstant("2026-06-11", 11, 0))).toBe(false); // Thu
  });

  it("is independent of the intraday clock (day-level surface)", () => {
    // 6am IST and 11pm IST on a trading day are both 'open' for the surface.
    expect(isMarketClosed(istInstant("2026-06-11", 6, 0))).toBe(false);
    expect(isMarketClosed(istInstant("2026-06-11", 23, 0))).toBe(false);
  });
});

describe("eventKey (idempotent natural key)", () => {
  it("composes a stable type:date key", () => {
    expect(eventKey("expiry-day", "2026-06-11")).toBe("expiry-day:2026-06-11");
    expect(eventKey("market-open", "2026-06-10")).toBe("market-open:2026-06-10");
  });

  it("the same (type,date) always produces the same key (materialization dedup)", () => {
    const events = resolveActiveEvents(istInstant("2026-06-11", 10, 0));
    const keys = events.map((e) => eventKey(e.type, e.date));
    // Re-deriving on the same day yields the identical key set — the basis for
    // INSERT OR IGNORE idempotency on (event_type, event_date).
    const again = resolveActiveEvents(istInstant("2026-06-11", 14, 0)).map((e) =>
      eventKey(e.type, e.date)
    );
    expect(keys).toEqual(again);
    expect(new Set(keys).size).toBe(keys.length); // no dup keys within a day
  });
});

describe("event-type registry extensibility", () => {
  it("the registry is an ordered, append-only array of pure resolvers", () => {
    expect(Array.isArray(EVENT_RESOLVERS)).toBe(true);
    expect(EVENT_RESOLVERS.length).toBeGreaterThanOrEqual(2);
    // Each resolver is pure: same input → same output, and never throws.
    for (const resolve of EVENT_RESOLVERS) {
      const a = resolve("2026-06-11");
      const b = resolve("2026-06-11");
      expect(a).toEqual(b);
    }
  });

  it("a hypothetical appended resolver composes without touching the engine", () => {
    // Demonstrates extensibility: concatenating a new resolver's output is all
    // it takes — the engine sorts + the key logic is type+date agnostic.
    const extra = (dateKey: string) =>
      dateKey === "2026-06-11"
        ? [
            {
              type: "expiry-day" as const,
              date: dateKey,
              title: "x",
              body: "x",
              tags: [],
              badge: "x",
              order: 5,
            },
          ]
        : [];
    const composed = [...EVENT_RESOLVERS, extra].flatMap((r) => r("2026-06-11"));
    expect(composed.length).toBeGreaterThan(resolveActiveEvents(istInstant("2026-06-11")).length);
  });
});

describe("shortDate", () => {
  it("formats a YYYY-MM-DD key as a short IST date", () => {
    expect(shortDate("2026-06-13")).toMatch(/13 Jun/);
    expect(shortDate("2026-01-26")).toMatch(/26 Jan/);
  });
});
