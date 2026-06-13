import { describe, expect, it } from "vitest";
import {
  dedupePostsById,
  isValidWatchSymbol,
  isWatched,
  MAX_WATCHED_SYMBOLS,
  normalizeWatchSymbol,
  planWatchToggle,
  SYMBOL_PATTERN,
  toggleWatchedSymbol,
} from "./watchlist";

describe("normalizeWatchSymbol", () => {
  it("uppercases and trims a valid symbol", () => {
    expect(normalizeWatchSymbol("  reliance ")).toBe("RELIANCE");
  });

  it("strips a leading $ (one or many)", () => {
    expect(normalizeWatchSymbol("$nifty")).toBe("NIFTY");
    expect(normalizeWatchSymbol("$$tcs")).toBe("TCS");
  });

  it("keeps dashes and ampersands (BAJAJ-AUTO, M&M)", () => {
    expect(normalizeWatchSymbol("bajaj-auto")).toBe("BAJAJ-AUTO");
    expect(normalizeWatchSymbol("m&m")).toBe("M&M");
  });

  it("rejects too-long, illegal-char, and empty symbols", () => {
    expect(normalizeWatchSymbol("X".repeat(21))).toBeNull();
    expect(normalizeWatchSymbol("has space")).toBeNull();
    expect(normalizeWatchSymbol("bad.dot")).toBeNull();
    expect(normalizeWatchSymbol("$")).toBeNull();
    expect(normalizeWatchSymbol("")).toBeNull();
    expect(normalizeWatchSymbol(null)).toBeNull();
    expect(normalizeWatchSymbol(undefined)).toBeNull();
  });

  it("agrees with the symbol grammar pattern", () => {
    for (const s of ["NIFTY", "RELIANCE", "M&M", "BAJAJ-AUTO", "A", "X".repeat(20)]) {
      expect(SYMBOL_PATTERN.test(s)).toBe(true);
      expect(normalizeWatchSymbol(s)).toBe(s);
    }
  });
});

describe("isValidWatchSymbol", () => {
  it("mirrors normalizeWatchSymbol's accept/reject", () => {
    expect(isValidWatchSymbol("RELIANCE")).toBe(true);
    expect(isValidWatchSymbol("$nifty")).toBe(true);
    expect(isValidWatchSymbol("no good")).toBe(false);
    expect(isValidWatchSymbol(null)).toBe(false);
  });
});

describe("planWatchToggle", () => {
  it("watches when not currently watched", () => {
    expect(planWatchToggle(false)).toEqual({ watch: true, nextWatched: true });
  });
  it("unwatches when currently watched", () => {
    expect(planWatchToggle(true)).toEqual({ watch: false, nextWatched: false });
  });
});

describe("toggleWatchedSymbol", () => {
  it("adds a new symbol and keeps the list sorted", () => {
    expect(toggleWatchedSymbol(["RELIANCE"], "nifty")).toEqual(["NIFTY", "RELIANCE"]);
  });

  it("removes a symbol already present (case-insensitive, $-tolerant)", () => {
    expect(toggleWatchedSymbol(["NIFTY", "TCS"], "$nifty")).toEqual(["TCS"]);
  });

  it("ignores an invalid symbol (returns a copy unchanged)", () => {
    const list = ["NIFTY"];
    const out = toggleWatchedSymbol(list, "bad symbol");
    expect(out).toEqual(["NIFTY"]);
    expect(out).not.toBe(list);
  });

  it("does not exceed MAX_WATCHED_SYMBOLS when adding", () => {
    const full = Array.from({ length: MAX_WATCHED_SYMBOLS }, (_, i) => `SYM${i}`);
    const out = toggleWatchedSymbol(full, "OVERFLOW");
    expect(out).toHaveLength(MAX_WATCHED_SYMBOLS);
    expect(out).not.toContain("OVERFLOW");
  });

  it("still removes when at the cap (toggle off is never blocked)", () => {
    const full = Array.from({ length: MAX_WATCHED_SYMBOLS }, (_, i) => `SYM${i}`);
    const out = toggleWatchedSymbol(full, "SYM0");
    expect(out).toHaveLength(MAX_WATCHED_SYMBOLS - 1);
    expect(out).not.toContain("SYM0");
  });
});

describe("isWatched", () => {
  it("matches case-insensitively and tolerates a leading $", () => {
    expect(isWatched(["NIFTY", "TCS"], "nifty")).toBe(true);
    expect(isWatched(["NIFTY"], "$NIFTY")).toBe(true);
    expect(isWatched(["NIFTY"], "RELIANCE")).toBe(false);
    expect(isWatched(["NIFTY"], "bad symbol")).toBe(false);
  });
});

describe("dedupePostsById", () => {
  it("keeps one copy of a post that matches both a followed author AND a watched symbol", () => {
    // The Watchlist feed unions followed-author posts with watched-symbol posts;
    // a post written BY a followed author that ALSO tags a watched symbol would
    // otherwise appear twice.
    const both = { id: "p1", body: "by a followed author, tags $NIFTY" };
    const merged = [both, { id: "p2", body: "tags $NIFTY" }, both];
    expect(dedupePostsById(merged)).toEqual([both, { id: "p2", body: "tags $NIFTY" }]);
  });

  it("preserves first-seen order", () => {
    const out = dedupePostsById([{ id: "b" }, { id: "a" }, { id: "b" }, { id: "c" }]);
    expect(out.map((p) => p.id)).toEqual(["b", "a", "c"]);
  });

  it("returns an empty array unchanged", () => {
    expect(dedupePostsById([])).toEqual([]);
  });
});
