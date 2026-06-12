import { describe, expect, it } from "vitest";
import { rankRelated, type RelatedCandidate } from "./related";

const post = (
  id: string,
  tags: string[],
  opts: Partial<Pick<RelatedCandidate, "likeCount" | "commentCount" | "createdAt">> = {}
): RelatedCandidate => ({
  id,
  tags,
  likeCount: opts.likeCount ?? 0,
  commentCount: opts.commentCount ?? 0,
  createdAt: opts.createdAt ?? "2026-06-01T00:00:00.000Z",
});

const current = { id: "me", tags: ["nifty", "options"] };

describe("rankRelated", () => {
  it("ranks tag-overlapping posts above non-matching ones", () => {
    const { posts, byTag } = rankRelated(current, [
      post("a", ["psychology"], { createdAt: "2026-06-10T00:00:00.000Z" }),
      post("b", ["nifty"], { createdAt: "2026-06-01T00:00:00.000Z" }),
    ]);
    expect(posts.map((p) => p.id)).toEqual(["b", "a"]);
    expect(byTag).toBe(true);
  });

  it("more shared tags win, then engagement, then recency", () => {
    const { posts } = rankRelated(current, [
      post("one-tag-hot", ["nifty"], { likeCount: 50 }),
      post("two-tags", ["nifty", "options"]),
      post("one-tag-new", ["options"], { createdAt: "2026-06-11T00:00:00.000Z" }),
      post("one-tag-old", ["options"], { createdAt: "2026-05-01T00:00:00.000Z" }),
    ]);
    expect(posts.map((p) => p.id)).toEqual([
      "two-tags",
      "one-tag-hot",
      "one-tag-new",
      "one-tag-old",
    ]);
  });

  it("excludes the current post and caps at the limit", () => {
    const { posts } = rankRelated(
      current,
      [post("me", ["nifty"]), post("a", ["nifty"]), post("b", ["nifty"]), post("c", ["nifty"])],
      2
    );
    expect(posts.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("tag matching is case-insensitive", () => {
    const { posts, byTag } = rankRelated({ id: "me", tags: ["NIFTY"] }, [post("a", ["nifty"])]);
    expect(posts.map((p) => p.id)).toEqual(["a"]);
    expect(byTag).toBe(true);
  });

  it("falls back to newest posts when nothing shares a tag", () => {
    const { posts, byTag } = rankRelated(current, [
      post("older", ["setups"], { createdAt: "2026-06-01T00:00:00.000Z" }),
      post("newer", ["review"], { createdAt: "2026-06-11T00:00:00.000Z" }),
    ]);
    expect(posts.map((p) => p.id)).toEqual(["newer", "older"]);
    expect(byTag).toBe(false);
  });

  it("returns empty for an empty candidate pool", () => {
    expect(rankRelated(current, []).posts).toEqual([]);
  });
});
