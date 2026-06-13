import { describe, expect, it } from "vitest";
import {
  availableFyYears,
  currentFyStartYear,
  fyLabel,
  fyRange,
  fyStartYear,
  fyStartYearFromIstDate,
  groupByFy,
  istDateKey,
  sameIstDate,
} from "./fy";

describe("istDateKey", () => {
  it("shifts a UTC instant into the IST calendar day", () => {
    // 2026-03-31 20:00 UTC = 2026-04-01 01:30 IST → next day.
    expect(istDateKey("2026-03-31T20:00:00.000Z")).toBe("2026-04-01");
    // 2026-03-31 18:00 UTC = 2026-03-31 23:30 IST → same day.
    expect(istDateKey("2026-03-31T18:00:00.000Z")).toBe("2026-03-31");
  });

  it("is robust to a malformed timestamp", () => {
    expect(istDateKey("garbage-string")).toBe("garbage-st");
  });
});

describe("sameIstDate", () => {
  it("treats an intraday round trip as the same IST day", () => {
    // Opened 04:00 UTC (09:30 IST), closed 09:30 UTC (15:00 IST) — same day.
    expect(sameIstDate("2025-06-10T04:00:00Z", "2025-06-10T09:30:00Z")).toBe(true);
  });

  it("treats an overnight hold as different IST days", () => {
    expect(sameIstDate("2025-06-10T09:00:00Z", "2025-06-11T05:00:00Z")).toBe(false);
  });

  it("uses IST, not UTC, for the day boundary", () => {
    // Both within the same IST day but straddling UTC midnight is not tested
    // here; instead confirm a late-UTC instant rolls into IST tomorrow.
    expect(sameIstDate("2025-06-10T19:00:00Z", "2025-06-10T20:00:00Z")).toBe(true);
    // 18:30 UTC = exactly IST midnight → next IST day.
    expect(istDateKey("2025-06-10T18:30:00Z")).toBe("2025-06-11");
  });
});

describe("financial-year boundaries (Apr 1 → Mar 31 IST)", () => {
  it("1 Apr is the first day of a new FY", () => {
    expect(fyStartYearFromIstDate("2025-04-01")).toBe(2025);
  });

  it("31 Mar is the last day of the previous FY", () => {
    expect(fyStartYearFromIstDate("2026-03-31")).toBe(2025);
    expect(fyStartYearFromIstDate("2025-03-31")).toBe(2024);
  });

  it("Jan/Feb/Mar fall in the FY that began the prior April", () => {
    expect(fyStartYearFromIstDate("2026-01-15")).toBe(2025);
    expect(fyStartYearFromIstDate("2026-02-28")).toBe(2025);
  });

  it("Apr..Dec fall in the FY that began that April", () => {
    expect(fyStartYearFromIstDate("2025-04-30")).toBe(2025);
    expect(fyStartYearFromIstDate("2025-12-31")).toBe(2025);
  });

  it("fyStartYear bridges the IST shift across the FY boundary", () => {
    // 2026-03-31 20:00 UTC is 2026-04-01 IST → FY 2026-27.
    expect(fyStartYear("2026-03-31T20:00:00Z")).toBe(2026);
    // 2026-03-31 17:00 UTC is 2026-03-31 IST → FY 2025-26.
    expect(fyStartYear("2026-03-31T17:00:00Z")).toBe(2025);
  });
});

describe("fyLabel / fyRange", () => {
  it("labels the FY span", () => {
    expect(fyLabel(2025)).toBe("2025-26");
    expect(fyLabel(2009)).toBe("2009-10");
    expect(fyLabel(1999)).toBe("1999-00");
  });

  it("gives the inclusive IST date bounds", () => {
    expect(fyRange(2025)).toEqual({ from: "2025-04-01", to: "2026-03-31" });
  });
});

describe("currentFyStartYear", () => {
  it("classifies a mid-year date", () => {
    expect(currentFyStartYear(new Date("2025-06-13T06:00:00Z"))).toBe(2025);
  });
  it("classifies a January date into the prior April FY", () => {
    expect(currentFyStartYear(new Date("2026-01-05T06:00:00Z"))).toBe(2025);
  });
});

const mk = (closed_at: string | null, over = {}) => ({ closed_at, ...over });

describe("groupByFy", () => {
  it("groups closed trades by realisation FY, newest FY first", () => {
    const groups = groupByFy([
      mk("2024-05-01T05:00:00Z"), // FY 2024-25
      mk("2025-06-01T05:00:00Z"), // FY 2025-26
      mk("2026-01-15T05:00:00Z"), // FY 2025-26
      mk("2025-04-01T05:00:00Z"), // FY 2025-26
    ]);
    expect(groups.map((g) => g.label)).toEqual(["2025-26", "2024-25"]);
    expect(groups[0]!.trades).toHaveLength(3);
    expect(groups[1]!.trades).toHaveLength(1);
  });

  it("drops unrealised (open) trades", () => {
    const groups = groupByFy([mk(null), mk("2025-06-01T05:00:00Z")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.trades).toHaveLength(1);
  });

  it("returns an empty list when nothing is closed", () => {
    expect(groupByFy([mk(null), mk(null)])).toEqual([]);
  });
});

describe("availableFyYears (zero-trade FY stays selectable)", () => {
  it("spans the earliest realised FY through the current FY, descending", () => {
    const now = new Date("2025-06-13T06:00:00Z"); // FY 2025-26
    const years = availableFyYears([mk("2023-05-01T05:00:00Z")], now); // earliest FY 2023-24
    expect(years).toEqual([2025, 2024, 2023]);
    // FY 2024-25 has no trades but is still offered (will be flagged empty).
    expect(years).toContain(2024);
  });

  it("falls back to just the current FY when there are no trades", () => {
    const now = new Date("2025-06-13T06:00:00Z");
    expect(availableFyYears([], now)).toEqual([2025]);
  });
});
