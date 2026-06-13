"use client";

import Link from "next/link";
import { CalendarClock, CalendarOff, MessageSquare, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useActiveEvents, type EventThreadView } from "../api";
import { formatCount } from "../format";

/** One active event thread row — a clear time-box badge + a link into the thread. */
function EventRow({ thread }: { thread: EventThreadView }) {
  const isExpiry = thread.type === "expiry-day";
  return (
    <li>
      <Link
        href={`/community/post/${thread.postId}`}
        data-event-row={thread.type}
        className="group block rounded-lg border border-transparent px-2.5 py-2 transition-colors hover:border-border hover:bg-surface-2"
      >
        <div className="flex items-center gap-1.5">
          <CalendarClock
            className={cn("h-3.5 w-3.5 shrink-0", isExpiry ? "text-accent" : "text-muted")}
            aria-hidden
          />
          <span
            className={cn(
              "truncate text-xs font-medium",
              isExpiry ? "text-accent" : "text-foreground"
            )}
          >
            {thread.badge}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-1 text-sm text-foreground group-hover:text-accent">
          {thread.title}
        </p>
        <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
          <MessageSquare className="h-3 w-3" aria-hidden />
          <span className="font-money tabular-nums">{formatCount(thread.commentCount)}</span>
          <span>{thread.commentCount === 1 ? "reply" : "replies"} · join the thread</span>
        </span>
      </Link>
    </li>
  );
}

/**
 * "Today" card (rank-18) — the community's "where everyone is right now" focal
 * point. On a trading day it lists the auto-created market-session threads (a
 * daily Market Open thread + any index Expiry-Day thread), each with a clear
 * time-box and a link into the thread. On a weekend/holiday it shows a graceful
 * "Markets closed today" empty state.
 *
 * The threads are auto-posted by an automated house account — clearly labelled
 * here as automated, never fake user activity. Viewer-independent; degrades to
 * rendering nothing if the surface errors (the query returns an empty payload).
 */
export function EventsCard({ className }: { className?: string }) {
  const { data, isLoading } = useActiveEvents();

  // Before the first response, don't reserve space (avoids a layout flash on
  // the SSR/ISR'd feed page).
  if (!data && !isLoading) return null;

  const threads = data?.threads ?? [];
  const marketClosed = data?.marketClosed ?? false;

  return (
    <div className={cn("rounded-xl border bg-surface p-4", className)} data-testid="events-card">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <CalendarClock className="h-4 w-4 text-accent" aria-hidden /> Today
        </h2>
      </div>

      {marketClosed ? (
        <div
          data-events-closed
          className="flex items-center gap-2 rounded-lg bg-surface-2/60 px-3 py-2.5 text-xs text-muted"
        >
          <CalendarOff className="h-4 w-4 shrink-0" aria-hidden />
          <span>Markets closed today — no live session thread. See you next trading day.</span>
        </div>
      ) : threads.length === 0 ? (
        <p className="px-1 py-1.5 text-xs text-muted">
          {isLoading ? "Loading today's threads…" : "No active session thread right now."}
        </p>
      ) : (
        <ul className="space-y-1">
          {threads.map((t) => (
            <EventRow key={`${t.type}:${t.date}`} thread={t} />
          ))}
        </ul>
      )}

      {/* Honesty: the threads are auto-posted, never fabricated user activity. */}
      <p className="mt-3 flex items-start gap-1.5 border-t pt-2.5 text-[11px] leading-4 text-muted">
        <Sparkles className="mt-px h-3 w-3 shrink-0" aria-hidden />
        <span>Session threads are opened automatically by TradeMarkk. Post your take inside.</span>
      </p>
      {isLoading && <span className="sr-only">Loading today&apos;s threads</span>}
    </div>
  );
}
