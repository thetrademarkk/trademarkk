/**
 * Pure, DOM- and DB-free scoring for the Trending tickers & topics board.
 *
 * The board surfaces what the community is *actively discussing* — it is
 * explicitly NOT a buy/sell signal. To keep it honest and spam-resistant the
 * ranking is built around the UNIQUE-AUTHOR count, not raw post volume:
 *
 *  - A key (a $ticker or a #topic) only TRENDS when at least
 *    `MIN_DISTINCT_AUTHORS` different people have posted about it in the window.
 *    One prolific poster spamming the same ticker ten times therefore can NOT
 *    make it trend — their ten posts collapse to a single distinct author.
 *  - Among the keys that clear the gate, ranking is recency-weighted: a post
 *    from an hour ago counts for more than one from six days ago (a smooth
 *    half-life decay), and distinct authors dominate the score so breadth of
 *    discussion outweighs sheer volume.
 *
 * These helpers take already-fetched, block-filtered engagement rows (the
 * server excludes posts from authors the viewer has blocked before calling in)
 * and turn them into a ranked, capped board. No network, no clock except the
 * `now` the caller passes — so the recency weighting and tie-breaks are
 * deterministically unit-testable.
 */

/** A single post→key occurrence: which key, who posted it, and when. */
export interface TrendingEvent {
  /** The trending key — an uppercase $ticker symbol or a lowercase #topic tag. */
  key: string;
  /** The post's author id — distinct authors are what make a key trend. */
  authorId: string;
  /** Hours between the post's creation and `now` (clamped to >= 0 by scoring). */
  ageHours: number;
}

/** A ranked board entry. */
export interface TrendingItem {
  key: string;
  /** Distinct authors discussing this key in the window (the PRIMARY rank key). */
  authors: number;
  /** Total posts mentioning this key in the window (the volume signal). */
  posts: number;
  /**
   * Recency-weighted volume (Σ recencyWeight(ageHours)) — the SECONDARY rank key,
   * used only to order keys that have the SAME distinct-author count. Surfaced
   * mainly for display/debugging; ranking primacy belongs to `authors`.
   */
  score: number;
}

/**
 * Minimum distinct authors a key needs before it can appear on the board. Two
 * is enough to prove a key isn't one person talking to themselves while still
 * letting genuinely small-but-real conversations surface on a young community.
 */
export const MIN_DISTINCT_AUTHORS = 2;

/** Recency half-life in hours — a post this old contributes half its weight. */
const RECENCY_HALF_LIFE_HOURS = 24;

/**
 * Recency weight for a post `ageHours` old: 1 for a brand-new post, decaying by
 * half every `RECENCY_HALF_LIFE_HOURS`. Negative ages (clock skew) clamp to 0
 * hours (full weight); the decay never goes negative.
 */
export function recencyWeight(ageHours: number): number {
  const age = ageHours > 0 ? ageHours : 0;
  return Math.pow(0.5, age / RECENCY_HALF_LIFE_HOURS);
}

interface Accumulator {
  key: string;
  authors: Set<string>;
  posts: number;
  /** Sum of per-post recency weights — the recency-weighted volume. */
  weighted: number;
}

/**
 * Ranks trending keys from raw engagement events.
 *
 * Algorithm:
 *  1. Group events by key, tracking the set of distinct authors, the post count
 *     and the recency-weighted volume (Σ recencyWeight(ageHours)).
 *  2. Drop every key with fewer than `minAuthors` distinct authors — this is
 *     the spam gate: a single author can never push a key onto the board.
 *  3. Rank by distinct authors FIRST (breadth of discussion is the headline
 *     signal and can never be overpowered by raw volume — that is what stops a
 *     prolific poster from dominating), THEN by recency-weighted volume
 *     (`score`, a half-life-decayed Σ of post weights so fresher chatter wins),
 *     then by total posts, then alphabetically by key.
 *  4. The full sort order is therefore: authors desc → score desc → posts desc
 *     → key asc — fully deterministic with stable alphabetical tie-breaks.
 *  5. Return the top `limit` entries.
 *
 * @param events  block-filtered post→key occurrences (the caller excludes
 *                blocked authors' posts before aggregating).
 * @param opts.minAuthors  override the distinct-author gate (default
 *                MIN_DISTINCT_AUTHORS); pass 1 only for diagnostics/tests.
 * @param opts.limit  max entries returned (default 10).
 */
export function rankTrending(
  events: readonly TrendingEvent[],
  opts: { minAuthors?: number; limit?: number } = {}
): TrendingItem[] {
  const minAuthors = opts.minAuthors ?? MIN_DISTINCT_AUTHORS;
  const limit = opts.limit ?? 10;

  const byKey = new Map<string, Accumulator>();
  for (const e of events) {
    if (!e.key) continue;
    let acc = byKey.get(e.key);
    if (!acc) {
      acc = { key: e.key, authors: new Set(), posts: 0, weighted: 0 };
      byKey.set(e.key, acc);
    }
    acc.authors.add(e.authorId);
    acc.posts += 1;
    acc.weighted += recencyWeight(e.ageHours);
  }

  const ranked: TrendingItem[] = [];
  for (const acc of byKey.values()) {
    const authors = acc.authors.size;
    if (authors < minAuthors) continue; // unique-author spam gate
    ranked.push({
      key: acc.key,
      authors,
      posts: acc.posts,
      // `score` is the recency-weighted volume — the SECONDARY rank key only.
      score: acc.weighted,
    });
  }

  // Distinct authors are the PRIMARY key: more authors always outranks more
  // volume, so breadth of discussion can never be overpowered by one loud
  // voice. Recency-weighted volume, then posts, then key break the remaining ties.
  ranked.sort(
    (a, b) =>
      b.authors - a.authors || b.score - a.score || b.posts - a.posts || a.key.localeCompare(b.key)
  );
  return ranked.slice(0, limit);
}

/** Supported trending windows. */
export type TrendingWindow = "24h" | "7d";

/** Hours covered by each window — also the SQL `since` boundary the server uses. */
export function windowHours(window: TrendingWindow): number {
  return window === "24h" ? 24 : 24 * 7;
}

/** Normalizes an arbitrary query-string value to a valid window (default 24h). */
export function parseWindow(raw: string | null | undefined): TrendingWindow {
  return raw === "7d" ? "7d" : "24h";
}
