"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useConversations } from "../api";

/**
 * Floating chat dock (LinkedIn/Messenger pattern): bottom-right FAB with the
 * unread badge, on every community page except the messages page itself.
 * On the mobile feed the compose FAB owns bottom-right, so chat stacks above it.
 */
export function MessagesFab() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { data } = useConversations(Boolean(session), 30_000);
  if (!session) return null;
  if (pathname.startsWith("/community/messages")) return null;

  const unread = data?.unread ?? 0;
  const onFeed = pathname === "/community"; // compose FAB lives there on mobile

  return (
    <Link
      href="/community/messages"
      aria-label={`Messages${unread ? ` (${unread} unread)` : ""}`}
      className={cn(
        "fixed right-5 z-40 flex h-13 w-13 items-center justify-center rounded-full border bg-surface p-3.5 shadow-lg transition-transform hover:-translate-y-0.5 active:scale-95",
        onFeed ? "bottom-20 lg:bottom-6" : "bottom-5 lg:bottom-6"
      )}
    >
      <MessageCircle className="h-5 w-5 text-accent" aria-hidden />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-solid px-1 font-money text-[10px] font-bold text-accent-fg ring-2 ring-bg">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
