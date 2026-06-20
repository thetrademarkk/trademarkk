"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Trophy, Flame, MessageCircle, Bell } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { useConversations, useNotifications } from "@/features/community/api";
import { BottomBarShell } from "@/components/layout/bottom-bar-shell";
import { cn } from "@/lib/utils";

/**
 * Mobile bottom tab bar for the community surface — the journal's bottom-nav
 * pattern (via {@link BottomBarShell}) extended to a public, content-discovery
 * surface. Five real destinations: Feed, Ranks, Trending, Chat, Alerts. There
 * is no centered "create" FAB because composing happens inline at the top of
 * the feed (tapping Feed lands there), so all five columns stay useful.
 *
 * Chat/Alerts carry the same unread badges the desktop NotificationsBell and
 * MessagesFab show, sourced from the same hooks.
 */
export function CommunityBottomNav() {
  const pathname = usePathname();
  const signedIn = Boolean(useSession().data);
  const { data: convos } = useConversations(signedIn, 30_000);
  const { data: notifs } = useNotifications(signedIn);

  const items = [
    { href: "/community", label: "Feed", icon: Home, exact: true, badge: 0 },
    { href: "/community/leaderboard", label: "Ranks", icon: Trophy, exact: false, badge: 0 },
    { href: "/community/trending", label: "Trending", icon: Flame, exact: false, badge: 0 },
    {
      href: "/community/messages",
      label: "Chat",
      icon: MessageCircle,
      exact: false,
      badge: signedIn ? (convos?.unread ?? 0) : 0,
    },
    {
      href: "/community/notifications",
      label: "Alerts",
      icon: Bell,
      exact: false,
      badge: signedIn ? (notifs?.unread ?? 0) : 0,
    },
  ] as const;

  return (
    <BottomBarShell label="Community">
      {items.map((it) => {
        const active = it.exact
          ? pathname === it.href
          : pathname === it.href || pathname.startsWith(it.href + "/");
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium",
              active ? "text-accent" : "text-muted"
            )}
          >
            <span className="relative">
              <it.icon className="h-5 w-5" aria-hidden />
              {it.badge > 0 && (
                <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-solid px-1 font-money text-[9px] font-bold text-accent-fg ring-2 ring-bg">
                  {it.badge > 9 ? "9+" : it.badge}
                </span>
              )}
            </span>
            {it.label}
          </Link>
        );
      })}
    </BottomBarShell>
  );
}
