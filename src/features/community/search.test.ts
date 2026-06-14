import { describe, expect, it } from "vitest";
import {
  flattenSearchItems,
  moveActive,
  pushRecentSearch,
  sanitizeRecentSearches,
  searchSnippet,
  splitMatch,
  RECENT_SEARCHES_MAX,
} from "./search";
import type { SearchResponse } from "./types";

const author = { username: "ravi", displayName: "Ravi", avatar: null };
const res = (over: Partial<SearchResponse> = {}): SearchResponse => ({
  users: [],
  tags: [],
  posts: [],
  ...over,
});

describe("flattenSearchItems", () => {
  it("orders users → tags → posts → query row", () => {
    const items = flattenSearchItems(
      res({
        users: [{ username: "nifty_trader", displayName: "Nifty Trader", avatar: null, bio: null }],
        tags: [{ tag: "nifty", count: 3 }],
        posts: [
          {
            id: "p1",
            title: "Nifty plan",
            snippet: "s",
            author,
            likeCount: 0,
            commentCount: 0,
            createdAt: "2026-06-13T00:00:00Z",
          },
        ],
      }),
      "nifty"
    );
    expect(items.map((i) => i.group)).toEqual(["user", "tag", "post", "query"]);
    expect(items[0]!.href).toBe("/community/u/nifty_trader");
    expect(items[1]!.href).toBe("/community/t/nifty");
    expect(items[2]!.href).toBe("/community/post/p1");
    expect(items[3]!.href).toBe("/community?q=nifty");
    expect(items[3]!.term).toBe("nifty");
  });

  it("always ends with the query row when a term is typed (even with zero results)", () => {
    const items = flattenSearchItems(res(), "  vix  ");
    expect(items).toHaveLength(1);
    expect(items[0]!.group).toBe("query");
    expect(items[0]!.href).toBe("/community?q=vix");
  });

  it("returns nothing for a blank query and empty results", () => {
    expect(flattenSearchItems(res(), "   ")).toEqual([]);
  });

  it("URL-encodes the query row term", () => {
    const items = flattenSearchItems(res(), "risk & reward");
    expect(items[0]!.href).toBe("/community?q=risk%20%26%20reward");
  });
});

describe("moveActive", () => {
  it("enters the list from -1 at either end", () => {
    expect(moveActive(-1, 1, 4)).toBe(0);
    expect(moveActive(-1, -1, 4)).toBe(3);
  });

  it("wraps around both ends", () => {
    expect(moveActive(3, 1, 4)).toBe(0);
    expect(moveActive(0, -1, 4)).toBe(3);
  });

  it("steps normally inside the list", () => {
    expect(moveActive(1, 1, 4)).toBe(2);
    expect(moveActive(2, -1, 4)).toBe(1);
  });

  it("stays at -1 when the list is empty", () => {
    expect(moveActive(-1, 1, 0)).toBe(-1);
    expect(moveActive(2, 1, 0)).toBe(-1);
  });
});

describe("splitMatch", () => {
  it("splits around the first case-insensitive occurrence", () => {
    expect(splitMatch("BankNifty breakout", "nifty")).toEqual(["Bank", "Nifty", " breakout"]);
  });

  it("returns null when there is no match or no query", () => {
    expect(splitMatch("BankNifty", "vix")).toBeNull();
    expect(splitMatch("BankNifty", "   ")).toBeNull();
  });

  it("handles a match at the very start and end", () => {
    expect(splitMatch("nifty", "NIFTY")).toEqual(["", "nifty", ""]);
    expect(splitMatch("buy nifty", "nifty")).toEqual(["buy ", "nifty", ""]);
  });
});

describe("searchSnippet", () => {
  it("collapses whitespace and returns short bodies untouched", () => {
    expect(searchSnippet("plan\n\nfor  today", "plan")).toBe("plan for today");
  });

  it("truncates long bodies with a trailing ellipsis when the match is early", () => {
    const body = `entry near vwap ${"x".repeat(200)}`;
    const out = searchSnippet(body, "vwap", 40);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(out).toContain("vwap");
  });

  it("windows around a deep match with a leading ellipsis", () => {
    const body = `${"a ".repeat(120)}theta decay won today`;
    const out = searchSnippet(body, "theta", 60);
    expect(out.startsWith("…")).toBe(true);
    expect(out).toContain("theta");
  });

  it("falls back to the head of the text when nothing matches", () => {
    const out = searchSnippet("b ".repeat(200), "zzz", 30);
    expect(out.startsWith("b")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("recent searches", () => {
  it("sanitize drops non-strings, short terms and case-insensitive duplicates", () => {
    expect(sanitizeRecentSearches(["vwap", 7, "  ", "a", "VWAP", { x: 1 }, "banknifty"])).toEqual([
      "vwap",
      "banknifty",
    ]);
  });

  it("sanitize caps the list and clamps each term to 60 chars", () => {
    const raw = Array.from({ length: 10 }, (_, i) => `term-${i}-${"y".repeat(80)}`);
    const out = sanitizeRecentSearches(raw);
    expect(out).toHaveLength(RECENT_SEARCHES_MAX);
    for (const t of out) expect(t.length).toBeLessThanOrEqual(60);
  });

  it("sanitize returns [] for anything that is not an array", () => {
    expect(sanitizeRecentSearches("vwap")).toEqual([]);
    expect(sanitizeRecentSearches(null)).toEqual([]);
    expect(sanitizeRecentSearches({ 0: "vwap" })).toEqual([]);
  });

  it("push puts the newest first and dedupes case-insensitively", () => {
    expect(pushRecentSearch(["vwap", "theta"], "Theta")).toEqual(["Theta", "vwap"]);
  });

  it("push ignores terms that are too short and never exceeds the cap", () => {
    expect(pushRecentSearch(["vwap"], " a ")).toEqual(["vwap"]);
    const full = ["a1", "a2", "a3", "a4", "a5"];
    expect(pushRecentSearch(full, "a6")).toEqual(["a6", "a1", "a2", "a3", "a4"]);
  });
});
