import { describe, expect, it } from "vitest";
import {
  countNewPosts,
  isLatestLiveScope,
  newPostsLabel,
  NEW_POSTS_CAP,
  type CountablePost,
} from "./new-posts";

const post = (createdAt: string, authorUsername = "alice"): CountablePost => ({
  createdAt,
  authorUsername,
});

describe("isLatestLiveScope", () => {
  const base = {
    sort: "latest" as const,
    scope: "all" as const,
    tag: null,
    search: null,
    symbol: null,
  };

  it("is true only for the default Latest global feed", () => {
    expect(isLatestLiveScope(base)).toBe(true);
  });

  it("is false on Top (engagement order, not recency)", () => {
    expect(isLatestLiveScope({ ...base, sort: "top" })).toBe(false);
  });

  it("is false on Following / Saved / Watchlist scopes", () => {
    expect(isLatestLiveScope({ ...base, scope: "following" })).toBe(false);
    expect(isLatestLiveScope({ ...base, scope: "saved" })).toBe(false);
    expect(isLatestLiveScope({ ...base, scope: "watchlist" })).toBe(false);
  });

  it("is false when filtered by tag, search, or symbol", () => {
    expect(isLatestLiveScope({ ...base, tag: "nifty" })).toBe(false);
    expect(isLatestLiveScope({ ...base, search: "breakout" })).toBe(false);
    expect(isLatestLiveScope({ ...base, symbol: "NIFTY" })).toBe(false);
  });
});

describe("countNewPosts", () => {
  const top = "2026-06-14T10:00:00.000Z";

  it("counts only posts strictly newer than the top timestamp", () => {
    const candidates = [
      post("2026-06-14T10:00:05.000Z"), // newer
      post("2026-06-14T10:00:01.000Z"), // newer
      post(top), // boundary — already on screen, NOT new
      post("2026-06-14T09:59:00.000Z"), // older
    ];
    expect(countNewPosts(top, candidates, null)).toBe(2);
  });

  it("treats the boundary timestamp as already-seen (exclusive `>`)", () => {
    expect(countNewPosts(top, [post(top)], null)).toBe(0);
  });

  it("excludes the viewer's own brand-new posts (they prepend via invalidation)", () => {
    const candidates = [
      post("2026-06-14T10:01:00.000Z", "alice"), // viewer's own — skip
      post("2026-06-14T10:02:00.000Z", "bob"), // someone else — count
    ];
    expect(countNewPosts(top, candidates, "alice")).toBe(1);
  });

  it("counts all candidates when the viewer is anonymous (no own-post filter)", () => {
    const candidates = [
      post("2026-06-14T10:01:00.000Z", "alice"),
      post("2026-06-14T10:02:00.000Z", "bob"),
    ];
    expect(countNewPosts(top, candidates, null)).toBe(2);
  });

  it("treats every candidate as new when the feed is empty (null top)", () => {
    expect(countNewPosts(null, [post("x"), post("y", "bob")], null)).toBe(2);
  });

  it("treats an empty-string top the same as null (empty feed)", () => {
    expect(countNewPosts("", [post("x")], null)).toBe(1);
  });

  it("clamps the count to the cap", () => {
    const many = Array.from({ length: NEW_POSTS_CAP + 25 }, (_, i) =>
      post(`2026-06-14T10:00:${String(i + 1).padStart(2, "0")}.000Z`, `u${i}`)
    );
    expect(countNewPosts(top, many, null)).toBe(NEW_POSTS_CAP);
  });

  it("returns 0 when nothing is newer", () => {
    expect(countNewPosts(top, [post("2026-06-14T09:00:00.000Z")], null)).toBe(0);
  });
});

describe("newPostsLabel", () => {
  it("pluralizes correctly", () => {
    expect(newPostsLabel(1)).toBe("1 new post");
    expect(newPostsLabel(3)).toBe("3 new posts");
    expect(newPostsLabel(0)).toBe("0 new posts");
  });

  it("shows N+ at the cap", () => {
    expect(newPostsLabel(NEW_POSTS_CAP)).toBe(`${NEW_POSTS_CAP}+ new posts`);
    expect(newPostsLabel(NEW_POSTS_CAP + 10)).toBe(`${NEW_POSTS_CAP}+ new posts`);
  });
});
