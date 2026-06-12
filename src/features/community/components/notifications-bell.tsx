"use client";

import * as React from "react";
import Link from "next/link";
import { Bell, CheckCheck, Inbox } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMarkNotificationsRead, useNotifications } from "../api";
import { groupNotifications, type NotificationGroup } from "../notifications";
import { NotificationGroupRow } from "./notification-row";

/**
 * Notification bell with unread badge. Rows collapse LinkedIn-style ("Asha,
 * Vik and 3 others liked your post"); opening a row marks only that group's
 * members read, so the rest of the badge survives until each item is seen.
 */
export function NotificationsBell() {
  const { data: session } = useSession();
  const { data } = useNotifications(Boolean(session));
  const markRead = useMarkNotificationsRead();
  const groups = React.useMemo(
    () => groupNotifications(data?.notifications ?? []),
    [data?.notifications]
  );
  if (!session) return null;

  const unread = data?.unread ?? 0;
  const openGroup = (g: NotificationGroup) => {
    if (!g.read) markRead.mutate(g.ids);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
          className="relative"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-solid px-1 font-money text-[10px] font-bold text-accent-fg">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => markRead.mutate(undefined)}
              className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-accent"
            >
              <CheckCheck className="h-3.5 w-3.5" aria-hidden /> Mark all read
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-sm text-muted">
              <Inbox className="h-6 w-6" aria-hidden />
              Nothing yet — say hi
            </div>
          ) : (
            groups.map((g) => <NotificationGroupRow key={g.key} group={g} onOpen={openGroup} />)
          )}
        </div>
        <Link
          href="/community/notifications"
          className="block border-t px-3 py-2 text-center text-xs font-medium text-muted transition-colors hover:text-accent"
        >
          View all notifications
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
