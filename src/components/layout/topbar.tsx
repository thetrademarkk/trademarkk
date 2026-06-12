"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
} from "lucide-react";
import { FeedbackDialog } from "@/components/shared/feedback-dialog";
import { StreakIndicator } from "@/features/streak";
import { NAV_ITEMS } from "@/config/nav";
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

const MODE_META = {
  hosted: { icon: Cloud, label: "Hosted" },
  byod: { icon: Database, label: "Your DB" },
  local: { icon: HardDrive, label: "Local" },
} as const;

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { period, setPeriod } = useFilterStore();
  const { setCommandOpen } = useUiStore();
  const { state, disconnect } = useDbSession();
  const { setTheme, theme } = useTheme();

  const title = NAV_ITEMS.find((i) => pathname.startsWith(i.href))?.label ?? "TradeMark";
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
        aria-label="TradeMark dashboard"
      >
        Trade<span className="text-accent">Mark</span>
      </Link>
      <h1 className="hidden md:block text-sm font-semibold">{title}</h1>

      <div className="ml-auto flex items-center gap-2">
        <StreakIndicator />
        <FeedbackDialog
          trigger={
            <Button
              variant="ghost"
              size="sm"
              aria-label="Send feedback"
              title="Send feedback"
              className="gap-1.5 text-muted"
            >
              <MessageSquareText className="h-4 w-4" />
              <span className="hidden text-xs md:inline">Feedback</span>
            </Button>
          }
        />
        <Button
          variant="outline"
          size="sm"
          className="hidden md:inline-flex text-muted gap-2"
          onClick={() => setCommandOpen(true)}
        >
          <Search className="h-3.5 w-3.5" />
          <span className="text-xs">Search</span>
          <kbd className="rounded bg-surface-2 px-1.5 text-[10px]">⌘K</kbd>
        </Button>

        <Select value={period} onValueChange={(v) => setPeriod(v as PeriodPreset)}>
          <SelectTrigger className="w-[110px] h-8 text-xs">
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
            <Button variant="ghost" size="icon">
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
      </div>
    </header>
  );
}
