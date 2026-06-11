"use client";

import { Flame, ShieldCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useStreak, useToggleNoTradeDay } from "./queries";

/**
 * LeetCode-style header streak: flame + count in the topbar; the flame lights
 * up once today is logged. Popover holds details and one-tap rest-day logging
 * ("no trades today" counts — discipline is activity).
 */
export function StreakIndicator() {
  const { data } = useStreak();
  const toggle = useToggleNoTradeDay();
  if (!data) return null;

  const { current, best, todayLogged, noTradeToday, tradedToday } = data;

  const mark = () =>
    toggle.mutate(true, {
      onSuccess: () => toast.success("Rest day logged — streak protected"),
      onError: () => toast.error("Could not log the rest day"),
    });

  return (
    <DropdownMenu>
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
      <DropdownMenuContent align="end" className="w-64 p-3">
        <div className="flex items-center gap-2.5">
          <Flame
            className={cn("h-7 w-7", todayLogged ? "fill-warning text-warning" : "text-muted")}
            aria-hidden
          />
          <div>
            <p className="font-money text-lg font-bold leading-tight">{current}-day streak</p>
            <p className="text-xs text-muted">Best: {Math.max(best, current)} days</p>
          </div>
        </div>
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
