/**
 * "Who to follow" — pure, DOM-free, deterministic follow-suggestion ranking.
 *
 * Given a set of candidate members the viewer does NOT already follow, this
 * module ranks them by a BLENDED, fully-explainable affinity score and attaches
 * a short, HONEST reason to each. There is no ML, no opaque weight: given the
 * same candidates + the same viewer signals, the ranking is identical every
 * time, and every term is independently unit-testable.
 *
 * ── The blended affinity score ──
 *   score(candidate) =
 *       W_SECOND_DEGREE  × diminishing(secondDegreeCount, SAT_SECOND_DEGREE)
 *     + W_SHARED_TAGS    × diminishing(sharedTags.length, SAT_SHARED)
 *     + W_SHARED_SYMBOLS × diminishing(sharedSymbols.length, SAT_SHARED)
 *     + W_QUALITY        × diminishing(recentQualityPosts, SAT_QUALITY)
 *     + reputationBoost(reputationScore)               ← a BOUNDED tie-break
 *
 * The first four terms are AFFINITY — they measure how relevant THIS candidate
 * is to THIS viewer (mutual connections, overlapping interests, recent genuine
 * activity). Reputation is deliberately the SMALLEST term and is hard-capped at
 * `MAX_REPUTATION_BOOST` so it can only break ties / nudge — it can NEVER
 * dominate. The design intent (and a unit test asserts it): a brand-new but
 * genuinely-relevant member with strong tag/symbol overlap MUST outrank a
 * high-standing stranger the viewer shares nothing with. We surface relevance,
 * not popularity.
 *
 * ── Honest reasons ──
 * Each suggestion carries ONE short reason describing the STRONGEST signal
 * behind it, e.g. "Followed by 3 people you follow", "Also posts about #banknifty",
 * "Also active in $NIFTY", or (only when nothing else applies) the standing tier
 * ("Established member"). No "sponsored", no growth-hacky copy — the reason is
 * always the real, relevance-based explanation.
 *
 * ── Diversity guard ──
 * To avoid a wall of five near-identical accounts, the final list caps how many
 * suggestions may share the SAME primary reason key (`MAX_PER_REASON`), so a
 * single dense mutual-follow cluster can't crowd out shared-interest matches.
 *
 * The caller (server) builds the candidate set with a bounded, indexed query,
 * applies the exclude-set (already-followed / blocked-either-way / banned /
 * self) in SQL, and fills the reputation + affinity counts. This module never
 * imports React, the DB, or any other feature module except the shared tier
 * metadata (pure constants).
 */

import { type ReputationTier, tierMeta } from "./reputation";

/* ── Reason kinds ────────────────────────────────────────────────────────────── */

/**
 * Why a candidate is suggested — the STRONGEST single signal, used both for the
 * UI reason line and for the per-reason diversity cap. Ordered by descending
 * priority in `REASON_PRIORITY` below.
 */
export type SuggestionReasonKind =
  | "second-degree" // followed by people you follow
  | "shared-tag" // posts about a tag you follow / engage with
  | "shared-symbol" // active in a symbol you watch / engage with
  | "reputation" // a high-standing member (last-resort reason)
  | "popular"; // cold-start: a popular contributor (no viewer signals)

/** Reason priority (high → low) — the first applicable kind becomes the reason. */
export const REASON_PRIORITY: SuggestionReasonKind[] = [
  "second-degree",
  "shared-tag",
  "shared-symbol",
  "reputation",
  "popular",
];

/* ── Weights, saturations & caps (documented constants — no ML) ─────────────── */

/** Max points from 2nd-degree connections ("followed by people you follow"). */
export const W_SECOND_DEGREE = 10;
/** Max points from tags the candidate shares with the viewer's interests. */
export const W_SHARED_TAGS = 8;
/** Max points from symbols the candidate shares with the viewer's interests. */
export const W_SHARED_SYMBOLS = 7;
/** Max points from the candidate's RECENT, genuine (unflagged) posting activity. */
export const W_QUALITY = 4;

/**
 * Saturation points — the count at which each affinity term is ~fully earned.
 * `SAT_SHARED` is intentionally LOW (3): a single shared followed-tag/watched-
 * symbol is an explicit intent signal and should earn most of its weight at once
 * — so ONE shared interest edges out a SINGLE 2nd-degree mutual, while several
 * mutuals (a denser social signal) still rank on top.
 */
export const SAT_SECOND_DEGREE = 6;
export const SAT_SHARED = 3;
export const SAT_QUALITY = 8;

/**
 * The ABSOLUTE most reputation can add to a candidate's score. Kept well BELOW a
 * single affinity term's weight (e.g. one shared followed-tag is worth far more)
 * so standing only ever breaks ties between similarly-relevant candidates — it
 * is structurally incapable of overpowering genuine relevance. A high-rep
 * stranger with zero overlap scores at most this; a newcomer with one shared
 * interest already beats them.
 */
export const MAX_REPUTATION_BOOST = 2;

/** At most this many suggestions may share the same primary reason kind. */
export const MAX_PER_REASON = 3;

/** Default number of suggestions returned. */
export const DEFAULT_SUGGESTION_LIMIT = 5;

/* ── Concave helper (diminishing returns) ───────────────────────────────────── */

/**
 * Maps a non-negative count to a 0..1 fraction with DIMINISHING RETURNS:
 * f(n) = ln(1+n) / ln(1+saturate), clamped to 1. The first connections/overlaps
 * move the needle a lot; later ones barely — so one dense cluster can't snowball.
 * Pure + monotonic non-decreasing in n, never exceeding 1.
 */
export function diminishing(n: number, saturate: number): number {
  const count = Math.max(0, n);
  if (saturate <= 0) return count > 0 ? 1 : 0;
  return Math.min(1, Math.log1p(count) / Math.log1p(saturate));
}

/**
 * The bounded reputation tie-break. Maps a 0..100 reputation score to at most
 * `MAX_REPUTATION_BOOST` points, linearly. Always small, always positive, never
 * able to overpower an affinity term. A missing score contributes nothing.
 */
export function reputationBoost(
  score: number | null | undefined,
  max = MAX_REPUTATION_BOOST
): number {
  if (typeof score !== "number" || !Number.isFinite(score) || score <= 0) return 0;
  return Math.min(max, (Math.min(100, score) / 100) * max);
}

/* ── Candidate + result shapes ──────────────────────────────────────────────── */

/**
 * A candidate member to (maybe) suggest, reduced to exactly what ranking needs.
 * The server fills this from existing tables AFTER applying the exclude-set
 * (already-followed / blocked-either-way / banned / self) — none of those ever
 * reach this module.
 */
export interface FollowCandidate {
  /** The candidate's account id. */
  userId: string;
  /** Public handle (for the UI link + reason de-dup). */
  username: string;
  /** Display name. */
  displayName: string;
  /** Avatar data-url or null. */
  avatar: string | null;
  /** Denormalized community-standing tier (NOT trading skill). May be null. */
  reputationTier: ReputationTier | null;
  /** Denormalized 0..100 standing score — feeds ONLY the bounded tie-break. */
  reputationScore: number | null;
  /**
   * How many of the people the VIEWER follows also follow this candidate
   * (2nd-degree strength). 0 when the candidate isn't a mutual-of-a-follow.
   */
  secondDegreeCount: number;
  /** Tags this candidate posts about that the viewer follows / engages with (lower-cased). */
  sharedTags: string[];
  /** Symbols this candidate posts about that the viewer watches / engages with (UPPER-cased). */
  sharedSymbols: string[];
  /** Count of the candidate's recent LIVE, unflagged posts (genuine activity). */
  recentQualityPosts: number;
}

/** A ranked suggestion: the candidate projection + its score + its honest reason. */
export interface FollowSuggestion {
  userId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  reputationTier: ReputationTier | null;
  /** The blended affinity score (for tests/debug; not shown raw in the UI). */
  score: number;
  /** The primary reason kind (drives the per-reason diversity cap). */
  reasonKind: SuggestionReasonKind;
  /** A short, honest, human reason line. */
  reason: string;
}

/* ── Scoring ────────────────────────────────────────────────────────────────── */

/** Defensive non-negative integer coercion. */
function nn(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * The blended affinity score for one candidate. Sum of the four affinity terms
 * (each weight × a diminishing fraction of its count) plus the BOUNDED
 * reputation tie-break. Pure + deterministic.
 */
export function scoreFollowCandidate(c: FollowCandidate): number {
  const second = W_SECOND_DEGREE * diminishing(nn(c.secondDegreeCount), SAT_SECOND_DEGREE);
  const tags = W_SHARED_TAGS * diminishing(c.sharedTags?.length ?? 0, SAT_SHARED);
  const symbols = W_SHARED_SYMBOLS * diminishing(c.sharedSymbols?.length ?? 0, SAT_SHARED);
  const quality = W_QUALITY * diminishing(nn(c.recentQualityPosts), SAT_QUALITY);
  const rep = reputationBoost(c.reputationScore);
  return second + tags + symbols + quality + rep;
}

/* ── Reasons ────────────────────────────────────────────────────────────────── */

/** Pluralizes "person/people" for the 2nd-degree reason. */
function peopleWord(n: number): string {
  return n === 1 ? "person" : "people";
}

/**
 * Builds the candidate's primary reason kind + human line, choosing the STRONGEST
 * applicable signal by `REASON_PRIORITY`. Honest + relevance-based; the
 * `reputation` / `popular` reasons are only used when no affinity signal applies.
 *
 * @param coldStart when true (the viewer has no signals at all), an affinity-less
 *   candidate is labelled "Popular in the community" rather than by tier — these
 *   are the cold-start popular-contributor fallbacks.
 */
export function buildReason(
  c: FollowCandidate,
  coldStart = false
): { kind: SuggestionReasonKind; reason: string } {
  if (nn(c.secondDegreeCount) > 0) {
    const n = nn(c.secondDegreeCount);
    return { kind: "second-degree", reason: `Followed by ${n} ${peopleWord(n)} you follow` };
  }
  const tag = (c.sharedTags ?? []).find((t) => t);
  if (tag) return { kind: "shared-tag", reason: `Also posts about #${tag}` };

  const symbol = (c.sharedSymbols ?? []).find((s) => s);
  if (symbol) return { kind: "shared-symbol", reason: `Also active in $${symbol}` };

  if (coldStart) return { kind: "popular", reason: "Popular in the community" };

  if (c.reputationTier && c.reputationTier !== "new") {
    return { kind: "reputation", reason: `${tierMeta(c.reputationTier).label} member` };
  }
  // Last-resort generic — still honest, never a dark pattern.
  return { kind: "popular", reason: "Active in the community" };
}

/* ── Diversity cap ──────────────────────────────────────────────────────────── */

/**
 * Caps how many suggestions may share the SAME reason kind, so the surface never
 * shows five near-identical accounts. Given items ALREADY sorted best-first,
 * keep each until its reason kind hits `maxPerReason`, then append the overflow
 * (still in rank order) so the list still fills if there aren't enough distinct
 * reasons. Deterministic.
 */
export function applyReasonDiversityCap(
  items: readonly FollowSuggestion[],
  maxPerReason = MAX_PER_REASON
): FollowSuggestion[] {
  if (maxPerReason < 1) return [...items];
  const seen = new Map<SuggestionReasonKind, number>();
  const kept: FollowSuggestion[] = [];
  const overflow: FollowSuggestion[] = [];
  for (const item of items) {
    const n = seen.get(item.reasonKind) ?? 0;
    if (n < maxPerReason) {
      kept.push(item);
      seen.set(item.reasonKind, n + 1);
    } else {
      overflow.push(item);
    }
  }
  return kept.concat(overflow);
}

/* ── Ranking ────────────────────────────────────────────────────────────────── */

/**
 * Ranks the candidate set into final "who to follow" suggestions:
 *   1. score every candidate (blended affinity + bounded reputation tie-break),
 *   2. attach its honest primary reason,
 *   3. sort by score desc, breaking exact ties by reputation score (the explicit
 *      tie-break), then by username for total determinism,
 *   4. apply the per-reason diversity cap,
 *   5. slice to `limit`.
 *
 * The caller has already excluded already-followed / blocked-either-way /
 * banned / self candidates; this is pure data-in / ranked-data-out.
 *
 * @param candidates the eligible candidate set (exclude-set already applied)
 * @param opts.limit          max suggestions (default DEFAULT_SUGGESTION_LIMIT)
 * @param opts.maxPerReason   per-reason diversity cap (default MAX_PER_REASON)
 * @param opts.coldStart      true when the viewer has no follow/interest signals
 *                            (changes the affinity-less reason to "popular")
 */
export function rankFollowSuggestions(
  candidates: readonly FollowCandidate[],
  opts: { limit?: number; maxPerReason?: number; coldStart?: boolean } = {}
): FollowSuggestion[] {
  const limit = opts.limit ?? DEFAULT_SUGGESTION_LIMIT;
  const scored: FollowSuggestion[] = candidates.map((c) => {
    const { kind, reason } = buildReason(c, opts.coldStart);
    return {
      userId: c.userId,
      username: c.username,
      displayName: c.displayName,
      avatar: c.avatar,
      reputationTier: c.reputationTier,
      score: scoreFollowCandidate(c),
      reasonKind: kind,
      reason,
    };
  });
  // Sort by blended score desc (reputation already contributes its bounded
  // tie-break inside the score), then by username for total determinism.
  scored.sort((a, b) => b.score - a.score || a.username.localeCompare(b.username));
  return applyReasonDiversityCap(scored, opts.maxPerReason).slice(0, limit);
}
