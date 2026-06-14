import { describe, it, expect } from "vitest";
import {
  computeReputation,
  diminishing,
  cappedReactionUnits,
  tierForScore,
  tierMeta,
  normalizeTier,
  EMPTY_SIGNALS,
  REPUTATION_TIERS,
  REPUTATION_TIER_META,
  REACTIONS_PER_REACTOR_CAP,
  BANNED_SCORE_CEILING,
  MAX_SCORE,
  PENALTY_PER_MOD_ACTION,
  PENALTY_PER_QUALITY_FLAG,
  type ReputationSignals,
  type ReactorTally,
} from "./reputation";

/** Build a signal set on top of EMPTY_SIGNALS. */
function signals(overrides: Partial<ReputationSignals>): ReputationSignals {
  return { ...EMPTY_SIGNALS, ...overrides };
}

/** N distinct reactors, each reacting `each` times (genuine cross-user reach). */
function distinctReactors(n: number, each = 1): ReactorTally[] {
  return Array.from({ length: n }, (_, i) => ({ reactorId: `r${i}`, count: each }));
}

describe("diminishing returns curve", () => {
  it("is 0 at 0 and 1 at the saturation point", () => {
    expect(diminishing(0, 40)).toBe(0);
    expect(diminishing(40, 40)).toBeCloseTo(1, 6);
  });

  it("is monotonic non-decreasing but bounded at 1", () => {
    let prev = -1;
    for (let n = 0; n <= 500; n += 7) {
      const v = diminishing(n, 40);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
    // far past saturation it never exceeds 1
    expect(diminishing(100_000, 40)).toBe(1);
  });

  it("the first units add far more than later ones (concave)", () => {
    const firstStep = diminishing(5, 80) - diminishing(0, 80);
    const laterStep = diminishing(75, 80) - diminishing(70, 80);
    expect(firstStep).toBeGreaterThan(laterStep);
  });

  it("clamps negative counts to 0", () => {
    expect(diminishing(-10, 40)).toBe(0);
  });
});

describe("cappedReactionUnits (per-reactor anti-sock-puppet cap)", () => {
  it("caps each reactor's contribution at REACTIONS_PER_REACTOR_CAP", () => {
    // one reactor reacting 1000 times counts as the cap, not 1000.
    expect(cappedReactionUnits([{ reactorId: "fan", count: 1000 }])).toBe(
      REACTIONS_PER_REACTOR_CAP
    );
  });

  it("sums distinct reactors (many real people add up)", () => {
    expect(cappedReactionUnits(distinctReactors(10, 1))).toBe(10);
  });

  it("excludes the member's own id when selfId is supplied (defense in depth)", () => {
    const tallies: ReactorTally[] = [
      { reactorId: "me", count: 50 },
      { reactorId: "other", count: 2 },
    ];
    expect(cappedReactionUnits(tallies, "me")).toBe(2);
  });

  it("treats negative counts as 0", () => {
    expect(cappedReactionUnits([{ reactorId: "x", count: -5 }])).toBe(0);
  });
});

describe("tier thresholds", () => {
  it("maps boundary scores to the expected tiers", () => {
    expect(tierForScore(0)).toBe("new");
    expect(tierForScore(24)).toBe("new");
    expect(tierForScore(25)).toBe("contributing");
    expect(tierForScore(54)).toBe("contributing");
    expect(tierForScore(55)).toBe("established");
    expect(tierForScore(79)).toBe("established");
    expect(tierForScore(80)).toBe("trusted");
    expect(tierForScore(100)).toBe("trusted");
  });

  it("tier metadata is ordered and self-consistent", () => {
    let prev = -1;
    for (const tier of REPUTATION_TIERS) {
      const meta = REPUTATION_TIER_META[tier];
      expect(meta.tier).toBe(tier);
      expect(meta.minScore).toBeGreaterThan(prev);
      expect(tierMeta(tier).label.length).toBeGreaterThan(0);
      prev = meta.minScore;
    }
  });

  it("normalizeTier defaults garbage to 'new' and preserves valid tiers", () => {
    expect(normalizeTier(null)).toBe("new");
    expect(normalizeTier("nonsense")).toBe("new");
    expect(normalizeTier("trusted")).toBe("trusted");
  });
});

describe("computeReputation — brand-new member", () => {
  it("a zero-signal account scores 0 and is 'New'", () => {
    const r = computeReputation(EMPTY_SIGNALS);
    expect(r.score).toBe(0);
    expect(r.tier).toBe("new");
    expect(r.banned).toBe(false);
  });

  it("a thin, fresh account stays in the 'New' band", () => {
    const r = computeReputation(signals({ tenureDays: 2, posts: 1, comments: 1 }));
    expect(r.tier).toBe("new");
    expect(r.score).toBeLessThan(25);
  });
});

describe("computeReputation — earned standing", () => {
  it("a long-tenured, prolific, widely-reacted member reaches a high tier", () => {
    const r = computeReputation(
      signals({
        tenureDays: 400,
        posts: 60,
        comments: 80,
        reactionsFromOthers: distinctReactors(120, 2), // 120 distinct people
        bookmarksFromOthers: 40,
        helpfulCommentSignals: 50,
        followers: 300,
        activeWeeks: 30,
      })
    );
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.tier).toBe("trusted");
  });

  it("the score is always bounded at MAX_SCORE", () => {
    const r = computeReputation(
      signals({
        tenureDays: 10_000,
        posts: 100_000,
        comments: 100_000,
        reactionsFromOthers: distinctReactors(100_000, 100),
        bookmarksFromOthers: 100_000,
        helpfulCommentSignals: 100_000,
        followers: 1_000_000,
        activeWeeks: 100_000,
      })
    );
    expect(r.score).toBeLessThanOrEqual(MAX_SCORE);
    expect(r.score).toBe(MAX_SCORE);
  });

  it("more genuine activity never lowers the score (monotonic in real signals)", () => {
    const base = computeReputation(
      signals({ tenureDays: 100, posts: 10, reactionsFromOthers: distinctReactors(10) })
    );
    const more = computeReputation(
      signals({ tenureDays: 100, posts: 20, reactionsFromOthers: distinctReactors(25) })
    );
    expect(more.score).toBeGreaterThanOrEqual(base.score);
  });
});

describe("ANTI-GAMING — the load-bearing tests", () => {
  it("1000 self-reactions yield ~no gain (self excluded by the server)", () => {
    // The server passes ONLY reactions from others; a self-react never appears.
    // Even if a self-tally leaks through, selfId strips it.
    const withSelfStripped = computeReputation(
      signals({
        tenureDays: 30,
        posts: 5,
        reactionsFromOthers: [{ reactorId: "me", count: 1000 }],
      }),
      "me"
    );
    const noReactions = computeReputation(signals({ tenureDays: 30, posts: 5 }));
    expect(withSelfStripped.score).toBe(noReactions.score);
    expect(withSelfStripped.tier).toBe("new");
  });

  it("one fan reacting 1000 times can't out-score a handful of distinct reactors", () => {
    const oneSpammyFan = computeReputation(
      signals({
        tenureDays: 30,
        posts: 5,
        reactionsFromOthers: [{ reactorId: "fan", count: 1000 }],
      })
    );
    const fewRealPeople = computeReputation(
      signals({ tenureDays: 30, posts: 5, reactionsFromOthers: distinctReactors(8, 1) })
    );
    // The capped single fan contributes <= a few units; 8 distinct people more.
    expect(fewRealPeople.score).toBeGreaterThan(oneSpammyFan.score);
  });

  it("a fabricated 1000-sock-puppet-but-each-once farm still hits the bounded ceiling, never 'free' points", () => {
    // Even 1000 distinct fake accounts can't exceed the reaction weight cap;
    // and the WHOLE score is bounded at 100 — there is no runaway.
    const farm = computeReputation(signals({ reactionsFromOthers: distinctReactors(1000, 1) }));
    expect(farm.score).toBeLessThanOrEqual(MAX_SCORE);
    // reactions alone (W_REACTIONS=26) can't reach 'trusted' (80) on their own
    expect(farm.tier).not.toBe("trusted");
  });

  it("diminishing returns: doubling already-large counts barely moves the score", () => {
    const a = computeReputation(signals({ posts: 40, reactionsFromOthers: distinctReactors(80) }));
    const b = computeReputation(signals({ posts: 80, reactionsFromOthers: distinctReactors(160) }));
    expect(b.score - a.score).toBeLessThan(5);
  });

  it("follower count has diminishing returns (10x followers != 10x points)", () => {
    const ten = computeReputation(signals({ followers: 10 }));
    const hundred = computeReputation(signals({ followers: 100 }));
    const thousand = computeReputation(signals({ followers: 1000 }));
    const gain1 = hundred.score - ten.score;
    const gain2 = thousand.score - hundred.score;
    expect(gain2).toBeLessThanOrEqual(gain1);
  });
});

describe("PENALTIES — flags, mod actions, bans", () => {
  it("quality flags subtract from the score", () => {
    const clean = computeReputation(signals({ tenureDays: 200, posts: 30 }));
    const flagged = computeReputation(signals({ tenureDays: 200, posts: 30, qualityFlags: 3 }));
    expect(flagged.score).toBe(clean.score - 3 * PENALTY_PER_QUALITY_FLAG);
    expect(flagged.components.some((c) => c.key === "penalties")).toBe(true);
  });

  it("moderator actions subtract more than quality flags", () => {
    const clean = computeReputation(signals({ tenureDays: 200, posts: 30 }));
    const modded = computeReputation(signals({ tenureDays: 200, posts: 30, modActions: 2 }));
    expect(modded.score).toBe(clean.score - 2 * PENALTY_PER_MOD_ACTION);
  });

  it("a ban floors the score regardless of earned points", () => {
    const r = computeReputation(
      signals({
        tenureDays: 400,
        posts: 60,
        reactionsFromOthers: distinctReactors(200, 3),
        followers: 500,
        activeWeeks: 30,
        banned: true,
      })
    );
    expect(r.banned).toBe(true);
    expect(r.score).toBeLessThanOrEqual(BANNED_SCORE_CEILING);
    expect(r.tier).toBe("new");
  });

  it("penalties never push the score below 0", () => {
    const r = computeReputation(signals({ posts: 1, qualityFlags: 50, modActions: 50 }));
    expect(r.score).toBe(0);
  });
});

describe("breakdown transparency", () => {
  it("returns a labelled component for each earned signal", () => {
    const r = computeReputation(
      signals({ tenureDays: 100, posts: 10, comments: 5, reactionsFromOthers: distinctReactors(5) })
    );
    const keys = r.components.map((c) => c.key);
    expect(keys).toContain("tenure");
    expect(keys).toContain("posts");
    expect(keys).toContain("reactions");
    expect(keys).toContain("followers");
    // No penalties line when clean.
    expect(keys).not.toContain("penalties");
  });

  it("component points sum (minus penalties) round to the final score", () => {
    const r = computeReputation(
      signals({
        tenureDays: 120,
        posts: 12,
        comments: 8,
        reactionsFromOthers: distinctReactors(15),
        bookmarksFromOthers: 4,
        followers: 20,
        activeWeeks: 6,
      })
    );
    const sum = r.components.reduce((acc, c) => acc + c.points, 0);
    // rounding of each component vs the once-rounded score → within 1 point.
    expect(Math.abs(sum - r.score)).toBeLessThanOrEqual(1.5);
  });

  it("the reactions detail reflects CAPPED units, not raw reaction rows", () => {
    const r = computeReputation(
      signals({ reactionsFromOthers: [{ reactorId: "fan", count: 99 }] })
    );
    const reactionsLine = r.components.find((c) => c.key === "reactions");
    expect(reactionsLine?.detail).toBe(REACTIONS_PER_REACTOR_CAP);
  });
});

describe("robustness", () => {
  it("ignores NaN / negative / garbled signals without throwing", () => {
    const r = computeReputation({
      tenureDays: Number.NaN,
      posts: -10,
      comments: Number.POSITIVE_INFINITY,
      reactionsFromOthers: [
        { reactorId: "ok", count: Number.NaN },
        // @ts-expect-error — exercise the runtime filter for a malformed row
        { reactorId: 123, count: 5 },
      ],
      bookmarksFromOthers: -1,
      helpfulCommentSignals: Number.NaN,
      followers: -5,
      activeWeeks: Number.NaN,
      qualityFlags: -3,
      modActions: Number.NaN,
      banned: false,
    });
    expect(r.score).toBe(0);
    expect(r.tier).toBe("new");
  });
});
