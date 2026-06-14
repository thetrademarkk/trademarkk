import { describe, expect, it } from "vitest";
import {
  AWARD_BADGES,
  AWARD_TIERS,
  AwardId,
  awardMeta,
  CONSISTENT_WEEKS,
  CONVERSATIONALIST_COMMENTS,
  COMMUNITY_PILLAR_FOLLOWERS,
  CROWD_FAVOURITE_REACTIONS,
  evaluateAwards,
  featuredAward,
  HELPFUL_VOICE_SIGNALS,
  isKnownAward,
  MIN_RECEIVED_FOR_CONTRIBUTION,
  normalizeAwards,
  ONE_YEAR_DAYS,
  parseStoredAwards,
  SAVED_BOOKMARKS,
  serializeAwards,
  SIX_MONTHS_DAYS,
  splitAwards,
  WELL_RECEIVED_REACTIONS,
  WORDSMITH_POSTS,
} from "./awards";
import { EMPTY_SIGNALS, REACTIONS_PER_REACTOR_CAP, type ReputationSignals } from "./reputation";

/* ── Helpers ──────────────────────────────────────────────────────────────────
 * Build signal bundles ergonomically. `distinctReactors(n)` mints n DISTINCT
 * reactors each contributing 1 capped unit — the genuine-reach shape badges want.
 */
function signals(over: Partial<ReputationSignals> = {}): ReputationSignals {
  return { ...EMPTY_SIGNALS, ...over };
}

/** n distinct reactors, each reacting `per` times (capped by the model). */
function distinctReactors(n: number, per = 1) {
  return Array.from({ length: n }, (_, i) => ({ reactorId: `r${i}`, count: per }));
}

/** Convenience: signals that earn exactly `units` of capped reactions from others. */
function withReactionUnits(units: number, over: Partial<ReputationSignals> = {}) {
  return signals({ reactionsFromOthers: distinctReactors(units), ...over });
}

describe("awards catalogue (registry integrity)", () => {
  it("every badge id is unique", () => {
    const ids = AWARD_BADGES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every badge has label, criteria, lucide icon and a known tier", () => {
    for (const b of AWARD_BADGES) {
      expect(b.label.length).toBeGreaterThan(0);
      expect(b.criteria.length).toBeGreaterThan(0);
      expect(b.icon.length).toBeGreaterThan(0);
      expect(AWARD_TIERS).toContain(b.tier);
      expect(typeof b.earned).toBe("function");
    }
  });

  it("no badge mentions trading skill / P&L / returns (honest framing)", () => {
    for (const b of AWARD_BADGES) {
      const text = `${b.label} ${b.criteria}`.toLowerCase();
      expect(text).not.toMatch(/profit|p&l|pnl|return|win[- ]?rate|trading skill/);
    }
  });

  it("awardMeta + isKnownAward resolve known ids and reject unknown", () => {
    expect(awardMeta("one-year").label).toBe("One Year");
    expect(isKnownAward("one-year")).toBe(true);
    expect(isKnownAward("totally-made-up")).toBe(false);
  });

  it("a brand-new account with zero activity earns NOTHING", () => {
    expect(evaluateAwards(EMPTY_SIGNALS)).toEqual([]);
  });

  it("is deterministic — same signals in, same set out", () => {
    const s = withReactionUnits(12, { posts: 12, followers: 30, tenureDays: 400, activeWeeks: 10 });
    expect(evaluateAwards(s)).toEqual(evaluateAwards(s));
  });
});

/* ── Per-badge: earned AT threshold, NOT below it ─────────────────────────────── */

describe("tenure badges", () => {
  it("Six Months earns at the threshold but not a day below", () => {
    expect(evaluateAwards(signals({ tenureDays: SIX_MONTHS_DAYS }))).toContain("six-months");
    expect(evaluateAwards(signals({ tenureDays: SIX_MONTHS_DAYS - 1 }))).not.toContain(
      "six-months"
    );
  });

  it("One Year earns at the threshold but not below", () => {
    expect(evaluateAwards(signals({ tenureDays: ONE_YEAR_DAYS }))).toContain("one-year");
    expect(evaluateAwards(signals({ tenureDays: ONE_YEAR_DAYS - 1 }))).not.toContain("one-year");
  });

  it("a one-year member also holds the six-month badge", () => {
    const earned = evaluateAwards(signals({ tenureDays: ONE_YEAR_DAYS }));
    expect(earned).toContain("six-months");
    expect(earned).toContain("one-year");
  });
});

describe("engagement badges (reactions from others)", () => {
  it("Well Received earns at the reaction-unit threshold, not below", () => {
    expect(evaluateAwards(withReactionUnits(WELL_RECEIVED_REACTIONS))).toContain("well-received");
    expect(evaluateAwards(withReactionUnits(WELL_RECEIVED_REACTIONS - 1))).not.toContain(
      "well-received"
    );
  });

  it("Crowd Favourite earns at its (higher) threshold, not below", () => {
    expect(evaluateAwards(withReactionUnits(CROWD_FAVOURITE_REACTIONS))).toContain(
      "crowd-favourite"
    );
    expect(evaluateAwards(withReactionUnits(CROWD_FAVOURITE_REACTIONS - 1))).not.toContain(
      "crowd-favourite"
    );
  });

  it("Worth Saving earns at the bookmark threshold, not below", () => {
    expect(evaluateAwards(signals({ bookmarksFromOthers: SAVED_BOOKMARKS }))).toContain(
      "saved-for-later"
    );
    expect(evaluateAwards(signals({ bookmarksFromOthers: SAVED_BOOKMARKS - 1 }))).not.toContain(
      "saved-for-later"
    );
  });

  it("Helpful Voice earns at the comment-like threshold, not below", () => {
    expect(evaluateAwards(signals({ helpfulCommentSignals: HELPFUL_VOICE_SIGNALS }))).toContain(
      "helpful-voice"
    );
    expect(
      evaluateAwards(signals({ helpfulCommentSignals: HELPFUL_VOICE_SIGNALS - 1 }))
    ).not.toContain("helpful-voice");
  });

  it("Community Pillar earns at the follower threshold, not below", () => {
    expect(evaluateAwards(signals({ followers: COMMUNITY_PILLAR_FOLLOWERS }))).toContain(
      "community-pillar"
    );
    expect(evaluateAwards(signals({ followers: COMMUNITY_PILLAR_FOLLOWERS - 1 }))).not.toContain(
      "community-pillar"
    );
  });
});

describe("consistency badge", () => {
  it("Consistent earns at the active-weeks threshold, not below", () => {
    expect(evaluateAwards(signals({ activeWeeks: CONSISTENT_WEEKS }))).toContain("consistent");
    expect(evaluateAwards(signals({ activeWeeks: CONSISTENT_WEEKS - 1 }))).not.toContain(
      "consistent"
    );
  });
});

describe("entry badge (First Steps)", () => {
  it("earns with one post AND one genuine reaction from another member", () => {
    const earned = evaluateAwards(withReactionUnits(1, { posts: 1 }));
    expect(earned).toContain("first-post");
  });

  it("does NOT earn from a lone post with no reception", () => {
    expect(evaluateAwards(signals({ posts: 1 }))).not.toContain("first-post");
  });
});

/* ── Anti-gaming: the load-bearing tests ──────────────────────────────────────── */

describe("anti-gaming — sanctioned / flagged accounts earn nothing", () => {
  it("a BANNED member earns no badges even with strong activity", () => {
    const strong = withReactionUnits(CROWD_FAVOURITE_REACTIONS, {
      posts: 100,
      comments: 100,
      followers: 500,
      tenureDays: ONE_YEAR_DAYS * 2,
      activeWeeks: 52,
      bookmarksFromOthers: 100,
      helpfulCommentSignals: 100,
    });
    // Without the ban, they'd hold most badges …
    expect(evaluateAwards(strong).length).toBeGreaterThan(3);
    // … but a ban suppresses ALL of them.
    expect(evaluateAwards({ ...strong, banned: true })).toEqual([]);
  });

  it("a member carrying ANY quality flag earns no badges", () => {
    const strong = withReactionUnits(CROWD_FAVOURITE_REACTIONS, {
      posts: 50,
      followers: 100,
      tenureDays: ONE_YEAR_DAYS,
    });
    expect(evaluateAwards(strong).length).toBeGreaterThan(0);
    expect(evaluateAwards({ ...strong, qualityFlags: 1 })).toEqual([]);
  });
});

describe("anti-gaming — self-engagement excluded by construction", () => {
  it("self-reactions never count toward engagement badges", () => {
    // The server strips self-reactions before they reach the bundle. Even if a
    // self-id slipped into the tallies, the engagement currency uses ONLY the
    // reactor tallies provided — there is no path for a user's own id to be a
    // 'reactionsFromOthers' entry that the server didn't already exclude. We model
    // the cleaned bundle: 9 genuine others = below the Well-Received threshold.
    expect(evaluateAwards(withReactionUnits(WELL_RECEIVED_REACTIONS - 1))).not.toContain(
      "well-received"
    );
  });
});

describe("anti-gaming — one spammy fan can't unlock a reception badge", () => {
  it("a single fan reacting 1000 times yields ~3 capped units — below all reception thresholds", () => {
    const oneSpammyFan = signals({
      reactionsFromOthers: [{ reactorId: "superfan", count: 1000 }],
      posts: 50, // lots of self-volume too — still shouldn't matter
    });
    const earned = evaluateAwards(oneSpammyFan);
    // The capped contribution is REACTIONS_PER_REACTOR_CAP (3) < Well-Received (10).
    expect(REACTIONS_PER_REACTOR_CAP).toBeLessThan(WELL_RECEIVED_REACTIONS);
    expect(earned).not.toContain("well-received");
    expect(earned).not.toContain("crowd-favourite");
    // The 3 capped units DO clear the contribution-minimum, so Wordsmith (which
    // needs 10 posts + MIN_RECEIVED) is allowed precisely because reception is
    // genuine-cap-bounded, not because one fan inflated it.
    expect(MIN_RECEIVED_FOR_CONTRIBUTION).toBeLessThanOrEqual(REACTIONS_PER_REACTOR_CAP);
  });

  it("genuine reach from MANY distinct reactors DOES unlock the reception badge", () => {
    expect(evaluateAwards(withReactionUnits(WELL_RECEIVED_REACTIONS))).toContain("well-received");
  });
});

describe("anti-gaming — volume without reception earns nothing", () => {
  it("100 posts with zero reactions earns no contribution badge", () => {
    const spammer = signals({ posts: 100, comments: 100, tenureDays: 5 });
    const earned = evaluateAwards(spammer);
    expect(earned).not.toContain("wordsmith");
    expect(earned).not.toContain("first-post");
    expect(earned).not.toContain("well-received");
  });

  it("Wordsmith needs BOTH post volume AND genuine reception", () => {
    // Enough posts, but no reception → not earned.
    expect(evaluateAwards(signals({ posts: WORDSMITH_POSTS }))).not.toContain("wordsmith");
    // Reception but too few posts → not earned.
    expect(
      evaluateAwards(
        withReactionUnits(MIN_RECEIVED_FOR_CONTRIBUTION, { posts: WORDSMITH_POSTS - 1 })
      )
    ).not.toContain("wordsmith");
    // Both → earned.
    expect(
      evaluateAwards(withReactionUnits(MIN_RECEIVED_FOR_CONTRIBUTION, { posts: WORDSMITH_POSTS }))
    ).toContain("wordsmith");
  });

  it("Conversationalist needs BOTH comment volume AND helpful reception", () => {
    expect(evaluateAwards(signals({ comments: CONVERSATIONALIST_COMMENTS }))).not.toContain(
      "conversationalist"
    );
    expect(
      evaluateAwards(
        signals({
          comments: CONVERSATIONALIST_COMMENTS,
          helpfulCommentSignals: MIN_RECEIVED_FOR_CONTRIBUTION,
        })
      )
    ).toContain("conversationalist");
  });
});

/* ── Storage round-trip + normalization ──────────────────────────────────────── */

describe("storage helpers", () => {
  it("normalizeAwards drops unknowns, dedupes and preserves catalogue order", () => {
    const out = normalizeAwards(["bogus", "well-received", "one-year", "well-received", 42]);
    expect(out).toEqual(["one-year", "well-received"]); // catalogue order: one-year before well-received
  });

  it("serialize → parse round-trips the earned set", () => {
    const ids: AwardId[] = ["one-year", "well-received", "consistent"];
    const restored = parseStoredAwards(serializeAwards(ids));
    expect(restored).toEqual(normalizeAwards(ids));
  });

  it("parseStoredAwards is null/garbage tolerant", () => {
    expect(parseStoredAwards(null)).toEqual([]);
    expect(parseStoredAwards(undefined)).toEqual([]);
    expect(parseStoredAwards("not json")).toEqual([]);
    expect(parseStoredAwards("{}")).toEqual([]);
  });
});

/* ── UI helpers (split + featured) ────────────────────────────────────────────── */

describe("UI helpers", () => {
  it("splitAwards separates earned from a capped notable-unearned list", () => {
    const { earned, unearned } = splitAwards(["one-year"], 3);
    expect(earned.map((b) => b.id)).toEqual(["one-year"]);
    expect(earned).toHaveLength(1);
    expect(unearned).toHaveLength(3);
    // Unearned should not include the earned one.
    expect(unearned.map((b) => b.id)).not.toContain("one-year");
    // The aspirational unearned list leads with the highest-rarity (gold) badges.
    expect(unearned[0]!.tier).toBe("gold");
  });

  it("featuredAward returns the single rarest earned badge, or null", () => {
    expect(featuredAward([])).toBeNull();
    // bronze + gold → the gold one is featured.
    const f = featuredAward(["first-post", "one-year"]);
    expect(f?.id).toBe("one-year");
    expect(f?.tier).toBe("gold");
  });
});
