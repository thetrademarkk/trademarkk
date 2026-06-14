"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CalendarClock, Pin } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { CommentSection, PostCard, RelatedPosts, usePost } from "@/features/community";
import { communityBackHref, FEED_CONTEXT_KEY } from "@/features/community/back-nav";
import { shortDate } from "@/features/community/events";

/**
 * Pinned header shown on an auto-created event/market-session thread (rank-18):
 * a clear time-box + an explicit "opened automatically by TradeMarkk" label so
 * a reader always knows the thread isn't a person's post. No fake activity.
 */
function EventThreadHeader({ type, date }: { type: "market-open" | "expiry-day"; date: string }) {
  const isExpiry = type === "expiry-day";
  const label = isExpiry ? `Expiry Day · ${shortDate(date)}` : `Market Open · ${shortDate(date)}`;
  return (
    <div
      data-testid="event-thread-header"
      className="flex items-start gap-2.5 rounded-xl border border-accent/30 bg-accent/8 px-4 py-3"
    >
      <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-accent">
          <Pin className="h-3.5 w-3.5" aria-hidden /> {label}
        </p>
        <p className="mt-0.5 text-xs leading-5 text-muted" data-event-automated>
          Pinned session thread, opened automatically by TradeMarkk — not a person&apos;s post.
          Share your take below; educational discussion only, no tips or calls.
        </p>
      </div>
    </div>
  );
}

/** Mirrors the post layout so loading doesn't flash a shapeless gray block. */
function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading post">
      <div className="rounded-xl border bg-surface p-4">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-32 rounded" />
            <Skeleton className="h-3 w-44 rounded" />
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <Skeleton className="h-5 w-3/4 rounded" />
          <Skeleton className="h-4 w-full rounded" />
          <Skeleton className="h-4 w-full rounded" />
          <Skeleton className="h-4 w-2/3 rounded" />
        </div>
        <div className="mt-4 flex gap-2 border-t pt-3">
          <Skeleton className="h-7 w-14 rounded-md" />
          <Skeleton className="h-7 w-14 rounded-md" />
          <Skeleton className="h-7 w-9 rounded-md" />
        </div>
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-28 rounded" />
        <Skeleton className="h-16 rounded-lg" />
        <div className="flex gap-2.5">
          <Skeleton className="h-7 w-7 rounded-full" />
          <Skeleton className="h-14 flex-1 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export function PostDetail({ id }: { id: string }) {
  const { data, isLoading, isError } = usePost(id);
  // The feed page remembers its filters; the back link restores them. Reading
  // sessionStorage in an effect keeps server and first client render identical.
  const [backHref, setBackHref] = React.useState("/community");
  React.useEffect(() => {
    try {
      setBackHref(communityBackHref(sessionStorage.getItem(FEED_CONTEXT_KEY)));
    } catch {
      /* storage blocked — plain feed link is fine */
    }
  }, []);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 pb-44 sm:pb-6">
      <Link
        href={backHref}
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted hover:text-accent"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to community
      </Link>
      {isLoading ? (
        <DetailSkeleton />
      ) : isError || !data ? (
        <p className="py-16 text-center text-sm text-muted">
          This post doesn&apos;t exist (or was deleted).
        </p>
      ) : (
        <div className="space-y-6">
          {data.eventThread && (
            <EventThreadHeader type={data.eventThread.type} date={data.eventThread.date} />
          )}
          <PostCard post={data.post} detail authorFollowedByMe={data.authorFollowedByMe} />
          <CommentSection postId={id} comments={data.comments} />
          <RelatedPosts posts={data.related} byTag={data.relatedByTag} />
        </div>
      )}
    </div>
  );
}
