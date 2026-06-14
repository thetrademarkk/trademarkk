"use client";

import * as React from "react";
import { CheckCheck, MessagesSquare } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { useFeed, useNewPostsCount, type FeedScope, type FeedSort } from "../api";
import { isLatestLiveScope } from "../new-posts";
import type { FeedResponse, PostView } from "../types";
import { PostCard } from "./post-card";
import { NewPostsPill } from "./new-posts-pill";

export function Feed({
  sort,
  tag,
  search = null,
  scope = "all",
  initialFeed = null,
  symbol = null,
}: {
  sort: FeedSort;
  tag: string | null;
  search?: string | null;
  scope?: FeedScope;
  /** Server-rendered (anonymous) first page — paints with the document. */
  initialFeed?: FeedResponse | null;
  /** Per-symbol stream scope — only posts tagged with this $cashtag. */
  symbol?: string | null;
}) {
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    useFeed(sort, tag, search, scope, initialFeed, symbol);
  const sentinelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) =>
        entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage && void fetchNextPage(),
      { rootMargin: "400px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Dedupe by id — a refetch that pulls newer posts into the head can otherwise
  // duplicate a post across the page-1/page-2 cursor boundary (and dup React keys).
  const posts = React.useMemo(() => {
    const seen = new Set<string>();
    const out: PostView[] = [];
    for (const p of data?.pages.flatMap((page) => page.posts) ?? []) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
    return out;
  }, [data]);

  /* ── "N new posts" live pill (rank-15) ───────────────────────────────────
   * Only meaningful on the recency-ordered Latest global feed; gated off on
   * Top/Saved/Following/Watchlist and on tag/symbol/search-filtered views. We
   * anchor the count to the createdAt of the post the user is CURRENTLY seeing
   * at the top, freezing it until they click the pill (so newly-arrived posts
   * accrue against a stable baseline rather than the moving head). */
  const livePill = isLatestLiveScope({ sort, scope, tag, search, symbol });
  const topCreatedAt = posts[0]?.createdAt ?? null;
  // The frozen baseline the count is measured against.
  const [seenTop, setSeenTop] = React.useState<string | null>(null);
  // Seed the baseline once the feed first has content; reset when the view's
  // identity (scope/tag/etc.) changes so a switched tab starts fresh.
  React.useEffect(() => {
    setSeenTop(null);
  }, [sort, tag, search, scope, symbol]);
  React.useEffect(() => {
    if (seenTop === null && topCreatedAt) setSeenTop(topCreatedAt);
  }, [seenTop, topCreatedAt]);

  const { data: newCount } = useNewPostsCount(seenTop, livePill);
  const count = livePill ? (newCount?.count ?? 0) : 0;

  const loadNew = React.useCallback(() => {
    // Clear the count instantly — nothing is newer than "now" — then refetch the
    // head so the new posts slide in at the top, and scroll there.
    setSeenTop(new Date().toISOString());
    void refetch().then(() => {
      setSeenTop(null); // re-anchor to the (new) top on the next render
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [refetch]);

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading posts">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-44 rounded-xl" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <p className="py-10 text-center text-sm text-loss">
        Could not load the feed — try refreshing.
      </p>
    );
  }

  if (posts.length === 0) {
    const empty =
      scope === "following"
        ? {
            title: "Your Following feed is empty",
            desc: "Follow traders from their profiles to build your feed.",
          }
        : scope === "saved"
          ? {
              title: "No saved posts yet",
              desc: "Tap the bookmark icon on any post to save it here.",
            }
          : symbol
            ? {
                title: `No posts about $${symbol} yet`,
                desc: "Be the first — share an idea, a chart, or a question. Educational only.",
              }
            : search
              ? { title: `No results for “${search}”`, desc: "Try a different search." }
              : tag
                ? {
                    title: `Nothing under #${tag} yet`,
                    desc: "Be the first — share a trade idea, a lesson, or a question.",
                  }
                : {
                    title: "No posts yet",
                    desc: "Be the first — share a trade idea, a lesson, or a question.",
                  };
    return <EmptyState icon={MessagesSquare} title={empty.title} description={empty.desc} />;
  }

  return (
    <div className="space-y-3">
      {livePill && <NewPostsPill count={count} onLoad={loadNew} />}
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
      <div ref={sentinelRef} aria-hidden />
      {isFetchingNextPage && <Skeleton className="h-44 rounded-xl" />}
      {!hasNextPage && posts.length > 5 && (
        <p className="flex items-center justify-center gap-1.5 py-6 text-center text-xs text-muted">
          <CheckCheck className="h-3.5 w-3.5" aria-hidden /> You&apos;re all caught up
        </p>
      )}
    </div>
  );
}
