import { describe, expect, it } from "vitest";
import {
  buildStarterAuthors,
  buildStarterTags,
  shouldShowStarter,
  STARTER_MIN_FOLLOWS,
} from "./starter-suggestions";
import { SUGGESTED_TAGS } from "./types";

describe("buildStarterTags", () => {
  it("prefers trending topics, then tops up with curated tags", () => {
    const out = buildStarterTags([{ tag: "scalping", count: 9 }], [], 4);
    expect(out[0]).toEqual({ tag: "scalping", count: 9 });
    // remaining slots filled from SUGGESTED_TAGS at count 0
    expect(out.length).toBe(4);
    expect(out.slice(1).every((t) => t.count === 0)).toBe(true);
  });

  it("falls back entirely to curated tags when nothing is trending", () => {
    const out = buildStarterTags([], [], 8);
    expect(out.map((t) => t.tag)).toEqual([...SUGGESTED_TAGS].slice(0, 8));
  });

  it("excludes tags the viewer already follows", () => {
    const out = buildStarterTags(
      [
        { tag: "options", count: 5 },
        { tag: "psychology", count: 4 },
      ],
      ["options"],
      8
    );
    expect(out.find((t) => t.tag === "options")).toBeUndefined();
    expect(out.find((t) => t.tag === "psychology")).toBeDefined();
  });

  it("dedupes a tag that appears in both trending and curated", () => {
    const out = buildStarterTags([{ tag: "options", count: 7 }], [], 8);
    expect(out.filter((t) => t.tag === "options")).toHaveLength(1);
    expect(out[0]).toEqual({ tag: "options", count: 7 }); // trending count wins
  });

  it("drops invalid trending keys (e.g. an uppercase ticker, not a tag)", () => {
    // A symbol like "NIFTY" is not a valid lowercase tag grammar -> normalizeTag
    // lowercases it to "nifty" (valid). A truly invalid token is dropped.
    const out = buildStarterTags([{ tag: "a", count: 1 }], [], 8); // 1 char -> invalid
    expect(out.find((t) => t.tag === "a")).toBeUndefined();
  });

  it("respects the limit", () => {
    expect(buildStarterTags([], [], 3)).toHaveLength(3);
  });
});

describe("buildStarterAuthors", () => {
  const board = [
    { username: "alice", displayName: "Alice", avatar: null },
    { username: "bob", displayName: "Bob", avatar: "data:img" },
    { username: "carol", displayName: "Carol", avatar: null },
  ];

  it("projects leaderboard rows with a transparent reason", () => {
    const out = buildStarterAuthors(board, [], null, 5);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      username: "alice",
      displayName: "Alice",
      avatar: null,
      reason: "Top contributor",
    });
  });

  it("excludes the viewer themselves and anyone already followed", () => {
    const out = buildStarterAuthors(board, ["bob"], "alice", 5);
    expect(out.map((a) => a.username)).toEqual(["carol"]);
  });

  it("is case-insensitive about self/followed matching", () => {
    const out = buildStarterAuthors(board, ["BOB"], "Alice", 5);
    expect(out.map((a) => a.username)).toEqual(["carol"]);
  });

  it("respects the limit", () => {
    expect(buildStarterAuthors(board, [], null, 2)).toHaveLength(2);
  });
});

describe("shouldShowStarter", () => {
  it("shows for a brand-new viewer with no signals", () => {
    expect(shouldShowStarter({ follows: 0, followedTags: 0, watchedSymbols: 0 })).toBe(true);
  });

  it("hides once the viewer follows enough people", () => {
    expect(
      shouldShowStarter({ follows: STARTER_MIN_FOLLOWS, followedTags: 0, watchedSymbols: 0 })
    ).toBe(false);
  });

  it("hides as soon as the viewer follows any tag", () => {
    expect(shouldShowStarter({ follows: 0, followedTags: 1, watchedSymbols: 0 })).toBe(false);
  });

  it("hides as soon as the viewer watches any symbol", () => {
    expect(shouldShowStarter({ follows: 0, followedTags: 0, watchedSymbols: 1 })).toBe(false);
  });

  it("still shows with one or two follows but no tags/symbols", () => {
    expect(shouldShowStarter({ follows: 2, followedTags: 0, watchedSymbols: 0 })).toBe(true);
  });
});
