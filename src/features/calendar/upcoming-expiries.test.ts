import { describe, it, expect } from "vitest";
import {
  upcomingExpiryDays,
  ncdexSeries,
  allExpirySeries,
  daysBetween,
  EXPIRY_CALENDAR_AS_OF,
} from "./upcoming-expiries";

const TODAY = EXPIRY_CALENDAR_AS_OF; // the snapshot's as-of date → deterministic

describe("daysBetween", () => {
  it("counts calendar days, sign-aware, across months", () => {
    expect(daysBetween("2026-06-20", "2026-06-23")).toBe(3);
    expect(daysBetween("2026-06-23", "2026-06-20")).toBe(-3);
    expect(daysBetween("2026-06-30", "2026-07-01")).toBe(1);
    expect(daysBetween("2026-06-20", "2026-06-20")).toBe(0);
  });
});

describe("NCDEX agri series", () => {
  it("computes the 8 active contracts on the 20th of each upcoming month", () => {
    const s = ncdexSeries(TODAY);
    expect(s).toHaveLength(8);
    expect(s.map((x) => x.underlying)).toContain("GUARSEED");
    for (const x of s) {
      expect(x.exchange).toBe("NCDEX");
      expect(x.kind).toBe("commodity");
      expect(x.expiries[0]).toBe("2026-06-20"); // the 20th == today is included
      for (const d of x.expiries) expect(d.endsWith("-20")).toBe(true);
    }
  });
});

describe("upcomingExpiryDays", () => {
  it("returns ascending, future-only days within the horizon", () => {
    const days = upcomingExpiryDays({ today: TODAY, maxDays: 120 });
    expect(days.length).toBeGreaterThan(5);
    for (let i = 1; i < days.length; i++) expect(days[i]!.date >= days[i - 1]!.date).toBe(true);
    for (const d of days) {
      expect(d.date >= TODAY).toBe(true);
      expect(d.daysAway).toBe(daysBetween(TODAY, d.date));
      expect(d.daysAway).toBeLessThanOrEqual(120);
      expect(d.events.length).toBeGreaterThan(0);
    }
  });

  it("surfaces a NIFTY index expiry and many F&O stocks on a monthly date", () => {
    const days = upcomingExpiryDays({ today: TODAY, exchanges: ["NSE"], maxDays: 60 });
    const niftyDay = days.find((d) => d.events.some((e) => e.underlying === "NIFTY"));
    expect(niftyDay).toBeTruthy();
    // The monthly stock-F&O expiry stacks hundreds of single stocks on one date.
    const busiest = days.reduce((a, b) => (b.events.length > a.events.length ? b : a));
    expect(busiest.events.filter((e) => e.kind === "stock").length).toBeGreaterThan(100);
  });

  it("honours the exchange filter (NCDEX-only shows just NCDEX agri)", () => {
    const days = upcomingExpiryDays({ today: TODAY, exchanges: ["NCDEX"], maxDays: 120 });
    expect(days.length).toBeGreaterThan(0);
    for (const d of days) for (const e of d.events) expect(e.exchange).toBe("NCDEX");
    expect(days[0]!.date).toBe("2026-06-20");
  });

  it("combines all exchanges by default", () => {
    const ex = new Set(allExpirySeries(TODAY).map((s) => s.exchange));
    expect(ex).toEqual(new Set(["NSE", "BSE", "MCX", "NCDEX"]));
  });

  it("filters by instrument type — options include weeklies futures don't", () => {
    const opt = upcomingExpiryDays({
      today: TODAY,
      exchanges: ["NSE"],
      type: "options",
      maxDays: 120,
    });
    const fut = upcomingExpiryDays({
      today: TODAY,
      exchanges: ["NSE"],
      type: "futures",
      maxDays: 120,
    });
    // NSE has weekly options but only monthly futures → more distinct option days.
    expect(opt.length).toBeGreaterThan(fut.length);
    const optDates = new Set(opt.map((d) => d.date));
    const futDates = new Set(fut.map((d) => d.date));
    expect(optDates.has("2026-07-07")).toBe(true); // a NIFTY weekly option expiry
    expect(futDates.has("2026-07-07")).toBe(false); // not a futures expiry
    const nifty = allExpirySeries(TODAY).find(
      (s) => s.underlying === "NIFTY" && s.exchange === "NSE"
    );
    expect(nifty!.options.length).toBeGreaterThan(nifty!.futures.length);
  });
});
