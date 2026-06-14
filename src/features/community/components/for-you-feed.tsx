"use client";

import { MessagesSquare, Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { useForYou } from "../api";
import { PostCard } from "./post-card";
import { StarterSuggestions } from "./starter-suggestions";

/**
 * The "For You" interest feed — a single ranked page from `useForYou` (the
 * server re-ranks recent posts by the viewer's interest signals, falling back
 * to the global Top feed for cold-start viewers). Renders the cold-start
 * starter-follows surface above the posts for low-signal viewers. Not infinite:
 * deeper browsing lives in Latest/Top.
 */
export function ForYouFeed({ enabled }: { enabled: boolean }) {
  const { data, isLoading, isError } = useForYou(enabled);

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading your feed">
        <StarterSuggestions enabled={enabled} />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-44 rounded-xl" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <p className="py-10 text-center text-sm text-loss">
        Could not load your feed — try refreshing.
      </p>
    );
  }

  const posts = data?.posts ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden />
        <span>Ranked from the tags, tickers and traders you engage with.</span>
      </div>
      <StarterSuggestions enabled={enabled} />
      {posts.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title="Nothing for you yet"
          description="Follow a few traders and tags to shape this feed — or check Latest for everything."
        />
      ) : (
        posts.map((post) => <PostCard key={post.id} post={post} />)
      )}
    </div>
  );
}
