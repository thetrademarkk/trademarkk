"use client";

import * as React from "react";
import Link from "next/link";
import { Bell, Check, Inbox } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { cn, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMarkNotificationsRead, useNotifications } from "../api";
import { CommunityAvatar } from "./avatar";

const COPY: Record<string, string> = {
  like: "liked your post",
  comment: "commented on your post",
  reply: "replied to your comment",
  follow: "followed you",
  mention: "mentioned you",
};

/** Notification bell with unread badge — shown to signed-in community members. */
export function NotificationsBell() {
  const { data: session } = useSession();
  const { data } = useNotifications(Boolean(session));
  const markRead = useMarkNotificationsRead();
  if (!session) return null;

  const unread = data?.unread ?? 0;
  const items = data?.notifications ?? [];

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open && unread > 0) markRead.mutate();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
          className="relative"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-money text-[10px] font-bold text-accent-fg">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {items.length > 0 && <Check className="h-3.5 w-3.5 text-muted" aria-hidden />}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-sm text-muted">
              <Inbox className="h-6 w-6" aria-hidden />
              Nothing yet — say hi
            </div>
          ) : (
            items.map((n) => (
              <Link
                key={n.id}
                href={n.postId ? `/community/post/${n.postId}` : `/community/u/${n.actor.username}`}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors hover:bg-surface-2",
                  !n.read && "bg-accent/5"
                )}
              >
                <CommunityAvatar
                  size="sm"
                  username={n.actor.username}
                  displayName={n.actor.displayName}
                />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{n.actor.displayName}</span>{" "}
                  <span className="text-muted">{COPY[n.type] ?? n.type}</span>
                </span>
                <time dateTime={n.createdAt} className="shrink-0 text-xs text-muted">
                  {timeAgo(n.createdAt)}
                </time>
              </Link>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
