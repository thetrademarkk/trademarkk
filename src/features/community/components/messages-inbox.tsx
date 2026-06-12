"use client";

import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useConversations } from "../api";
import { CommunityAvatar } from "./avatar";

/** Inbox pane: one row per conversation, unread-first styling, 5s polling. */
export function MessagesInbox({ selectedId }: { selectedId: string | null }) {
  const { data, isLoading } = useConversations(true, 5_000);
  const items = data?.conversations ?? [];

  if (isLoading) {
    return (
      <div className="space-y-2 p-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-muted">
        <MessageCircle className="h-6 w-6" aria-hidden />
        No messages yet — open a trader&apos;s profile and say hi.
      </div>
    );
  }

  return (
    <nav aria-label="Conversations" className="divide-y">
      {items.map((c) => (
        <Link
          key={c.id}
          href={`/community/messages?c=${c.id}`}
          aria-current={selectedId === c.id ? "true" : undefined}
          className={cn(
            "flex items-center gap-2.5 px-3 py-3 transition-colors hover:bg-surface-2",
            selectedId === c.id && "bg-accent/5"
          )}
        >
          <CommunityAvatar
            username={c.peer.username}
            displayName={c.peer.displayName}
            avatar={c.peer.avatar}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className={cn("truncate text-sm", c.unread > 0 && "font-semibold")}>
                {c.peer.displayName}
              </span>
              <time dateTime={c.lastMessageAt} className="shrink-0 text-[11px] text-muted">
                {timeAgo(c.lastMessageAt)}
              </time>
            </span>
            <span
              className={cn(
                "block truncate text-xs",
                c.unread > 0 ? "font-medium text-foreground" : "text-muted"
              )}
            >
              {c.lastMessage
                ? `${c.lastMessage.mine ? "You: " : ""}${c.lastMessage.body}`
                : "New conversation"}
            </span>
          </span>
          {c.unread > 0 && (
            <span
              aria-label={`${c.unread} unread`}
              className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 font-money text-[10px] font-bold text-accent-fg"
            >
              {c.unread > 9 ? "9+" : c.unread}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
