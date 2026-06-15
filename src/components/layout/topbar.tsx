"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useQuery } from "@tanstack/react-query";
import {
  Cloud,
  Database,
  HardDrive,
  LogOut,
  MessageSquareText,
  Moon,
  Search,
  ShieldCheck,
  Target,
  UserCog,
} from "lucide-react";
import { FeedbackDialog } from "@/components/shared/feedback-dialog";
import { StreakIndicator } from "@/features/streak";
import { useFilterStore, PERIOD_LABELS, type PeriodPreset } from "@/stores/filter-store";
import { useUiStore } from "@/stores/ui-store";
import { useDbSession } from "@/providers/db-session-provider";
import { THEMES } from "@/providers/theme-provider";
import { signOut } from "@/lib/auth-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { withThemeTransition } from "@/lib/theme-transition";
import { cn } from "@/lib/utils";

const MODE_META = {
  hosted: { icon: Cloud, label: "Hosted" },
  byod: { icon: Database, label: "Your DB" },
  local: { icon: HardDrive, label: "Local" },
} as const;

/** Compact labels for the segmented period control (desktop topbar). */
const PERIOD_SHORT: Record<PeriodPreset, string> = {
  "7d": "1W",
  "30d": "1M",
  "90d": "3M",
  ytd: "YTD",
  all: "All",
};

export function Topbar() {
  const router = useRouter();
  const { period, setPeriod } = useFilterStore();
  const { setCommandOpen } = useUiStore();
  const { state, disconnect } = useDbSession();
  const { setTheme, theme } = useTheme();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const mode = state.status === "ready" ? state.mode : null;
  const ModeIcon = mode ? MODE_META[mode].icon : Database;

  // Surfaces the admin link for ADMIN_EMAILS accounts. Only hosted users can
  // have a session, so skip the request entirely in byod/local/demo modes —
  // an unconditional fetch would 401 (console noise) on every page.
  const { data: status } = useQuery({
    queryKey: ["db-status"],
    enabled: mode === "hosted",
    queryFn: async () => {
      const res = await fetch("/api/db/status");
      if (!res.ok) return null;
      return (await res.json()) as { isAdmin?: boolean };
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const handleSignOut = async () => {
    if (mode === "hosted") await signOut();
    disconnect();
    router.replace("/");
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-bg/85 backdrop-blur px-4">
      <Link
        href="/app/dashboard"
        className="text-sm font-semibold md:hidden"
        aria-label="TradeMarkk dashboard"
      >
        Trade<span className="text-accent">Markk</span>
      </Link>

      <div className="ml-auto flex items-center gap-2">
        <StreakIndicator />
        <Button
          variant="ghost"
          size="sm"
          asChild
          aria-label="Weekly goals"
          title="Weekly goals"
          className="gap-1.5 text-muted"
        >
          <Link href="/app/settings#goals">
            <Target className="h-4 w-4" />
            <span className="hidden text-xs md:inline">Goals</span>
          </Link>
        </Button>
        {/* Search box (desktop) — opens the command palette. */}
        <button
          onClick={() => setCommandOpen(true)}
          aria-label="Search or jump to"
          className="hidden h-9 w-[230px] items-center gap-2 rounded-lg border bg-surface px-3 text-sm text-muted transition-colors hover:border-foreground/25 hover:text-foreground md:flex lg:w-[280px]"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">Search or jump to…</span>
          <kbd className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium">⌘K</kbd>
        </button>

        {/* Period — segmented control on desktop, compact dropdown on mobile. */}
        <div className="hidden items-center gap-0.5 rounded-lg border bg-surface p-0.5 md:flex">
          {(Object.keys(PERIOD_SHORT) as PeriodPreset[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              title={PERIOD_LABELS[p]}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
                period === p
                  ? "bg-surface-2 text-foreground shadow-sm"
                  : "text-muted hover:text-foreground"
              )}
            >
              {PERIOD_SHORT[p]}
            </button>
          ))}
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as PeriodPreset)}>
          <SelectTrigger className="h-8 w-[100px] text-xs md:hidden">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PERIOD_LABELS) as PeriodPreset[]).map((p) => (
              <SelectItem key={p} value={p} className="text-xs">
                {PERIOD_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Storage and theme settings">
              <ModeIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {mode && (
              <>
                <DropdownMenuLabel className="flex items-center gap-2">
                  Storage:
                  <Badge variant="secondary">{MODE_META[mode].label}</Badge>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuLabel>Theme</DropdownMenuLabel>
            {THEMES.map((t) => (
              <DropdownMenuItem
                key={t.id}
                onClick={() => withThemeTransition(() => setTheme(t.id))}
              >
                <Moon className={t.id === theme ? "text-accent" : "opacity-40"} />
                {t.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setFeedbackOpen(true);
              }}
            >
              <MessageSquareText />
              Send feedback
            </DropdownMenuItem>
            {mode === "hosted" && (
              <DropdownMenuItem asChild>
                <Link href="/app/settings/account">
                  <UserCog />
                  Account &amp; security
                </Link>
              </DropdownMenuItem>
            )}
            {status?.isAdmin && (
              <DropdownMenuItem asChild>
                <Link href="/admin">
                  <ShieldCheck />
                  Admin panel
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut />
              {mode === "hosted" ? "Sign out" : "Disconnect"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      </div>
    </header>
  );
}
