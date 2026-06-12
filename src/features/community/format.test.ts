import { describe, expect, it } from "vitest";
import { formatCount, formatPostDate } from "./format";

describe("formatCount", () => {
  it("passes small numbers through", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1)).toBe("1");
    expect(formatCount(999)).toBe("999");
  });

  it("never goes negative or NaN", () => {
    expect(formatCount(-5)).toBe("0");
    expect(formatCount(Number.NaN)).toBe("0");
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe("0");
  });

  it("compacts thousands with one decimal, no trailing .0", () => {
    expect(formatCount(1000)).toBe("1K");
    expect(formatCount(1240)).toBe("1.2K");
    expect(formatCount(12_400)).toBe("12.4K");
    expect(formatCount(999_999)).toBe("999K");
  });

  it("truncates instead of rounding up (1 999 is not 2K)", () => {
    expect(formatCount(1999)).toBe("1.9K");
    expect(formatCount(999_949)).toBe("999K");
  });

  it("compacts millions", () => {
    expect(formatCount(1_000_000)).toBe("1M");
    expect(formatCount(2_400_000)).toBe("2.4M");
    expect(formatCount(120_000_000)).toBe("120M");
  });
});

describe("formatPostDate", () => {
  it("renders an absolute day-month-year + time string", () => {
    // Timezone-agnostic: assert the shape, not the exact wall-clock value.
    expect(formatPostDate("2026-06-12T13:35:00.000Z")).toMatch(
      /^\d{1,2} [A-Za-z]{3} 2026, \d{1,2}:\d{2} (am|pm)$/
    );
  });

  it("returns empty string for malformed input", () => {
    expect(formatPostDate("not-a-date")).toBe("");
    expect(formatPostDate("")).toBe("");
  });
});
