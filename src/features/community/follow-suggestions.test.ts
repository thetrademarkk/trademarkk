import { describe, expect, it } from "vitest";
import {
  applyReasonDiversityCap,
  buildReason,
  diminishing,
  MAX_PER_REASON,
  MAX_REPUTATION_BOOST,
  rankFollowSuggestions,
  reputationBoost,
  scoreFollowCandidate,
  W_SHARED_TAGS,
  type FollowCandidate,
  type FollowSuggestion,
} from "./follow-suggestions";

/** Minimal candidate with all the affinity signals zeroed — override per test. */
function cand(over: Partial<FollowCandidate> & { userId: string }): FollowCandidate {
  return {
    userId: over.userId,
    username: over.username ?? over.userId,
    displayName: over.displayName ?? over.userId,
    avatar: over.avatar ?? null,
    reputationTier: over.reputationTier ?? null,
    reputationScore: over.reputationScore ?? null,
    secondDegreeCount: over.secondDegreeCount ?? 0,
    sharedTags: over.sharedTags ?? [],
    sharedSymbols: over.sharedSymbols ?? [],
    recentQualityPosts: over.recentQualityPosts ?? 0,
  };
}

describe("diminishing", () => {
  it("is 0 at 0, monotonic non-decreasing, and capped at 1 at/after saturate", () => {
    expect(diminishing(0, 6)).toBe(0);
    expect(diminishing(1, 6)).toBeGreaterThan(0);
    expect(diminishing(3, 6)).toBeGreaterThan(diminishing(1, 6));
    expect(diminishing(6, 6)).toBeCloseTo(1, 5);
    expect(diminishing(100, 6)).toBe(1); // clamped, never exceeds 1
  });
  it("has diminishing returns (1st unit worth more than the 6th)", () => {
    const first = diminishing(1, 20) - diminishing(0, 20);
    const sixth = diminishing(6, 20) - diminishing(5, 20);
    expect(first).toBeGreaterThan(sixth);
  });
  it("negative counts clamp to 0", () => {
    expect(diminishing(-5, 6)).toBe(0);
  });
});

describe("reputationBoost (bounded tie-break)", () => {
  it("is 0 for missing / non-positive scores", () => {
    expect(reputationBoost(null)).toBe(0);
    expect(reputationBoost(undefined)).toBe(0);
    expect(reputationBoost(0)).toBe(0);
    expect(reputationBoost(NaN)).toBe(0);
  });
  it("is capped at MAX_REPUTATION_BOOST even for a perfect score", () => {
    expect(reputationBoost(100)).toBeCloseTo(MAX_REPUTATION_BOOST, 5);
    expect(reputationBoost(1000)).toBeCloseTo(MAX_REPUTATION_BOOST, 5);
  });
  it("scales linearly between 0 and the cap", () => {
    expect(reputationBoost(50)).toBeCloseTo(MAX_REPUTATION_BOOST / 2, 5);
  });
  it("can never exceed a single shared-tag's affinity weight", () => {
    // The whole point: standing must not dominate relevance.
    expect(MAX_REPUTATION_BOOST).toBeLessThan(W_SHARED_TAGS);
  });
});

describe("scoreFollowCandidate (blended affinity)", () => {
  it("rewards each affinity term", () => {
    const base = scoreFollowCandidate(cand({ userId: "a" }));
    expect(base).toBe(0);
    expect(scoreFollowCandidate(cand({ userId: "a", secondDegreeCount: 3 }))).toBeGreaterThan(base);
    expect(scoreFollowCandidate(cand({ userId: "a", sharedTags: ["options"] }))).toBeGreaterThan(
      base
    );
    expect(scoreFollowCandidate(cand({ userId: "a", sharedSymbols: ["NIFTY"] }))).toBeGreaterThan(
      base
    );
    expect(scoreFollowCandidate(cand({ userId: "a", recentQualityPosts: 5 }))).toBeGreaterThan(
      base
    );
  });
  it("ignores garbage counts defensively", () => {
    const s = scoreFollowCandidate(
      cand({ userId: "a", secondDegreeCount: -3, recentQualityPosts: Number.NaN })
    );
    expect(s).toBe(0);
  });
});

describe("buildReason (honest, strongest-signal-first)", () => {
  it("prefers 2nd-degree with correct singular/plural", () => {
    expect(buildReason(cand({ userId: "a", secondDegreeCount: 1 })).reason).toBe(
      "Followed by 1 person you follow"
    );
    expect(buildReason(cand({ userId: "a", secondDegreeCount: 3 })).reason).toBe(
      "Followed by 3 people you follow"
    );
  });
  it("falls to a shared tag, then a shared symbol", () => {
    expect(buildReason(cand({ userId: "a", sharedTags: ["banknifty"] }))).toEqual({
      kind: "shared-tag",
      reason: "Also posts about #banknifty",
    });
    expect(buildReason(cand({ userId: "a", sharedSymbols: ["NIFTY"] }))).toEqual({
      kind: "shared-symbol",
      reason: "Also active in $NIFTY",
    });
  });
  it("uses the standing tier only when there is no affinity signal", () => {
    expect(buildReason(cand({ userId: "a", reputationTier: "established" }))).toEqual({
      kind: "reputation",
      reason: "Established member",
    });
    // but never the bland "New" tier
    expect(buildReason(cand({ userId: "a", reputationTier: "new" })).kind).toBe("popular");
  });
  it("2nd-degree wins over a higher-rep tier (relevance first)", () => {
    expect(
      buildReason(cand({ userId: "a", secondDegreeCount: 2, reputationTier: "trusted" })).kind
    ).toBe("second-degree");
  });
  it("cold-start labels affinity-less candidates as popular, not by tier", () => {
    expect(buildReason(cand({ userId: "a", reputationTier: "trusted" }), true)).toEqual({
      kind: "popular",
      reason: "Popular in the community",
    });
  });
});

describe("applyReasonDiversityCap", () => {
  const mk = (
    id: string,
    kind: FollowSuggestion["reasonKind"],
    score: number
  ): FollowSuggestion => ({
    userId: id,
    username: id,
    displayName: id,
    avatar: null,
    reputationTier: null,
    score,
    reasonKind: kind,
    reason: kind,
  });
  it("caps per reason kind, appending overflow in order", () => {
    const items = [
      mk("a", "second-degree", 9),
      mk("b", "second-degree", 8),
      mk("c", "second-degree", 7),
      mk("d", "second-degree", 6), // 4th of same kind -> overflow
      mk("e", "shared-tag", 5),
    ];
    const out = applyReasonDiversityCap(items, MAX_PER_REASON).map((x) => x.userId);
    // d (the overflow) is pushed AFTER e even though it scored higher.
    expect(out).toEqual(["a", "b", "c", "e", "d"]);
  });
  it("a cap < 1 is a no-op", () => {
    const items = [mk("a", "second-degree", 9), mk("b", "second-degree", 8)];
    expect(applyReasonDiversityCap(items, 0)).toHaveLength(2);
  });
});

describe("rankFollowSuggestions (end-to-end)", () => {
  it("ranks a high-affinity NEWCOMER above a high-rep STRANGER with no overlap", () => {
    // The headline guarantee: reputation is a tie-break, NOT the dominant term.
    const newcomer = cand({
      userId: "newcomer",
      username: "newcomer",
      reputationTier: "new",
      reputationScore: 2, // brand new, basically no standing
      sharedTags: ["options"], // BUT one strong shared interest
    });
    const stranger = cand({
      userId: "stranger",
      username: "stranger",
      reputationTier: "trusted",
      reputationScore: 100, // maxed standing
      // ...but zero overlap with the viewer
    });
    const ranked = rankFollowSuggestions([stranger, newcomer]);
    expect(ranked[0]?.userId).toBe("newcomer");
    expect(ranked[0]?.reason).toBe("Also posts about #options");
  });

  it("weights 2nd-degree by how many mutuals (more mutuals rank higher)", () => {
    const many = cand({ userId: "many", username: "many", secondDegreeCount: 5 });
    const few = cand({ userId: "few", username: "few", secondDegreeCount: 1 });
    const ranked = rankFollowSuggestions([few, many]).map((x) => x.userId);
    expect(ranked).toEqual(["many", "few"]);
  });

  it("one shared interest edges out a single mutual, but several mutuals win", () => {
    const oneTag = cand({ userId: "tag", username: "tag", sharedTags: ["options"] });
    const oneMutual = cand({ userId: "m1", username: "m1", secondDegreeCount: 1 });
    const manyMutuals = cand({ userId: "m4", username: "m4", secondDegreeCount: 4 });
    const ranked = rankFollowSuggestions([oneMutual, oneTag, manyMutuals]).map((x) => x.userId);
    // an explicit shared interest beats a lone mutual …
    expect(ranked.indexOf("tag")).toBeLessThan(ranked.indexOf("m1"));
    // … but a dense social signal (4 mutuals) outranks the single shared interest.
    expect(ranked.indexOf("m4")).toBeLessThan(ranked.indexOf("tag"));
  });

  it("reputation only breaks ties between otherwise-equal candidates", () => {
    const high = cand({
      userId: "high",
      username: "high",
      sharedTags: ["a"],
      reputationScore: 90,
    });
    const low = cand({ userId: "low", username: "low", sharedTags: ["a"], reputationScore: 5 });
    const ranked = rankFollowSuggestions([low, high]).map((x) => x.userId);
    expect(ranked).toEqual(["high", "low"]); // same affinity, rep breaks the tie
  });

  it("applies the per-reason diversity cap to the final list", () => {
    // 5 second-degree candidates + 1 shared-tag; cap should let the shared-tag
    // surface instead of a 4th near-identical mutual.
    const candidates: FollowCandidate[] = [
      cand({ userId: "m1", username: "m1", secondDegreeCount: 5 }),
      cand({ userId: "m2", username: "m2", secondDegreeCount: 4 }),
      cand({ userId: "m3", username: "m3", secondDegreeCount: 3 }),
      cand({ userId: "m4", username: "m4", secondDegreeCount: 2 }),
      cand({ userId: "t1", username: "t1", sharedTags: ["options"] }),
    ];
    const ranked = rankFollowSuggestions(candidates, { limit: 4 });
    const kinds = ranked.map((x) => x.reasonKind);
    expect(kinds.filter((k) => k === "second-degree")).toHaveLength(MAX_PER_REASON);
    expect(ranked.some((x) => x.reasonKind === "shared-tag")).toBe(true);
  });

  it("respects the limit", () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      cand({ userId: `u${i}`, username: `u${i}`, sharedTags: [`tag${i % 3}`] })
    );
    expect(rankFollowSuggestions(candidates, { limit: 5 })).toHaveLength(5);
  });

  it("is deterministic for equal scores (stable username tie-break)", () => {
    const a = cand({ userId: "b", username: "b", sharedTags: ["x"] });
    const b = cand({ userId: "a", username: "a", sharedTags: ["x"] });
    const r1 = rankFollowSuggestions([a, b]).map((x) => x.username);
    const r2 = rankFollowSuggestions([b, a]).map((x) => x.username);
    expect(r1).toEqual(r2);
    expect(r1).toEqual(["a", "b"]); // alphabetical on a true score tie
  });

  it("cold-start: popular contributors carry the 'Popular in the community' reason", () => {
    const candidates = [
      cand({ userId: "p1", username: "p1", reputationScore: 60, recentQualityPosts: 10 }),
      cand({ userId: "p2", username: "p2", reputationScore: 40, recentQualityPosts: 5 }),
    ];
    const ranked = rankFollowSuggestions(candidates, { coldStart: true });
    expect(ranked.every((x) => x.reason === "Popular in the community")).toBe(true);
    // still ranked by activity/standing
    expect(ranked[0]?.userId).toBe("p1");
  });

  it("an empty candidate set yields no suggestions", () => {
    expect(rankFollowSuggestions([])).toEqual([]);
  });
});
