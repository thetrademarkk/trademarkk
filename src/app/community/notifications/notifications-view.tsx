"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Bell, CheckCheck, Inbox, Settings2 } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SignInGate } from "@/features/community";
import { useMarkNotificationsRead, useNotifications } from "@/features/community/api";
import { groupNotifications, type NotificationGroup } from "@/features/community/notifications";
import { NotificationGroupRow } from "@/features/community/components/notification-row";
import { NotificationPreferences } from "@/features/community/components/notification-preferences";
import { MutedWords } from "@/features/community/components/muted-words";

/** Full notification history (grouped) — everything the bell shows and more. */
export function NotificationsPageClient() {
  const { data: session, isPending } = useSession();
  const [gateOpen, setGateOpen] = React.useState(false);
  const [showPrefs, setShowPrefs] = React.useState(false);
  const { data, isLoading } = useNotifications(Boolean(session), 100);
  const markRead = useMarkNotificationsRead();

  const groups = React.useMemo(
    () => groupNotifications(data?.notifications ?? []),
    [data?.notifications]
  );
  const fresh = groups.filter((g) => !g.read);
  const earlier = groups.filter((g) => g.read);
  const unread = data?.unread ?? 0;

  if (isPending) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6">
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 text-center">
        <Bell className="mx-auto h-8 w-8 text-muted" aria-hidden />
        <h1 className="mt-3 text-lg font-bold">Notifications</h1>
        <p className="mt-1 text-sm text-muted">
          Sign in to see who liked, commented and followed you.
        </p>
        <Button className="mt-4" onClick={() => setGateOpen(true)}>
          Sign in
        </Button>
        <SignInGate open={gateOpen} onOpenChange={setGateOpen} />
      </div>
    );
  }

  const openGroup = (g: NotificationGroup) => {
    if (!g.read) markRead.mutate(g.ids);
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <Link
        href="/community"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted hover:text-accent"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to community
      </Link>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Bell className="h-5 w-5 text-accent" aria-hidden /> Notifications
        </h1>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <Button variant="outline" size="sm" onClick={() => markRead.mutate(undefined)}>
              <CheckCheck className="h-3.5 w-3.5" aria-hidden /> Mark all read
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={showPrefs}
            aria-label="Notification preferences"
            onClick={() => setShowPrefs((v) => !v)}
          >
            <Settings2 className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Preferences</span>
          </Button>
        </div>
      </div>

      {showPrefs && (
        <div className="mb-4 space-y-4">
          <NotificationPreferences />
          <MutedWords />
        </div>
      )}

      <div className="overflow-hidden rounded-xl border bg-surface">
        {isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-16 text-center text-sm text-muted">
            <Inbox className="h-7 w-7" aria-hidden />
            Nothing yet — join a discussion and the bell starts ringing.
          </div>
        ) : (
          <>
            {fresh.length > 0 && (
              <section aria-label="New notifications">
                <h2 className="border-b px-3 py-2 text-xs font-semibold text-muted">New</h2>
                {fresh.map((g) => (
                  <NotificationGroupRow key={g.key} group={g} onOpen={openGroup} />
                ))}
              </section>
            )}
            {earlier.length > 0 && (
              <section aria-label="Earlier notifications">
                <h2
                  className={cn(
                    "border-b px-3 py-2 text-xs font-semibold text-muted",
                    fresh.length > 0 && "border-t"
                  )}
                >
                  Earlier
                </h2>
                {earlier.map((g) => (
                  <NotificationGroupRow key={g.key} group={g} onOpen={openGroup} />
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
