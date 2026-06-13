import { describe, expect, it } from "vitest";
import {
  dedupePostsById,
  isValidTag,
  MAX_FOLLOWED_TAGS,
  normalizeTag,
  planTagFollow,
  TAG_PATTERN,
  toggleFollowedTag,
} from "./followed-tags";

describe("normalizeTag", () => {
  it("lowercases and trims a valid tag", () => {
    expect(normalizeTag("  Options ")).toBe("options");
  });

  it("strips a leading #", () => {
    expect(normalizeTag("#BankNifty")).toBe("banknifty");
  });

  it("keeps dashes and digits", () => {
    expect(normalizeTag("price-action-2")).toBe("price-action-2");
  });

  it("rejects too-short, too-long, and illegal-char tags", () => {
    expect(normalizeTag("a")).toBeNull();
    expect(normalizeTag("x".repeat(21))).toBeNull();
    expect(normalizeTag("has space")).toBeNull();
    expect(normalizeTag("Up$tox")).toBeNull();
    expect(normalizeTag("")).toBeNull();
    expect(normalizeTag(null)).toBeNull();
    expect(normalizeTag(undefined)).toBeNull();
  });

  it("agrees with the schema's tag grammar pattern", () => {
    // Anything the pattern accepts must normalize non-null and vice-versa.
    for (const t of ["options", "nifty", "a1", "price-action", "x".repeat(20)]) {
      expect(TAG_PATTERN.test(t)).toBe(true);
      expect(normalizeTag(t)).toBe(t);
    }
  });
});

describe("isValidTag", () => {
  it("mirrors normalizeTag's accept/reject", () => {
    expect(isValidTag("options")).toBe(true);
    expect(isValidTag("#nifty")).toBe(true);
    expect(isValidTag("no good")).toBe(false);
    expect(isValidTag(null)).toBe(false);
  });
});

describe("planTagFollow", () => {
  it("follows when not currently followed", () => {
    expect(planTagFollow(false)).toEqual({ follow: true, nextFollowed: true });
  });
  it("unfollows when currently followed", () => {
    expect(planTagFollow(true)).toEqual({ follow: false, nextFollowed: false });
  });
});

describe("toggleFollowedTag", () => {
  it("adds a new tag and keeps the list sorted", () => {
    expect(toggleFollowedTag(["options"], "banknifty")).toEqual(["banknifty", "options"]);
  });

  it("removes a tag already present (case-insensitive)", () => {
    expect(toggleFollowedTag(["options", "nifty"], "NIFTY")).toEqual(["options"]);
  });

  it("ignores an invalid tag (returns a copy unchanged)", () => {
    const list = ["options"];
    const out = toggleFollowedTag(list, "bad tag");
    expect(out).toEqual(["options"]);
    expect(out).not.toBe(list);
  });

  it("does not exceed MAX_FOLLOWED_TAGS when adding", () => {
    const full = Array.from({ length: MAX_FOLLOWED_TAGS }, (_, i) => `tag-${i}`);
    const out = toggleFollowedTag(full, "overflow");
    expect(out).toHaveLength(MAX_FOLLOWED_TAGS);
    expect(out).not.toContain("overflow");
  });

  it("still removes when at the cap (toggle off is never blocked)", () => {
    const full = Array.from({ length: MAX_FOLLOWED_TAGS }, (_, i) => `tag-${i}`);
    const out = toggleFollowedTag(full, "tag-0");
    expect(out).toHaveLength(MAX_FOLLOWED_TAGS - 1);
    expect(out).not.toContain("tag-0");
  });
});

describe("dedupePostsById", () => {
  it("keeps one copy of a post that matches both a followed user AND a followed tag", () => {
    // The Following feed unions followed-user posts with followed-tag posts; a
    // post written BY a followed user that ALSO carries a followed tag would
    // otherwise appear twice.
    const followedUserPost = { id: "p1", body: "by a followed user, tagged #options" };
    const merged = [followedUserPost, { id: "p2", body: "tagged #options" }, followedUserPost];
    expect(dedupePostsById(merged)).toEqual([
      followedUserPost,
      { id: "p2", body: "tagged #options" },
    ]);
  });

  it("preserves first-seen order", () => {
    const out = dedupePostsById([{ id: "b" }, { id: "a" }, { id: "b" }, { id: "c" }]);
    expect(out.map((p) => p.id)).toEqual(["b", "a", "c"]);
  });

  it("returns an empty array unchanged", () => {
    expect(dedupePostsById([])).toEqual([]);
  });
});
