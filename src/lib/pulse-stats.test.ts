import { describe, expect, it } from "vitest";
import {
  fillDailySeries,
  fillDailyViews,
  formatVitalValue,
  p75,
  rateVital,
  shapePulseTotals,
  summarizeVitals,
} from "./pulse-stats";

const NOW = new Date("2026-06-13T12:00:00.000Z");

describe("fillDailySeries", () => {
  it("zero-fills missing days across the window, oldest first", () => {
    const out = fillDailySeries([{ day: "2026-06-12", count: 3 }], 3, NOW);
    expect(out).toEqual([
      { day: "2026-06-11", count: 0 },
      { day: "2026-06-12", count: 3 },
      { day: "2026-06-13", count: 0 },
    ]);
  });

  it("drops rows outside the window and malformed days", () => {
    const out = fillDailySeries(
      [
        { day: "2026-01-01", count: 99 },
        { day: "not-a-day", count: 5 },
        { day: "2026-06-13", count: 2 },
      ],
      2,
      NOW
    );
    expect(out).toEqual([
      { day: "2026-06-12", count: 0 },
      { day: "2026-06-13", count: 2 },
    ]);
  });

  it("clamps negative/NaN counts to zero", () => {
    const out = fillDailySeries([{ day: "2026-06-13", count: -4 }], 1, NOW);
    expect(out[0]!.count).toBe(0);
  });
});

describe("fillDailyViews", () => {
  it("zero-fills both series", () => {
    const out = fillDailyViews([{ day: "2026-06-13", views: 10, actives: 2 }], 2, NOW);
    expect(out).toEqual([
      { day: "2026-06-12", views: 0, actives: 0 },
      { day: "2026-06-13", views: 10, actives: 2 },
    ]);
  });
});

describe("p75", () => {
  it("returns null for empty input", () => {
    expect(p75([])).toBeNull();
  });
  it("returns the single sample", () => {
    expect(p75([1200])).toBe(1200);
  });
  it("nearest-rank percentile on a known set", () => {
    // 75th percentile of 1..8 (nearest-rank) = 6th value
    expect(p75([8, 1, 7, 2, 6, 3, 5, 4])).toBe(6);
  });
  it("ignores negatives and non-finite values", () => {
    expect(p75([-5, NaN, Infinity, 100])).toBe(100);
  });
});

describe("rateVital", () => {
  it("applies Google thresholds at the boundaries", () => {
    expect(rateVital("LCP", 2500)).toBe("good");
    expect(rateVital("LCP", 2501)).toBe("needs-improvement");
    expect(rateVital("LCP", 4001)).toBe("poor");
    expect(rateVital("CLS", 0.1)).toBe("good");
    expect(rateVital("CLS", 0.26)).toBe("poor");
    expect(rateVital("INP", 200)).toBe("good");
    expect(rateVital("TTFB", 1900)).toBe("poor");
  });
});

describe("summarizeVitals", () => {
  it("summarizes every metric, honest nulls when empty", () => {
    const out = summarizeVitals({ LCP: [1000, 2000, 3000, 4000] });
    const lcp = out.find((v) => v.metric === "LCP")!;
    expect(lcp.p75).toBe(3000);
    expect(lcp.samples).toBe(4);
    expect(lcp.rating).toBe("needs-improvement");
    const cls = out.find((v) => v.metric === "CLS")!;
    expect(cls.p75).toBeNull();
    expect(cls.samples).toBe(0);
    expect(cls.rating).toBeNull();
  });
});

describe("formatVitalValue", () => {
  it("formats CLS as a unitless score", () => {
    expect(formatVitalValue("CLS", 0.0512)).toBe("0.051");
  });
  it("formats sub-second timings in ms and seconds above 1000ms", () => {
    expect(formatVitalValue("LCP", 840.4)).toBe("840 ms");
    expect(formatVitalValue("LCP", 2530)).toBe("2.53 s");
  });
});

describe("shapePulseTotals", () => {
  it("clamps actives and weekly signups to the registered total", () => {
    const out = shapePulseTotals({
      traders: 10,
      traders7d: 25,
      active7d: 99,
      active30d: 12,
      posts: 5,
      posts7d: 1,
      comments: 2,
      likes: 3,
      views30d: 400,
      longestStreak: 9,
    });
    expect(out.traders7d).toBe(10);
    expect(out.active7d).toBe(10);
    expect(out.active30d).toBe(10);
    expect(out.views30d).toBe(400);
  });

  it("treats garbage as zero", () => {
    const out = shapePulseTotals({ traders: "x", posts: -1, views30d: NaN });
    expect(out).toMatchObject({ traders: 0, posts: 0, views30d: 0, active30d: 0 });
  });
});
