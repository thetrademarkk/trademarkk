import { describe, expect, it } from "vitest";
import {
  addWeight,
  applyForYouDiversityCap,
  buildInterestProfile,
  isColdStart,
  rankForYou,
  scoreCandidate,
  W_AUTHOR_FOLLOWED,
  W_AUTHOR_SECOND_DEGREE,
  W_SYMBOL_ENGAGED,
  W_SYMBOL_WATCHED,
  W_TAG_ENGAGED,
  W_TAG_FOLLOWED,
  HOT_PRIOR_WEIGHT,
  type ForYouCandidate,
  type InterestProfile,
  type ProfileSignals,
} from "./foryou";

const NO_SIGNALS: ProfileSignals = {
  followedTags: [],
  watchedSymbols: [],
  followedAuthors: [],
  secondDegreeAuthors: [],
  engagedTags: [],
  engagedSymbols: [],
};

const cand = (over: Partial<ForYouCandidate> & { id: string }): ForYouCandidate => ({
  authorId: "anon",
  tags: [],
  symbols: [],
  hotScore: 0,
  ...over,
});

describe("addWeight", () => {
  it("keeps the MAX weight for a key, never the sum (no double-count)", () => {
    const m = new Map<string, number>();
    addWeight(m, "options", 1);
    addWeight(m, "options", 3);
    addWeight(m, "options", 2);
    expect(m.get("options")).toBe(3);
  });

  it("ignores empty keys", () => {
    const m = new Map<string, number>();
    addWeight(m, "", 5);
    expect(m.size).toBe(0);
  });
});

describe("buildInterestProfile precedence", () => {
  it("a followed tag outweighs the same tag merely engaged", () => {
    const p = buildInterestProfile({
      ...NO_SIGNALS,
      engagedTags: ["options"],
      followedTags: ["options"],
    });
    expect(p.tags.get("options")).toBe(W_TAG_FOLLOWED);
  });

  it("a watched symbol outweighs the same symbol merely engaged", () => {
    const p = buildInterestProfile({
      ...NO_SIGNALS,
      engagedSymbols: ["NIFTY"],
      watchedSymbols: ["NIFTY"],
    });
    expect(p.symbols.get("NIFTY")).toBe(W_SYMBOL_WATCHED);
  });

  it("a 1st-degree followed author outweighs the same author at 2nd-degree", () => {
    const p = buildInterestProfile({
      ...NO_SIGNALS,
      secondDegreeAuthors: ["alice"],
      followedAuthors: ["alice"],
    });
    expect(p.authors.get("alice")).toBe(W_AUTHOR_FOLLOWED);
  });

  it("distinct signals each land at their own weight", () => {
    const p = buildInterestProfile({
      followedTags: ["options"],
      engagedTags: ["psychology"],
      watchedSymbols: ["NIFTY"],
      engagedSymbols: ["TCS"],
      followedAuthors: ["alice"],
      secondDegreeAuthors: ["bob"],
    });
    expect(p.tags.get("options")).toBe(W_TAG_FOLLOWED);
    expect(p.tags.get("psychology")).toBe(W_TAG_ENGAGED);
    expect(p.symbols.get("NIFTY")).toBe(W_SYMBOL_WATCHED);
    expect(p.symbols.get("TCS")).toBe(W_SYMBOL_ENGAGED);
    expect(p.authors.get("alice")).toBe(W_AUTHOR_FOLLOWED);
    expect(p.authors.get("bob")).toBe(W_AUTHOR_SECOND_DEGREE);
  });
});

describe("isColdStart", () => {
  it("is true when the viewer has no signals at all", () => {
    expect(isColdStart(buildInterestProfile(NO_SIGNALS))).toBe(true);
  });
  it("is false once any single signal exists", () => {
    expect(isColdStart(buildInterestProfile({ ...NO_SIGNALS, followedTags: ["options"] }))).toBe(
      false
    );
    expect(isColdStart(buildInterestProfile({ ...NO_SIGNALS, watchedSymbols: ["NIFTY"] }))).toBe(
      false
    );
    expect(isColdStart(buildInterestProfile({ ...NO_SIGNALS, followedAuthors: ["a"] }))).toBe(
      false
    );
  });
});

describe("scoreCandidate", () => {
  const profile: InterestProfile = buildInterestProfile({
    followedTags: ["options"],
    engagedTags: ["psychology"],
    watchedSymbols: ["NIFTY"],
    followedAuthors: ["alice"],
    secondDegreeAuthors: ["bob"],
    engagedSymbols: [],
  });

  it("adds the engaged-tag boost for a matching tag", () => {
    const s = scoreCandidate(cand({ id: "p", tags: ["options"] }), profile);
    expect(s.tagScore).toBe(W_TAG_FOLLOWED);
    expect(s.score).toBe(W_TAG_FOLLOWED); // hotScore 0 -> prior 0
  });

  it("adds the watched-symbol boost for a matching symbol", () => {
    const s = scoreCandidate(cand({ id: "p", symbols: ["NIFTY"] }), profile);
    expect(s.symbolScore).toBe(W_SYMBOL_WATCHED);
  });

  it("adds the author boost (2nd-degree counted)", () => {
    expect(scoreCandidate(cand({ id: "p", authorId: "alice" }), profile).authorScore).toBe(
      W_AUTHOR_FOLLOWED
    );
    expect(scoreCandidate(cand({ id: "p", authorId: "bob" }), profile).authorScore).toBe(
      W_AUTHOR_SECOND_DEGREE
    );
  });

  it("applies the hot-score prior as the global baseline", () => {
    const s = scoreCandidate(cand({ id: "p", hotScore: 2 }), profile);
    expect(s.priorScore).toBe(HOT_PRIOR_WEIGHT * 2);
    expect(s.score).toBe(HOT_PRIOR_WEIGHT * 2);
  });

  it("dedupes repeated tags/symbols within a single post", () => {
    const s = scoreCandidate(
      cand({ id: "p", tags: ["options", "options"], symbols: ["NIFTY", "NIFTY"] }),
      profile
    );
    expect(s.tagScore).toBe(W_TAG_FOLLOWED); // counted once
    expect(s.symbolScore).toBe(W_SYMBOL_WATCHED); // counted once
  });

  it("clamps a negative hot-score prior to 0", () => {
    expect(scoreCandidate(cand({ id: "p", hotScore: -5 }), profile).priorScore).toBe(0);
  });
});

describe("rankForYou", () => {
  const profile = buildInterestProfile({
    ...NO_SIGNALS,
    followedTags: ["options"],
    watchedSymbols: ["NIFTY"],
  });

  it("ranks an engaged-tag/symbol post above a merely-hot one", () => {
    const out = rankForYou(
      [
        cand({ id: "hot", authorId: "z", hotScore: 1 }), // prior only ~1.5
        cand({ id: "match", authorId: "y", tags: ["options"], hotScore: 0 }), // tag 3
      ],
      profile
    );
    expect(out[0]!.candidate.id).toBe("match");
    expect(out[1]!.candidate.id).toBe("hot");
  });

  it("uses the hot-score prior to order cold posts (never empty)", () => {
    // Neither post matches the profile — ordering falls to the prior.
    const out = rankForYou(
      [
        cand({ id: "older", authorId: "a", hotScore: 0.5 }),
        cand({ id: "fresher", authorId: "b", hotScore: 2 }),
      ],
      profile
    );
    expect(out.map((s) => s.candidate.id)).toEqual(["fresher", "older"]);
  });

  it("breaks exact score ties deterministically by hotScore then id", () => {
    const out = rankForYou(
      [
        cand({ id: "bbb", authorId: "a", tags: ["options"], hotScore: 1 }),
        cand({ id: "aaa", authorId: "b", tags: ["options"], hotScore: 1 }),
      ],
      profile
    );
    // equal total score + equal hotScore -> id asc
    expect(out.map((s) => s.candidate.id)).toEqual(["aaa", "bbb"]);
  });

  it("applies the per-author diversity cap", () => {
    const out = rankForYou(
      [
        cand({ id: "p1", authorId: "alice", tags: ["options"], hotScore: 3 }),
        cand({ id: "p2", authorId: "alice", tags: ["options"], hotScore: 2 }),
        cand({ id: "p3", authorId: "alice", tags: ["options"], hotScore: 1 }),
        cand({ id: "p4", authorId: "bob", tags: ["options"], hotScore: 0.5 }),
      ],
      profile,
      { maxPerAuthor: 2 }
    );
    // alice's third post is pushed below bob's even though it scores higher.
    expect(out.map((s) => s.candidate.id)).toEqual(["p1", "p2", "p4", "p3"]);
  });
});

describe("applyForYouDiversityCap", () => {
  const s = (id: string, author: string) => ({
    candidate: { id, authorId: author } as ForYouCandidate,
    score: 0,
    tagScore: 0,
    symbolScore: 0,
    authorScore: 0,
    priorScore: 0,
  });

  it("appends overflow, never drops it", () => {
    const out = applyForYouDiversityCap(
      [s("1", "a"), s("2", "a"), s("3", "a"), s("4", "b")],
      (c) => c.authorId,
      1
    );
    expect(out.map((x) => x.candidate.id)).toEqual(["1", "4", "2", "3"]);
    expect(out).toHaveLength(4); // nothing dropped
  });

  it("maxPerAuthor < 1 returns the list unchanged", () => {
    const items = [s("1", "a"), s("2", "a")];
    expect(applyForYouDiversityCap(items, (c) => c.authorId, 0)).toEqual(items);
  });
});
