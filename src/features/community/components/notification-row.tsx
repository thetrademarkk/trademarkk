"use client";

import Link from "next/link";
import { cn, timeAgo } from "@/lib/utils";
import { groupActorLabel, groupVerb, type NotificationGroup } from "../notifications";
import { CommunityAvatar } from "./avatar";

/**
 * One collapsed notification — stacked avatars, "Asha, Vik and 3 others liked
 * your post", relative time, unread dot. Shared by the bell dropdown and the
 * /community/notifications page; opening it marks every member read upstream.
 */
export function NotificationGroupRow({
  group,
  onOpen,
  className,
}: {
  group: NotificationGroup;
  onOpen?: (group: NotificationGroup) => void;
  className?: string;
}) {
  const href =
    group.type === "message"
      ? "/community/messages"
      : group.postId
        ? `/community/post/${group.postId}`
        : `/community/u/${group.actors[0]?.username ?? ""}`;
  const stack = group.actors.slice(0, 3);

  return (
    <Link
      href={href}
      onClick={() => onOpen?.(group)}
      data-notification-group={group.key}
      data-unread={!group.read}
      className={cn(
        "flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors hover:bg-surface-2",
        !group.read && "bg-accent/5",
        className
      )}
    >
      <span className={cn("flex shrink-0", stack.length > 1 && "-space-x-2.5")} aria-hidden>
        {stack.map((a) => (
          <span
            key={a.username}
            className={cn(stack.length > 1 && "rounded-full ring-2 ring-surface")}
          >
            <CommunityAvatar
              size="sm"
              avatar={a.avatar}
              username={a.username}
              displayName={a.displayName}
            />
          </span>
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2">
          <span className="font-medium">{groupActorLabel(group)}</span>{" "}
          <span className="text-muted">{groupVerb(group)}</span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <time dateTime={group.createdAt} className="text-xs text-muted">
          {timeAgo(group.createdAt)}
        </time>
        {!group.read && (
          <span className="h-1.5 w-1.5 rounded-full bg-accent-solid">
            <span className="sr-only">unread</span>
          </span>
        )}
      </span>
    </Link>
  );
}
