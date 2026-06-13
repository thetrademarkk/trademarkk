import { describe, expect, it } from "vitest";
import {
  aggregateReactions,
  applyDiversityCap,
  applyReaction,
  isReactionKind,
  nextReaction,
  normalizeReaction,
  parseReactionCounts,
  reactionScore,
  REACTIONS,
  resolveReactionCounts,
  serializeReactionCounts,
  topFeedScore,
  TOP_FEED_AUTHOR_CAP,
  topReactionKinds,
  totalReactions,
  type ReactionCounts,
} from "./reactions";

describe("normalizeReaction / back-compat backfill", () => {
  it("treats NULL, empty, and unknown values as legacy likes", () => {
    expect(normalizeReaction(null)).toBe("like");
    expect(normalizeReaction(undefined)).toBe("like");
    expect(normalizeReaction("")).toBe("like");
    expect(normalizeReaction("love")).toBe("like"); // unknown future value degrades safely
  });
  it("passes through every known kind", () => {
    expect(normalizeReaction("like")).toBe("like");
    expect(normalizeReaction("insightful")).toBe("insightful");
    expect(normalizeReaction("respect")).toBe("respect");
    expect(normalizeReaction("celebrate")).toBe("celebrate");
  });
  it("isReactionKind guards correctly", () => {
    expect(isReactionKind("insightful")).toBe(true);
    expect(isReactionKind("nope")).toBe(false);
    expect(isReactionKind(42)).toBe(false);
  });
});

describe("aggregateReactions (backfilling legacy like rows)", () => {
  it("folds raw rows, counting NULL/legacy as like", () => {
    const counts = aggregateReactions([
      { reaction: null },
      { reaction: "like" },
      { reaction: "insightful" },
      { reaction: "insightful" },
      { reaction: "garbage" },
    ]);
    expect(counts).toEqual({ like: 3, insightful: 2 });
    expect(totalReactions(counts)).toBe(5);
  });
  it("an all-legacy post aggregates to a pure like count", () => {
    const counts = aggregateReactions([{ reaction: null }, { reaction: null }, { reaction: null }]);
    expect(counts).toEqual({ like: 3 });
  });
});

describe("nextReaction (toggle / switch / remove logic)", () => {
  it("adds when the user had no reaction", () => {
    expect(nextReaction(null, "insightful")).toEqual({
      next: "insightful",
      delta: 1,
      action: "add",
    });
  });
  it("removes when clicking the active reaction", () => {
    expect(nextReaction("insightful", "insightful")).toEqual({
      next: null,
      delta: -1,
      action: "remove",
    });
  });
  it("switches (no total change) when clicking a different reaction", () => {
    expect(nextReaction("insightful", "celebrate")).toEqual({
      next: "celebrate",
      delta: 0,
      action: "switch",
    });
  });
});

describe("applyReaction (count aggregation, never mutates, never negative)", () => {
  it("add increments the clicked kind and total", () => {
    const start: ReactionCounts = { like: 2 };
    const r = applyReaction(start, null, "insightful");
    expect(r.counts).toEqual({ like: 2, insightful: 1 });
    expect(r.next).toBe("insightful");
    expect(r.totalDelta).toBe(1);
    expect(start).toEqual({ like: 2 }); // input untouched
  });
  it("switch moves one from current to clicked, total unchanged", () => {
    const r = applyReaction({ insightful: 1, like: 4 }, "insightful", "celebrate");
    expect(r.counts).toEqual({ like: 4, celebrate: 1 });
    expect(totalReactions(r.counts)).toBe(5);
    expect(r.totalDelta).toBe(0);
  });
  it("remove decrements and drops the kind at zero", () => {
    const r = applyReaction({ insightful: 1, like: 3 }, "insightful", "insightful");
    expect(r.counts).toEqual({ like: 3 });
    expect(r.next).toBeNull();
    expect(r.totalDelta).toBe(-1);
  });
  it("clamps at zero on an inconsistent remove", () => {
    const r = applyReaction({}, "like", "like");
    expect(r.counts).toEqual({});
    expect(totalReactions(r.counts)).toBe(0);
  });
  it("full switch sequence: insightful -> celebrate -> remove keeps total then drops it", () => {
    let counts: ReactionCounts = {};
    let mine: "like" | "insightful" | "respect" | "celebrate" | null = null;
    ({ counts, next: mine } = applyReaction(counts, mine, "insightful"));
    expect(totalReactions(counts)).toBe(1);
    expect(mine).toBe("insightful");
    ({ counts, next: mine } = applyReaction(counts, mine, "celebrate"));
    expect(totalReactions(counts)).toBe(1); // switch — total stays 1
    expect(mine).toBe("celebrate");
    expect(counts).toEqual({ celebrate: 1 });
    ({ counts, next: mine } = applyReaction(counts, mine, "celebrate"));
    expect(totalReactions(counts)).toBe(0); // remove
    expect(mine).toBeNull();
  });
});

describe("topReactionKinds (stacked summary icons)", () => {
  it("returns kinds by count desc, deterministic tie-break by display order", () => {
    const counts: ReactionCounts = { like: 3, insightful: 3, respect: 1, celebrate: 5 };
    // celebrate(5) > like(3)==insightful(3) tie -> like first (earlier in order)
    expect(topReactionKinds(counts, 2)).toEqual(["celebrate", "like"]);
    expect(topReactionKinds(counts, 3)).toEqual(["celebrate", "like", "insightful"]);
  });
  it("omits zero kinds and respects n", () => {
    expect(topReactionKinds({ respect: 2 }, 2)).toEqual(["respect"]);
    expect(topReactionKinds({}, 2)).toEqual([]);
  });
});

describe("reactionScore (Top-feed weighting)", () => {
  it("weights insightful/respect at 1.5, celebrate 1.2, like 1", () => {
    expect(reactionScore({ like: 1 })).toBeCloseTo(1);
    expect(reactionScore({ insightful: 1 })).toBeCloseTo(1.5);
    expect(reactionScore({ respect: 1 })).toBeCloseTo(1.5);
    expect(reactionScore({ celebrate: 1 })).toBeCloseTo(1.2);
  });
  it("a post with 2 insightful outscores a post with 2 likes (same total)", () => {
    expect(reactionScore({ insightful: 2 })).toBeGreaterThan(reactionScore({ like: 2 }));
  });
  it("is deterministic and additive across kinds", () => {
    expect(reactionScore({ like: 2, insightful: 2, respect: 1, celebrate: 5 })).toBeCloseTo(
      2 * 1 + 2 * 1.5 + 1 * 1.5 + 5 * 1.2
    );
  });
  it("empty counts score zero", () => {
    expect(reactionScore({})).toBe(0);
  });
});

describe("serialize / parse round-trip", () => {
  it("drops empty/zero kinds and returns null when nothing reacted", () => {
    expect(serializeReactionCounts({})).toBeNull();
    expect(serializeReactionCounts({ like: 0 })).toBeNull();
  });
  it("round-trips a populated breakdown", () => {
    const counts: ReactionCounts = { like: 2, celebrate: 1 };
    const json = serializeReactionCounts(counts);
    expect(json).not.toBeNull();
    expect(parseReactionCounts(json)).toEqual(counts);
  });
  it("parse ignores malformed JSON and bad values", () => {
    expect(parseReactionCounts(null)).toEqual({});
    expect(parseReactionCounts("{not json")).toEqual({});
    expect(parseReactionCounts('{"like":"x","insightful":-2,"respect":3}')).toEqual({ respect: 3 });
  });
});

describe("topFeedScore (decayed, cost-weighted hot-score)", () => {
  it("counts comments as a stronger signal than reactions", () => {
    // 1 comment (weight 2) beats 1 like (weight 1) at the same age.
    const oneComment = topFeedScore({}, 1, 0);
    const oneLike = topFeedScore({ like: 1 }, 0, 0);
    expect(oneComment).toBeGreaterThan(oneLike);
  });
  it("weights Insightful/Respect above Like at equal volume + age", () => {
    expect(topFeedScore({ insightful: 1 }, 0, 0)).toBeGreaterThan(topFeedScore({ like: 1 }, 0, 0));
    expect(topFeedScore({ respect: 1 }, 0, 0)).toBeGreaterThan(topFeedScore({ like: 1 }, 0, 0));
  });
  it("decays with age — a fresh post outranks an older one with equal engagement", () => {
    const fresh = topFeedScore({ like: 5 }, 2, 1);
    const old = topFeedScore({ like: 5 }, 2, 48);
    expect(fresh).toBeGreaterThan(old);
  });
  it("never divides by zero and clamps negative age", () => {
    expect(Number.isFinite(topFeedScore({}, 0, 0))).toBe(true);
    expect(topFeedScore({ like: 1 }, 0, -5)).toBe(topFeedScore({ like: 1 }, 0, 0));
  });
  it("an empty, brand-new post still scores positive (the +1 floor)", () => {
    expect(topFeedScore({}, 0, 0)).toBeGreaterThan(0);
  });
});

describe("applyDiversityCap (per-author Top-feed cap)", () => {
  type Item = { id: string; author: string };
  const author = (i: Item) => i.author;

  it("limits each author to the cap, appending overflow after the capped set", () => {
    // a,a,a,b,c sorted best-first; cap 2 → keep a,a,b,c then overflow a.
    const items: Item[] = [
      { id: "a1", author: "a" },
      { id: "a2", author: "a" },
      { id: "a3", author: "a" },
      { id: "b1", author: "b" },
      { id: "c1", author: "c" },
    ];
    const out = applyDiversityCap(items, author, 2).map((i) => i.id);
    expect(out).toEqual(["a1", "a2", "b1", "c1", "a3"]);
  });

  it("keeps relative order within the capped set and within the overflow", () => {
    const items: Item[] = [
      { id: "1", author: "x" },
      { id: "2", author: "x" },
      { id: "3", author: "x" },
      { id: "4", author: "x" },
    ];
    const out = applyDiversityCap(items, author, 1).map((i) => i.id);
    expect(out).toEqual(["1", "2", "3", "4"]); // one kept, rest overflow in order
  });

  it("is a no-op when every author is already within the cap", () => {
    const items: Item[] = [
      { id: "1", author: "a" },
      { id: "2", author: "b" },
      { id: "3", author: "c" },
    ];
    expect(applyDiversityCap(items, author, 2)).toEqual(items);
  });

  it("never drops items — output length equals input length", () => {
    const items: Item[] = Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, author: "solo" }));
    expect(applyDiversityCap(items, author, 2)).toHaveLength(10);
  });

  it("cap < 1 disables capping (returns a copy in original order)", () => {
    const items: Item[] = [
      { id: "1", author: "a" },
      { id: "2", author: "a" },
    ];
    expect(applyDiversityCap(items, author, 0)).toEqual(items);
  });

  it("default cap is 2", () => {
    expect(TOP_FEED_AUTHOR_CAP).toBe(2);
    const items: Item[] = [
      { id: "1", author: "a" },
      { id: "2", author: "a" },
      { id: "3", author: "a" },
      { id: "4", author: "b" },
    ];
    expect(applyDiversityCap(items, author).map((i) => i.id)).toEqual(["1", "2", "4", "3"]);
  });
});

describe("resolveReactionCounts (display back-compat)", () => {
  it("backfills a legacy post (no breakdown, positive total) as all likes", () => {
    expect(resolveReactionCounts(null, 7)).toEqual({ like: 7 });
  });
  it("uses the stored breakdown when present", () => {
    const json = serializeReactionCounts({ insightful: 2, celebrate: 1 });
    expect(resolveReactionCounts(json, 3)).toEqual({ insightful: 2, celebrate: 1 });
  });
  it("a post with no reactions resolves to empty", () => {
    expect(resolveReactionCounts(null, 0)).toEqual({});
  });
});

describe("REACTIONS metadata", () => {
  it("uses only lucide icon names, no emojis, all four kinds present", () => {
    const icons = Object.values(REACTIONS).map((r) => r.icon);
    expect(icons).toEqual(["ThumbsUp", "Lightbulb", "HeartHandshake", "PartyPopper"]);
    for (const meta of Object.values(REACTIONS)) {
      expect(meta.label).toMatch(/^[A-Za-z]+$/); // plain word labels, no emoji
      expect(meta.weight).toBeGreaterThanOrEqual(1);
    }
  });
});
