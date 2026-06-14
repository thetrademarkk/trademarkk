import type { FeedScope, FeedSort } from "./api";

/**
 * "N new posts" live pill (rank-15) — pure helpers.
 *
 * TRANSPORT: a lightweight count-only POLL, not SSE. The codebase has no
 * EventSource/SSE anywhere — every live surface (notifications 60s, DM inbox
 * 30s, DM thread 5s) uses TanStack Query `refetchInterval`. Vercel's serverless
 * runtime is hostile to long-lived SSE connections (function timeouts, no
 * sticky compute), so a cheap periodic count poll fits the deploy target and
 * matches the existing idioms. The poll only fetches a COUNT (no post payloads
 * until the user clicks the pill), pauses while the tab is hidden, and is
 * superseded by TanStack Query's own request de-duplication.
 */

/** Hard cap on the displayed count so a long-idle tab never shows a silly number. */
export const NEW_POSTS_CAP = 50;

/**
 * The pill only makes sense on the live, recency-ordered "Latest" view: the
 * default global feed with no tag/search/symbol filter. On Top (engagement
 * order, not recency), Saved, Following, Watchlist, For-You, a per-tag/symbol
 * stream, or a search, "newer than the top post" is meaningless or misleading,
 * so the pill is gated off there.
 */
export function isLatestLiveScope(args: {
  sort: FeedSort;
  scope: FeedScope;
  tag: string | null;
  search: string | null;
  symbol: string | null;
}): boolean {
  return (
    args.sort === "latest" && args.scope === "all" && !args.tag && !args.search && !args.symbol
  );
}

/** A minimal projection of a post needed to count it as "new" client-side. */
export interface CountablePost {
  /** ISO timestamp — the feed is ordered by this descending. */
  createdAt: string;
  /** The post author's username — used to skip the viewer's own brand-new post. */
  authorUsername: string;
}

/**
 * Count how many of `candidates` are strictly NEWER than `topCreatedAt` and not
 * authored by the viewer. Pure and deterministic — this is the exact contract
 * the count endpoint implements in SQL, mirrored here so the optimistic client
 * math and the unit tests agree:
 *  - strictly greater than the top timestamp (a post AT the boundary is already
 *    on screen, so `>`, never `>=`);
 *  - the viewer's own posts are excluded (their fresh post already prepends via
 *    the feed-list invalidation, so it must never inflate the pill);
 *  - the result is clamped to `NEW_POSTS_CAP`.
 *
 * `topCreatedAt` null/empty means the feed is empty — every candidate is new.
 */
export function countNewPosts(
  topCreatedAt: string | null,
  candidates: CountablePost[],
  viewerUsername: string | null
): number {
  let n = 0;
  for (const p of candidates) {
    if (viewerUsername && p.authorUsername === viewerUsername) continue;
    if (!topCreatedAt || p.createdAt > topCreatedAt) n++;
  }
  return Math.min(n, NEW_POSTS_CAP);
}

/** Pluralized label for the pill, e.g. "1 new post" / "3 new posts" / "50+ new posts". */
export function newPostsLabel(count: number): string {
  if (count >= NEW_POSTS_CAP) return `${NEW_POSTS_CAP}+ new posts`;
  return `${count} new post${count === 1 ? "" : "s"}`;
}
