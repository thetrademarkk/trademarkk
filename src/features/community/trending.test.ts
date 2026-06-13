import { describe, expect, it } from "vitest";
import {
  MIN_DISTINCT_AUTHORS,
  parseWindow,
  rankTrending,
  recencyWeight,
  windowHours,
  type TrendingEvent,
} from "./trending";

/** Tiny builder so tests read as "author A posted about KEY, N hours ago". */
const ev = (key: string, authorId: string, ageHours = 0): TrendingEvent => ({
  key,
  authorId,
  ageHours,
});

describe("recencyWeight", () => {
  it("is 1 for a brand-new post", () => {
    expect(recencyWeight(0)).toBe(1);
  });

  it("halves every 24h (the half-life)", () => {
    expect(recencyWeight(24)).toBeCloseTo(0.5, 10);
    expect(recencyWeight(48)).toBeCloseTo(0.25, 10);
  });

  it("clamps negative ages (clock skew) to full weight, never negative", () => {
    expect(recencyWeight(-5)).toBe(1);
    expect(recencyWeight(1000)).toBeGreaterThan(0);
  });

  it("decreases monotonically with age", () => {
    expect(recencyWeight(1)).toBeGreaterThan(recencyWeight(10));
    expect(recencyWeight(10)).toBeGreaterThan(recencyWeight(100));
  });
});

describe("rankTrending — unique-author spam gate", () => {
  it("suppresses a key only one author posted about, however many times", () => {
    // One author spams $XYZ ten times — must NOT trend (1 distinct author).
    const events = Array.from({ length: 10 }, () => ev("XYZ", "spammer", 0));
    expect(rankTrending(events)).toEqual([]);
  });

  it("lets a key trend once it clears the distinct-author gate", () => {
    // Three distinct authors each post once about $NIFTY → trends.
    const events = [ev("NIFTY", "a"), ev("NIFTY", "b"), ev("NIFTY", "c")];
    const out = rankTrending(events);
    expect(out).toHaveLength(1);
    expect(out[0]!.key).toBe("NIFTY");
    expect(out[0]!.authors).toBe(3);
    expect(out[0]!.posts).toBe(3);
  });

  it("a spammed single-author key loses to a genuine multi-author key", () => {
    const events = [
      // $SPAM: one author, 20 posts (huge volume, but only 1 author).
      ...Array.from({ length: 20 }, () => ev("SPAM", "loud", 0)),
      // $NIFTY: two distinct authors, 2 posts.
      ev("NIFTY", "a", 0),
      ev("NIFTY", "b", 0),
    ];
    const out = rankTrending(events);
    expect(out.map((i) => i.key)).toEqual(["NIFTY"]); // SPAM gated out entirely
  });

  it("respects an overridden minAuthors gate", () => {
    const events = [ev("ABC", "a"), ev("ABC", "b")];
    expect(rankTrending(events, { minAuthors: 3 })).toEqual([]);
    expect(rankTrending(events, { minAuthors: 1 })).toHaveLength(1);
  });

  it("default gate is MIN_DISTINCT_AUTHORS (2)", () => {
    expect(MIN_DISTINCT_AUTHORS).toBe(2);
    const oneAuthor = [ev("ABC", "a"), ev("ABC", "a")];
    expect(rankTrending(oneAuthor)).toEqual([]);
  });
});

describe("rankTrending — distinct authors dominate volume", () => {
  it("ranks more-authors above more-posts-fewer-authors", () => {
    const events = [
      // BROAD: 4 distinct authors, 4 posts.
      ev("BROAD", "a"),
      ev("BROAD", "b"),
      ev("BROAD", "c"),
      ev("BROAD", "d"),
      // DEEP: 2 distinct authors, 8 posts (more volume, fewer authors).
      ...Array.from({ length: 4 }, () => ev("DEEP", "x")),
      ...Array.from({ length: 4 }, () => ev("DEEP", "y")),
    ];
    const out = rankTrending(events);
    expect(out.map((i) => i.key)).toEqual(["BROAD", "DEEP"]);
    expect(out[0]!.authors).toBe(4);
    expect(out[1]!.posts).toBe(8);
  });
});

describe("rankTrending — recency weighting", () => {
  it("a fresher key outranks an equally-broad stale key", () => {
    const events = [
      // FRESH: 2 authors, posts now.
      ev("FRESH", "a", 0),
      ev("FRESH", "b", 0),
      // STALE: 2 authors, posts ~6 days old (heavily decayed).
      ev("STALE", "c", 24 * 6),
      ev("STALE", "d", 24 * 6),
    ];
    const out = rankTrending(events);
    expect(out.map((i) => i.key)).toEqual(["FRESH", "STALE"]);
    expect(out[0]!.score).toBeGreaterThan(out[1]!.score);
  });

  it("recency only breaks ties among gate-passing keys, never overrides author breadth", () => {
    const events = [
      // THREE authors, all stale.
      ev("THREE", "a", 24 * 5),
      ev("THREE", "b", 24 * 5),
      ev("THREE", "c", 24 * 5),
      // TWO authors, fresh.
      ev("TWO", "d", 0),
      ev("TWO", "e", 0),
    ];
    const out = rankTrending(events);
    // 3 distinct authors (even stale) beats 2 fresh authors.
    expect(out[0]!.key).toBe("THREE");
  });
});

describe("rankTrending — deterministic tie-breaks & limit", () => {
  it("breaks exact ties alphabetically by key", () => {
    const events = [
      ev("ZETA", "a", 0),
      ev("ZETA", "b", 0),
      ev("ALPHA", "a", 0),
      ev("ALPHA", "b", 0),
    ];
    const out = rankTrending(events);
    // Identical authors/posts/recency → alphabetical, ALPHA before ZETA.
    expect(out.map((i) => i.key)).toEqual(["ALPHA", "ZETA"]);
  });

  it("caps the board at the requested limit", () => {
    const events: TrendingEvent[] = [];
    for (let i = 0; i < 15; i++) {
      events.push(ev(`SYM${i}`, "a", 0), ev(`SYM${i}`, "b", 0));
    }
    expect(rankTrending(events, { limit: 5 })).toHaveLength(5);
    expect(rankTrending(events)).toHaveLength(10); // default limit
  });

  it("is order-independent (same events shuffled → same ranking)", () => {
    const base = [
      ev("AAA", "a", 1),
      ev("AAA", "b", 2),
      ev("BBB", "c", 0),
      ev("BBB", "d", 0),
      ev("BBB", "e", 5),
    ];
    const shuffled = [base[4]!, base[0]!, base[3]!, base[1]!, base[2]!];
    expect(rankTrending(shuffled)).toEqual(rankTrending(base));
  });

  it("ignores empty keys defensively", () => {
    const events = [ev("", "a"), ev("", "b"), ev("REAL", "a"), ev("REAL", "b")];
    expect(rankTrending(events).map((i) => i.key)).toEqual(["REAL"]);
  });

  it("returns an empty board for no events", () => {
    expect(rankTrending([])).toEqual([]);
  });
});

describe("window helpers", () => {
  it("maps windows to hours", () => {
    expect(windowHours("24h")).toBe(24);
    expect(windowHours("7d")).toBe(168);
  });

  it("parses query values, defaulting to 24h", () => {
    expect(parseWindow("7d")).toBe("7d");
    expect(parseWindow("24h")).toBe("24h");
    expect(parseWindow(null)).toBe("24h");
    expect(parseWindow("garbage")).toBe("24h");
    expect(parseWindow(undefined)).toBe("24h");
  });
});
