/**
 * Pure, DOM- and DB-free helpers for the "follow a tag" feature. A followed tag
 * surfaces its posts in the viewer's Following feed (alongside posts by followed
 * users). These helpers keep the tag grammar, the optimistic follow/unfollow
 * decision, and the cross-source post de-duplication unit-testable without a
 * database.
 *
 * The tag grammar mirrors the post-creation schema (`^[a-z0-9-]{2,20}$`): the
 * same value that can be stored on a post is the only thing that can be a tag
 * page or a followed tag — so a tag page never resolves to something un-postable.
 */

/** Tag grammar — identical to the post-creation schema (lowercase, digits, dashes). */
export const TAG_PATTERN = /^[a-z0-9-]{2,20}$/;

/** Max distinct tags a single user may follow (generous; guards the left rail + queries). */
export const MAX_FOLLOWED_TAGS = 50;

/**
 * Normalizes a raw tag value to its canonical stored form: trimmed, lowercased.
 * Returns `null` when the result is not a valid tag (so callers can 404 / ignore
 * rather than query with junk). A leading `#` is tolerated and stripped.
 */
export function normalizeTag(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().replace(/^#/, "").toLowerCase();
  return TAG_PATTERN.test(t) ? t : null;
}

/** True when `raw` is a syntactically valid tag (after normalization). */
export function isValidTag(raw: string | null | undefined): boolean {
  return normalizeTag(raw) !== null;
}

/**
 * Decides the next state of a follow toggle given whether the tag is currently
 * followed. Pure mirror of the server's insert/delete so the optimistic client
 * update and the server agree exactly.
 */
export function planTagFollow(currentlyFollowed: boolean): {
  follow: boolean;
  nextFollowed: boolean;
} {
  return { follow: !currentlyFollowed, nextFollowed: !currentlyFollowed };
}

/**
 * Optimistically toggles a tag within the viewer's followed-tags list, keeping
 * it sorted and capped. Used by the left-rail "Followed tags" list so following
 * a tag from the tag page reflects instantly without a refetch.
 */
export function toggleFollowedTag(list: readonly string[], tag: string): string[] {
  const t = normalizeTag(tag);
  if (!t) return [...list];
  const set = new Set(list.map((x) => x.toLowerCase()));
  if (set.has(t)) {
    set.delete(t);
  } else if (set.size < MAX_FOLLOWED_TAGS) {
    set.add(t);
  }
  return [...set].sort();
}

/** A minimal shape every post view satisfies — enough to de-duplicate by id. */
interface HasId {
  id: string;
}

/**
 * De-duplicates a list of posts by id, preserving first-seen order. The Following
 * feed unions posts by followed users with posts carrying a followed tag, so a
 * single post that matches BOTH (a followed user wrote it AND it has a followed
 * tag) must appear exactly once. The DB `IN (...) OR tags LIKE ...` already
 * returns each row once, but the union is also assembled in JS in places (and
 * tested here), so this guards both paths.
 */
export function dedupePostsById<T extends HasId>(posts: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of posts) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}
