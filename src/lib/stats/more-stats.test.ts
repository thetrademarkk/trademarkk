import { describe, expect, it } from "vitest";
import {
  MIN_SAMPLE,
  durationBucketKey,
  durationBuckets,
  dayTimeHeatmap,
  streakLengthDistribution,
  expectancyByConfidence,
  percentile,
  rPercentiles,
  notionalBucketKey,
  notionalBuckets,
  type TradeLike,
} from "./stats";

/** Build a trade. opened/closed control hold duration; extra fields optional. */
const mk = (over: Partial<TradeLike> & { net_pnl: number }): TradeLike => ({
  id: Math.random().toString(36),
  gross_pnl: over.net_pnl,
  r_multiple: null,
  opened_at: "2026-06-01T10:00:00Z",
  closed_at: "2026-06-01T10:00:00Z",
  status: "closed",
  symbol: "NIFTY",
  segment: "OPT",
  direction: "long",
  playbook_id: null,
  ...over,
});

// Build a trade that opened at `open` and was held `holdMs` milliseconds.
const held = (net: number, openIso: string, holdMs: number): TradeLike => {
  const closed = new Date(new Date(openIso).getTime() + holdMs).toISOString();
  return mk({ net_pnl: net, opened_at: openIso, closed_at: closed });
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("durationBucketKey — boundary minutes", () => {
  it("0ms → <1m", () => expect(durationBucketKey(0)).toBe("<1m"));
  it("59s → <1m", () => expect(durationBucketKey(59 * 1000)).toBe("<1m"));
  it("exactly 1m → 1–5m (upper edge exclusive)", () =>
    expect(durationBucketKey(1 * MIN)).toBe("1–5m"));
  it("4m59s → 1–5m", () => expect(durationBucketKey(5 * MIN - 1000)).toBe("1–5m"));
  it("exactly 5m → 5–30m", () => expect(durationBucketKey(5 * MIN)).toBe("5–30m"));
  it("exactly 30m → 30m–2h", () => expect(durationBucketKey(30 * MIN)).toBe("30m–2h"));
  it("exactly 2h → 2h–1d", () => expect(durationBucketKey(2 * HOUR)).toBe("2h–1d"));
  it("exactly 1d → >1d", () => expect(durationBucketKey(1 * DAY)).toBe(">1d"));
  it("3 days → >1d", () => expect(durationBucketKey(3 * DAY)).toBe(">1d"));
});

describe("durationBuckets", () => {
  it("aggregates count, net P&L, avg and win rate; skips open/invalid trades", () => {
    const trades = [
      held(100, "2026-06-01T10:00:00Z", 30 * 1000), // <1m win
      held(-50, "2026-06-01T10:00:00Z", 45 * 1000), // <1m loss
      held(200, "2026-06-01T10:00:00Z", 3 * MIN), // 1–5m win
      mk({ net_pnl: 999, closed_at: null }), // open → skipped
    ];
    const buckets = durationBuckets(trades);
    const sub1m = buckets.find((b) => b.key === "<1m")!;
    expect(sub1m.trades).toBe(2);
    expect(sub1m.netPnl).toBe(50);
    expect(sub1m.avgPnl).toBe(25);
    expect(sub1m.winRate).toBe(0.5);
    const oneToFive = buckets.find((b) => b.key === "1–5m")!;
    expect(oneToFive.trades).toBe(1);
    expect(oneToFive.winRate).toBe(1);
    // only populated buckets, in canonical order
    expect(buckets.map((b) => b.key)).toEqual(["<1m", "1–5m"]);
  });
  it("empty input → empty array", () => expect(durationBuckets([])).toEqual([]));
});

describe("dayTimeHeatmap", () => {
  it("groups by weekday × entry hour with correct aggregates", () => {
    // 2026-06-01 is a Monday (getDay()===1). Use Z and read in local — assert
    // via re-deriving the expected weekday/hour from the same Date the fn uses.
    const a = mk({ net_pnl: 100, opened_at: "2026-06-01T09:30:00Z" });
    const b = mk({ net_pnl: -40, opened_at: "2026-06-01T09:45:00Z" });
    const c = mk({ net_pnl: 200, opened_at: "2026-06-02T13:05:00Z" });
    const cells = dayTimeHeatmap([a, b, c]);
    const da = new Date(a.opened_at);
    const cellA = cells.find((x) => x.weekday === da.getDay() && x.hour === da.getHours())!;
    expect(cellA.trades).toBe(2);
    expect(cellA.netPnl).toBe(60);
    expect(cellA.winRate).toBe(0.5);
    expect(cells).toHaveLength(2);
  });
  it("empty input → empty array", () => expect(dayTimeHeatmap([])).toEqual([]));
});

describe("streakLengthDistribution", () => {
  const seq = (...nets: number[]) =>
    nets.map((n, i) =>
      mk({ net_pnl: n, closed_at: `2026-06-${String(i + 1).padStart(2, "0")}T10:00:00Z` })
    );

  it("counts how often each run length occurs", () => {
    // W W | L | W | L L L  →  win runs: len2 ×1, len1 ×1 ; loss runs: len1 ×1, len3 ×1
    const dist = streakLengthDistribution(seq(1, 1, -1, 1, -1, -1, -1));
    expect(dist.find((r) => r.length === 1)).toEqual({ length: 1, wins: 1, losses: 1 });
    expect(dist.find((r) => r.length === 2)).toEqual({ length: 2, wins: 1, losses: 0 });
    expect(dist.find((r) => r.length === 3)).toEqual({ length: 3, wins: 0, losses: 1 });
  });
  it("counts a trailing run", () => {
    const dist = streakLengthDistribution(seq(1, 1, 1));
    expect(dist).toEqual([{ length: 3, wins: 1, losses: 0 }]);
  });
  it("a scratch (net 0) breaks a run without counting", () => {
    // W W | scratch | W  → two separate 2- and 1- win runs, no loss runs
    const dist = streakLengthDistribution(seq(1, 1, 0, 1));
    expect(dist.find((r) => r.length === 2)).toEqual({ length: 2, wins: 1, losses: 0 });
    expect(dist.find((r) => r.length === 1)).toEqual({ length: 1, wins: 1, losses: 0 });
  });
  it("orders by close time regardless of input order", () => {
    const later = mk({ net_pnl: -1, closed_at: "2026-06-05T10:00:00Z" });
    const earlier = mk({ net_pnl: 1, closed_at: "2026-06-01T10:00:00Z" });
    const dist = streakLengthDistribution([later, earlier]);
    expect(dist).toEqual([{ length: 1, wins: 1, losses: 1 }]);
  });
  it("empty input → empty array", () => expect(streakLengthDistribution([])).toEqual([]));
});

describe("expectancyByConfidence", () => {
  const conf = (c: number | null, net: number) => mk({ net_pnl: net, confidence: c });

  it("bins by rating with win% + expectancy and flags n<5 suppression", () => {
    const trades = [
      // confidence 5 → 6 trades, 4 wins
      ...Array.from({ length: 4 }, () => conf(5, 100)),
      ...Array.from({ length: 2 }, () => conf(5, -50)),
      // confidence 2 → only 3 trades → enough:false
      conf(2, 100),
      conf(2, 100),
      conf(2, -100),
      // ignored: null + out-of-range + non-integer confidence
      conf(null, 500),
      conf(0, 500),
      conf(6, 500),
      mk({ net_pnl: 500, confidence: 3.5 }),
    ];
    const bins = expectancyByConfidence(trades);
    expect(bins.map((b) => b.confidence)).toEqual([2, 5]);
    const c5 = bins.find((b) => b.confidence === 5)!;
    expect(c5.trades).toBe(6);
    expect(c5.enough).toBe(true);
    expect(c5.winRate).toBeCloseTo(4 / 6, 5);
    expect(c5.expectancy).toBeCloseTo((4 * 100 - 2 * 50) / 6, 5);
    const c2 = bins.find((b) => b.confidence === 2)!;
    expect(c2.trades).toBe(3);
    expect(c2.enough).toBe(false);
    expect(MIN_SAMPLE).toBe(5);
  });
  it("no confidence-rated trades → empty array", () =>
    expect(expectancyByConfidence([conf(null, 1)])).toEqual([]));
});

describe("percentile — linear interpolation (R7)", () => {
  it("empty → null", () => expect(percentile([], 0.5)).toBeNull());
  it("single element → that element", () => expect(percentile([42], 0.9)).toBe(42));
  it("median of an even set interpolates", () => expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5));
  it("median of an odd set is the middle", () => expect(percentile([1, 2, 3], 0.5)).toBe(2));
  it("p0 / p100 are the extremes", () => {
    expect(percentile([10, 20, 30], 0)).toBe(10);
    expect(percentile([10, 20, 30], 1)).toBe(30);
  });
  it("p25 interpolates between ranks", () =>
    // rank = 0.25*(5-1)=1 → exactly index 1
    expect(percentile([0, 10, 20, 30, 40], 0.25)).toBe(10));
  it("p10 interpolates a fractional rank", () =>
    // rank = 0.1*(10-1)=0.9 → between index0(0) and index1(10) → 9
    expect(percentile([0, 10, 20, 30, 40, 50, 60, 70, 80, 90], 0.1)).toBeCloseTo(9, 5));
});

describe("rPercentiles", () => {
  it("computes p10/p25/median/p75/p90 over non-null R, ignoring nulls", () => {
    const trades = [
      ...[-2, -1, -0.5, 0.5, 1, 1.5, 2, 2.5, 3, 4].map((r) => mk({ net_pnl: r, r_multiple: r })),
      mk({ net_pnl: 1, r_multiple: null }), // ignored
    ];
    const p = rPercentiles(trades)!;
    expect(p.count).toBe(10);
    expect(p.median).toBeCloseTo(1.25, 5); // mean of 1 and 1.5 (ranks 4,5)
    expect(p.p10).toBeCloseTo(-1.1, 5); // rank 0.9 between -2 and -1
    expect(p.p90).toBeCloseTo(3.1, 5); // rank 8.1 between 3 and 4
  });
  it("no R-multiples → null", () =>
    expect(rPercentiles([mk({ net_pnl: 1, r_multiple: null })])).toBeNull());
});

describe("notionalBucketKey", () => {
  it("0 → <₹25k", () => expect(notionalBucketKey(0)).toBe("<₹25k"));
  it("exactly 25k → ₹25k–1L (upper edge exclusive)", () =>
    expect(notionalBucketKey(25_000)).toBe("₹25k–1L"));
  it("exactly 1L → ₹1L–5L", () => expect(notionalBucketKey(100_000)).toBe("₹1L–5L"));
  it("exactly 5L → ₹5L–10L", () => expect(notionalBucketKey(500_000)).toBe("₹5L–10L"));
  it("exactly 10L → ₹10L–25L", () => expect(notionalBucketKey(1_000_000)).toBe("₹10L–25L"));
  it("exactly 25L → >₹25L", () => expect(notionalBucketKey(2_500_000)).toBe(">₹25L"));
  it("1cr → >₹25L", () => expect(notionalBucketKey(10_000_000)).toBe(">₹25L"));
});

describe("notionalBuckets", () => {
  it("buckets by qty×avg_entry, aggregates, skips missing fields", () => {
    const trades = [
      mk({ net_pnl: 100, qty: 50, avg_entry: 200 }), // 10k → <₹25k
      mk({ net_pnl: -40, qty: 100, avg_entry: 100 }), // 10k → <₹25k
      mk({ net_pnl: 500, qty: 50, avg_entry: 2000 }), // 1L → ₹1L–5L
      mk({ net_pnl: 999, qty: undefined, avg_entry: 100 }), // skipped (no qty)
    ];
    const buckets = notionalBuckets(trades);
    const small = buckets.find((b) => b.key === "<₹25k")!;
    expect(small.trades).toBe(2);
    expect(small.netPnl).toBe(60);
    expect(small.avgPnl).toBe(30);
    expect(small.winRate).toBe(0.5);
    expect(small.lo).toBe(0);
    const oneL = buckets.find((b) => b.key === "₹1L–5L")!;
    expect(oneL.trades).toBe(1);
    expect(oneL.lo).toBe(100_000);
    // negative qty (short) uses absolute notional
    const shortBuckets = notionalBuckets([mk({ net_pnl: 1, qty: -50, avg_entry: 200 })]);
    expect(shortBuckets[0]!.key).toBe("<₹25k");
  });
  it("empty / all-missing → empty array", () => {
    expect(notionalBuckets([])).toEqual([]);
    expect(notionalBuckets([mk({ net_pnl: 1 })])).toEqual([]);
  });
});
