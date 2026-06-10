"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Cloud, Database, HardDrive, LogOut, Moon, Search } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

  const handleSignOut = async () => {
    if (mode === "hosted") await signOut();
    disconnect();
    router.replace("/");
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-bg/85 backdrop-blur px-4">
      <h1 className="text-sm font-semibold md:hidden">
        Trade<span className="text-accent">Mark</span>
      </h1>
      <h1 className="hidden md:block text-sm font-semibold">{title}</h1>

      <div className="ml-auto flex items-center gap-2">
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
              <DropdownMenuItem key={t.id} onClick={() => setTheme(t.id)}>
                <Moon className={t.id === theme ? "text-accent" : "opacity-40"} />
                {t.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
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
