/**
 * Pure ranking for the "More like this" rail on the post detail page.
 * Tag-overlapping posts rank first (most shared tags → most engagement →
 * newest); when the young feed has too few tag matches, the rail fills with
 * the latest other posts so it never looks broken.
 */

export interface RelatedCandidate {
  id: string;
  tags: string[];
  likeCount: number;
  commentCount: number;
  createdAt: string; // ISO — lexicographic order == chronological order
}

export interface RankedRelated<T> {
  posts: T[];
  /** True when at least one pick actually shares a tag with the current post. */
  byTag: boolean;
}

export function rankRelated<T extends RelatedCandidate>(
  current: { id: string; tags: string[] },
  candidates: T[],
  limit = 4
): RankedRelated<T> {
  const myTags = new Set(current.tags.map((t) => t.toLowerCase()));
  const scored = candidates
    .filter((c) => c.id !== current.id)
    .map((c) => ({
      post: c,
      overlap: c.tags.reduce((n, t) => n + (myTags.has(t.toLowerCase()) ? 1 : 0), 0),
      engagement: c.likeCount + c.commentCount,
    }));

  const byRelevance = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
    b.overlap - a.overlap ||
    b.engagement - a.engagement ||
    b.post.createdAt.localeCompare(a.post.createdAt);
  const byRecency = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
    b.post.createdAt.localeCompare(a.post.createdAt);

  const matches = scored.filter((s) => s.overlap > 0).sort(byRelevance);
  const rest = scored.filter((s) => s.overlap === 0).sort(byRecency);
  const picked = [...matches, ...rest].slice(0, Math.max(0, limit));

  return { posts: picked.map((s) => s.post), byTag: picked.some((s) => s.overlap > 0) };
}
