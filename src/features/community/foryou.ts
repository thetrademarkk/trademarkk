/**
 * "For You" interest feed — pure, deterministic, EXPLAINABLE ranking (NO ML).
 *
 * The For-You feed ranks recent posts by how well each one matches the signals
 * the VIEWER has already engaged with, plus a recency-decayed global hot-score
 * prior so the feed is never empty and a brand-new account still sees the best
 * of the community. Every term in the score is documented and unit-testable —
 * there is no learned model, no embedding, no opaque weight. Given the same
 * interest profile + candidates + clock, the ranking is identical every time.
 *
 * ── The interest profile (built once per request from cheap signals) ──
 * A viewer's `InterestProfile` is three weighted sets:
 *   - `tags`     — tags the viewer FOLLOWS, plus tags carried by posts they
 *                  liked / bookmarked / authored.
 *   - `symbols`  — $cashtags the viewer WATCHES, plus symbols of posts they
 *                  liked / bookmarked / authored.
 *   - `authors`  — authors the viewer FOLLOWS (1st-degree) and authors followed
 *                  BY the people the viewer follows (2nd-degree). 1st-degree
 *                  outweighs 2nd-degree.
 * Each entry carries a positive weight; stronger signals (an explicit follow /
 * watch) weigh more than an implicit one (a like), which weighs more than just
 * having authored something. The weights are small constants defined below.
 *
 * ── The per-post score ──
 *   interestScore(post) =
 *       Σ tagWeight   for each of the post's tags the viewer is interested in
 *     + Σ symbolWeight for each of the post's symbols the viewer is interested in
 *     + authorWeight   if the post's author is in the viewer's author set
 *     + HOT_PRIOR_WEIGHT × hotScore(post)          ← the global prior
 * where `hotScore` is the SAME recency-decayed, kind-weighted Top-feed score the
 * Top tab uses (passed in by the caller so this module stays free of the
 * reactions import cycle). The prior guarantees a non-empty, sensibly-ordered
 * feed even when the interest match is zero (cold start) — it just gets out-
 * weighed as soon as the viewer has real signals.
 *
 * Posts with NO interest match AND a zero prior are still kept (the prior is
 * always ≥ 0 and the +1 in the hot-score numerator keeps fresh posts non-zero),
 * so the candidate set is only ever re-ordered, never truncated by this module —
 * the caller applies the block filter, the own-post exclusion and the slice.
 *
 * This module never imports React, the DB, or the reactions module — it is pure
 * data-in / ranked-data-out.
 */

/** A weighted interest key (tag/symbol/author) the viewer has engaged with. */
export interface InterestProfile {
  /** lower-cased tag -> weight (followed > engaged). */
  tags: Map<string, number>;
  /** UPPER-cased symbol -> weight (watched > engaged). */
  symbols: Map<string, number>;
  /** author userId -> weight (followed/1st-degree > 2nd-degree). */
  authors: Map<string, number>;
}

/* ── Signal weights (documented constants, no ML) ──────────────────────────── */

/** An explicitly FOLLOWED tag — the strongest topical signal. */
export const W_TAG_FOLLOWED = 3;
/** A tag carried by a post the viewer engaged with (liked/bookmarked/authored). */
export const W_TAG_ENGAGED = 1;

/** An explicitly WATCHED symbol — the strongest ticker signal. */
export const W_SYMBOL_WATCHED = 3;
/** A symbol carried by a post the viewer engaged with. */
export const W_SYMBOL_ENGAGED = 1;

/** A 1st-degree FOLLOWED author. */
export const W_AUTHOR_FOLLOWED = 2.5;
/** A 2nd-degree author (followed by someone the viewer follows). */
export const W_AUTHOR_SECOND_DEGREE = 1;

/**
 * Weight on the global recency-decayed hot-score prior. Kept modest so a real
 * interest match (even a single followed tag, weight 3) outranks a merely-hot
 * post, while a cold-start viewer with no signals still gets the hot ordering.
 */
export const HOT_PRIOR_WEIGHT = 1.5;

/** Default: at most this many posts from one author lead the For-You window. */
export const FORYOU_AUTHOR_CAP = 2;

/**
 * Accumulates a tag/symbol/author weight into a profile map, keeping the MAX of
 * any competing weights for the same key (a tag that is BOTH followed and
 * engaged scores as the stronger followed weight, never the sum — so one key
 * can't be double-counted into a runaway score). Mutates and returns the map.
 */
export function addWeight(
  map: Map<string, number>,
  key: string,
  weight: number
): Map<string, number> {
  if (!key) return map;
  const prev = map.get(key);
  if (prev === undefined || weight > prev) map.set(key, weight);
  return map;
}

/** The raw signal rows used to build a profile (already normalized by the caller). */
export interface ProfileSignals {
  /** Tags the viewer follows (lower-cased). */
  followedTags: readonly string[];
  /** Symbols the viewer watches (UPPER-cased). */
  watchedSymbols: readonly string[];
  /** Author ids the viewer follows directly. */
  followedAuthors: readonly string[];
  /** Author ids followed by the people the viewer follows (2nd-degree). */
  secondDegreeAuthors: readonly string[];
  /** Tags carried by posts the viewer engaged with (liked/bookmarked/authored). */
  engagedTags: readonly string[];
  /** Symbols carried by posts the viewer engaged with. */
  engagedSymbols: readonly string[];
}

/**
 * Builds the viewer's weighted interest profile from already-fetched signal
 * rows. Pure: the caller does the DB work and normalization, this just folds
 * the rows into weighted maps with the documented precedence (followed/watched
 * beats engaged; 1st-degree beats 2nd-degree; a key never double-counts).
 */
export function buildInterestProfile(signals: ProfileSignals): InterestProfile {
  const tags = new Map<string, number>();
  const symbols = new Map<string, number>();
  const authors = new Map<string, number>();

  for (const t of signals.engagedTags) addWeight(tags, t, W_TAG_ENGAGED);
  for (const t of signals.followedTags) addWeight(tags, t, W_TAG_FOLLOWED);

  for (const s of signals.engagedSymbols) addWeight(symbols, s, W_SYMBOL_ENGAGED);
  for (const s of signals.watchedSymbols) addWeight(symbols, s, W_SYMBOL_WATCHED);

  // 2nd-degree first so a 1st-degree follow overwrites it with the higher weight.
  for (const a of signals.secondDegreeAuthors) addWeight(authors, a, W_AUTHOR_SECOND_DEGREE);
  for (const a of signals.followedAuthors) addWeight(authors, a, W_AUTHOR_FOLLOWED);

  return { tags, symbols, authors };
}

/** True when the profile carries NO signal at all → the caller falls back to Top. */
export function isColdStart(profile: InterestProfile): boolean {
  return profile.tags.size === 0 && profile.symbols.size === 0 && profile.authors.size === 0;
}

/** A candidate post reduced to just what scoring needs. */
export interface ForYouCandidate {
  id: string;
  authorId: string;
  tags: readonly string[];
  symbols: readonly string[];
  /** The post's recency-decayed Top-feed hot-score (caller computes it). */
  hotScore: number;
}

/** A scored candidate, with a breakdown for explainability + tests. */
export interface ScoredCandidate<T> {
  candidate: T;
  score: number;
  /** Contribution from matched tags. */
  tagScore: number;
  /** Contribution from matched symbols. */
  symbolScore: number;
  /** Contribution from the author match (1st/2nd-degree). */
  authorScore: number;
  /** Contribution from the global hot-score prior. */
  priorScore: number;
}

/**
 * Scores ONE candidate against the interest profile. Deterministic and fully
 * additive — every component is independently inspectable (see ScoredCandidate).
 * Tags/symbols are deduped per-post so a post repeating the same tag can't
 * inflate its own score.
 */
export function scoreCandidate(
  candidate: ForYouCandidate,
  profile: InterestProfile
): ScoredCandidate<ForYouCandidate> {
  let tagScore = 0;
  for (const t of new Set(candidate.tags)) tagScore += profile.tags.get(t) ?? 0;

  let symbolScore = 0;
  for (const s of new Set(candidate.symbols)) symbolScore += profile.symbols.get(s) ?? 0;

  const authorScore = profile.authors.get(candidate.authorId) ?? 0;
  const priorScore = HOT_PRIOR_WEIGHT * Math.max(0, candidate.hotScore);

  return {
    candidate,
    tagScore,
    symbolScore,
    authorScore,
    priorScore,
    score: tagScore + symbolScore + authorScore + priorScore,
  };
}

/**
 * Per-author diversity cap for the For-You window. Mirrors the Top feed's cap:
 * given items ALREADY sorted best-first, keep each only until its author has
 * appeared `maxPerAuthor` times, appending overflow (still in score order) so
 * the feed stays full when there aren't enough distinct authors. Deterministic.
 */
export function applyForYouDiversityCap<T>(
  items: readonly ScoredCandidate<T>[],
  authorOf: (c: T) => string,
  maxPerAuthor = FORYOU_AUTHOR_CAP
): ScoredCandidate<T>[] {
  if (maxPerAuthor < 1) return [...items];
  const seen = new Map<string, number>();
  const kept: ScoredCandidate<T>[] = [];
  const overflow: ScoredCandidate<T>[] = [];
  for (const item of items) {
    const author = authorOf(item.candidate);
    const n = seen.get(author) ?? 0;
    if (n < maxPerAuthor) {
      kept.push(item);
      seen.set(author, n + 1);
    } else {
      overflow.push(item);
    }
  }
  return kept.concat(overflow);
}

/**
 * Ranks the full candidate set for the For-You feed. Pure orchestration:
 *   1. score every candidate against the profile,
 *   2. sort by score desc, breaking exact ties by hot-score (fresher/higher-
 *      engagement first) then by id for total determinism,
 *   3. apply the per-author diversity cap.
 * The caller has already excluded the viewer's own posts + blocked authors and
 * deduped by id; this returns the candidates in final display order.
 *
 * @returns the ranked ScoredCandidates (the caller maps back to its post rows).
 */
export function rankForYou(
  candidates: readonly ForYouCandidate[],
  profile: InterestProfile,
  opts: { maxPerAuthor?: number } = {}
): ScoredCandidate<ForYouCandidate>[] {
  const scored = candidates.map((c) => scoreCandidate(c, profile));
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.candidate.hotScore - a.candidate.hotScore ||
      a.candidate.id.localeCompare(b.candidate.id)
  );
  return applyForYouDiversityCap(scored, (c) => c.authorId, opts.maxPerAuthor);
}
