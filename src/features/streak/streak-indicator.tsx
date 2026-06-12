"use client";

import Link from "next/link";
import { Flame, ShieldCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { STREAK_BADGES, nextBadge } from "@/lib/streak-badges";
import { ApiError, useMyProfile, useShareStreak } from "@/features/community/api";
import { useStreak, useToggleNoTradeDay } from "./queries";

/**
 * LeetCode-style header streak: flame + count; popover holds milestone badges,
 * rest-day logging, and the opt-in "show on leaderboard" toggle. Streaks are
 * journal data (private) — publishing them is always an explicit choice.
 */
export function StreakIndicator() {
  const { data } = useStreak();
  const toggle = useToggleNoTradeDay();
  const { data: session } = useSession();
  const { data: me } = useMyProfile(Boolean(session));
  const share = useShareStreak();
  if (!data) return null;

  const { current, best, todayLogged, noTradeToday, tradedToday } = data;
  const effectiveBest = Math.max(best, current);
  const next = nextBadge(effectiveBest);

  const mark = () =>
    toggle.mutate(true, {
      onSuccess: () => toast.success("Rest day logged — streak protected"),
      onError: () => toast.error("Could not log the rest day"),
    });

  const setShare = (on: boolean) =>
    share.mutate(
      { share: on, current, best: effectiveBest },
      {
        onSuccess: () =>
          toast.success(on ? "Streak visible on your profile & leaderboard" : "Streak hidden"),
        onError: (e) =>
          toast.error(
            e instanceof ApiError && e.status === 401
              ? "Sign in to the community first (open Community → sign in)"
              : "Could not update sharing"
          ),
      }
    );

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        // Keep the published number fresh whenever the popover opens.
        if (open && me?.shareStreak) share.mutate({ share: true, current, best: effectiveBest });
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Journaling streak: ${current} days${todayLogged ? ", today logged" : ", today pending"}`}
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-surface-2"
        >
          <Flame
            className={cn("h-4 w-4", todayLogged ? "fill-warning text-warning" : "text-muted")}
            aria-hidden
          />
          <span
            className={cn("font-money font-semibold", todayLogged ? "text-warning" : "text-muted")}
          >
            {current}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-3">
        <div className="flex items-center gap-2.5">
          <Flame
            className={cn("h-7 w-7", todayLogged ? "fill-warning text-warning" : "text-muted")}
            aria-hidden
          />
          <div>
            <p className="font-money text-lg font-bold leading-tight">{current}-day streak</p>
            <p className="text-xs text-muted">Best: {effectiveBest} days</p>
          </div>
        </div>

        {/* ── Milestone badges (earned from best streak, kept forever) ── */}
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {STREAK_BADGES.map((b) => {
            const earned = effectiveBest >= b.days;
            return (
              <div
                key={b.days}
                title={`${b.name} — ${b.days} days`}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border py-2",
                  earned ? b.bg : "opacity-35"
                )}
              >
                <b.icon className={cn("h-4 w-4", earned ? b.color : "text-muted")} aria-hidden />
                <span className="font-money text-[10px] text-muted">{b.days}d</span>
              </div>
            );
          })}
        </div>
        {next && (
          <p className="mt-1.5 text-center text-[11px] text-muted">
            {next.daysLeft} day{next.daysLeft === 1 ? "" : "s"} to{" "}
            <span className="font-medium text-foreground">{next.badge.name}</span>
          </p>
        )}

        <p className="mt-2.5 text-xs leading-5 text-muted">
          {todayLogged
            ? noTradeToday && !tradedToday
              ? "Rest day logged for today ✓"
              : "Today is logged ✓ See you tomorrow."
            : "Log a trade, write your journal, or mark a rest day to keep the flame alive."}
        </p>
        {!todayLogged && (
          <Button
            size="sm"
            variant="outline"
            className="mt-2.5 w-full"
            onClick={mark}
            disabled={toggle.isPending}
          >
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> No trades today
          </Button>
        )}
        {noTradeToday && !tradedToday && (
          <Button
            size="sm"
            variant="ghost"
            className="mt-2 w-full text-muted"
            onClick={() => toggle.mutate(false)}
            disabled={toggle.isPending}
          >
            <Undo2 className="h-3.5 w-3.5" aria-hidden /> Undo rest day
          </Button>
        )}

        {/* ── Opt-in publishing (privacy-first: off by default) ── */}
        <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
          <div className="min-w-0">
            <p className="text-xs font-medium">Show on leaderboard</p>
            <p className="text-[11px] text-muted">
              Publishes streak to your{" "}
              <Link href="/community/leaderboard" className="text-accent hover:underline">
                community profile
              </Link>
            </p>
          </div>
          <Switch
            checked={Boolean(me?.shareStreak)}
            onCheckedChange={setShare}
            disabled={share.isPending}
            aria-label="Share streak on leaderboard"
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
