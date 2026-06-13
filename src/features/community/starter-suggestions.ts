/**
 * Cold-start "starter follows" — pure derivation of seed tags + popular authors
 * a brand-new (or low-signal) viewer can follow so their For-You / Following
 * feeds aren't empty. NO new schema: tags are derived from the trending board /
 * curated SUGGESTED_TAGS, authors from the contributor leaderboard. Everything
 * here is deterministic data-shaping; the DB/queries live on the server.
 */

import { SUGGESTED_TAGS } from "./types";
import { normalizeTag } from "./followed-tags";

/** A suggested tag to follow, with the same shape the topics rail already uses. */
export interface SuggestedTag {
  tag: string;
  /** Posts carrying the tag in the trending window (0 for a curated fallback). */
  count: number;
}

/** A suggested author to follow — a compact projection of a leaderboard row. */
export interface SuggestedAuthor {
  username: string;
  displayName: string;
  avatar: string | null;
  /** A short reason string for the UI (e.g. "Top contributor"). */
  reason: string;
}

/**
 * Builds the starter TAG suggestions: prefer the community's actually-trending
 * topics (most discussion = most likely to be interesting), then top up with the
 * curated SUGGESTED_TAGS so a quiet community still offers a sensible seed set.
 * Already-followed tags are excluded so the surface only shows actionable adds.
 *
 * @param trending  trending topics (key + count) from the board, best-first
 * @param followed  tags the viewer already follows (excluded)
 * @param limit     max suggestions (default 8)
 */
export function buildStarterTags(
  trending: readonly { tag: string; count: number }[],
  followed: readonly string[],
  limit = 8
): SuggestedTag[] {
  const followedSet = new Set(followed.map((t) => t.toLowerCase()));
  const seen = new Set<string>();
  const out: SuggestedTag[] = [];

  const push = (raw: string, count: number) => {
    const tag = normalizeTag(raw);
    if (!tag || followedSet.has(tag) || seen.has(tag)) return;
    seen.add(tag);
    out.push({ tag, count });
  };

  for (const t of trending) {
    if (out.length >= limit) break;
    push(t.tag, t.count);
  }
  for (const t of SUGGESTED_TAGS) {
    if (out.length >= limit) break;
    push(t, 0);
  }
  return out.slice(0, limit);
}

/**
 * Builds the starter AUTHOR suggestions from the contributor leaderboard. Skips
 * the viewer themselves and anyone they already follow, so the list is always
 * actionable. The reason line is a transparent, non-ML label.
 *
 * @param leaderboard  contributor rows (username/displayName/avatar, best-first)
 * @param followed     usernames the viewer already follows (excluded)
 * @param selfUsername the viewer's own handle (excluded), or null
 * @param limit        max suggestions (default 5)
 */
export function buildStarterAuthors(
  leaderboard: readonly {
    username: string;
    displayName: string;
    avatar: string | null;
  }[],
  followed: readonly string[],
  selfUsername: string | null,
  limit = 5
): SuggestedAuthor[] {
  const followedSet = new Set(followed.map((u) => u.toLowerCase()));
  const self = selfUsername?.toLowerCase() ?? null;
  const seen = new Set<string>();
  const out: SuggestedAuthor[] = [];

  for (const row of leaderboard) {
    if (out.length >= limit) break;
    const u = row.username.toLowerCase();
    if (u === self || followedSet.has(u) || seen.has(u)) continue;
    seen.add(u);
    out.push({
      username: row.username,
      displayName: row.displayName,
      avatar: row.avatar,
      reason: "Top contributor",
    });
  }
  return out.slice(0, limit);
}

/**
 * Whether the starter-suggestions surface should be shown at all. We show it
 * when the viewer has a thin social graph — few or no follows AND few or no
 * followed tags / watched symbols — i.e. their personalized feeds would
 * otherwise be sparse. A well-connected viewer never sees it.
 */
export const STARTER_MIN_FOLLOWS = 3;

export function shouldShowStarter(counts: {
  follows: number;
  followedTags: number;
  watchedSymbols: number;
}): boolean {
  return (
    counts.follows < STARTER_MIN_FOLLOWS && counts.followedTags === 0 && counts.watchedSymbols === 0
  );
}
