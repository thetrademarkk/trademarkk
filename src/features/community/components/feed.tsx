"use client";

import * as React from "react";
import { CheckCheck, MessagesSquare } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { useFeed, type FeedScope, type FeedSort } from "../api";
import type { FeedResponse } from "../types";
import { PostCard } from "./post-card";

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
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useFeed(
    sort,
    tag,
    search,
    scope,
    initialFeed,
    symbol
  );
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

  const posts = data?.pages.flatMap((p) => p.posts) ?? [];
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
