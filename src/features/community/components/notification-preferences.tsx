"use client";

import * as React from "react";
import {
  AtSign,
  Bell,
  Heart,
  MessageCircle,
  Reply,
  Repeat2,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotificationPrefs, useUpdateNotificationPref } from "../api";

/** lucide icon per notification type (no emoji). Unknown types fall back to Bell. */
const TYPE_ICONS: Record<string, LucideIcon> = {
  reply: Reply,
  comment: MessageCircle,
  like: Heart,
  reshare: Repeat2,
  mention: AtSign,
  follow: UserPlus,
};

/**
 * Per-type notification toggles. A clean list of switch rows — icon, label and a
 * one-line description — with optimistic save (the switch flips instantly and
 * persists via PUT /api/community/notification-prefs). Default is everything ON;
 * turning a type off stops that kind of notification from being created at all.
 */
export function NotificationPreferences() {
  const { data, isLoading, isError } = useNotificationPrefs(true);
  const update = useUpdateNotificationPref();

  const onToggle = (type: string, enabled: boolean) =>
    update.mutate(
      { type, enabled },
      {
        // The optimistic switch rolls back on failure; tell the user so the flip
        // back isn't silent.
        onError: () => toast.error("Couldn't save that preference — try again."),
      }
    );

  return (
    <section
      aria-label="Notification preferences"
      className="overflow-hidden rounded-xl border bg-surface"
    >
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <Bell className="h-4 w-4 text-accent" aria-hidden />
        <div>
          <h2 className="text-sm font-semibold">Notification preferences</h2>
          <p className="text-xs text-muted">Choose which activity pings your bell.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2 p-3">
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
        </div>
      ) : isError ? (
        <p className="px-3 py-6 text-center text-sm text-muted">
          Couldn&apos;t load your preferences. Refresh to try again.
        </p>
      ) : (
        <ul className="divide-y">
          {(data?.toggles ?? []).map((t) => {
            const Icon = TYPE_ICONS[t.type] ?? Bell;
            const id = `notif-pref-${t.type}`;
            return (
              <li key={t.type} className="flex items-center gap-3 px-3 py-3">
                <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <label htmlFor={id} className="block text-sm font-medium">
                    {t.label}
                  </label>
                  <p className="text-xs text-muted">{t.description}</p>
                </div>
                <Switch
                  id={id}
                  checked={t.enabled}
                  aria-label={`${t.label} notifications`}
                  data-notif-pref={t.type}
                  data-enabled={t.enabled}
                  onCheckedChange={(enabled) => onToggle(t.type, enabled)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
