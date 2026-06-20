"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, MoreHorizontal } from "lucide-react";
import { MOBILE_TABS, NAV_ITEMS } from "@/config/nav";
import { useUiStore } from "@/stores/ui-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BottomBarShell } from "@/components/layout/bottom-bar-shell";
import { cn } from "@/lib/utils";

/**
 * Mobile bottom tab bar. Five equal columns — two tabs, a centered slot for the
 * floating quick-add button, one tab, and a "More" menu — so the FAB sits dead
 * center. Tabs that don't fit live in the More menu.
 */
export function BottomNav() {
  const pathname = usePathname();
  const { setQuickAddOpen } = useUiStore();
  const leftTabs = MOBILE_TABS.slice(0, 2);
  const rightTab = MOBILE_TABS[2];
  const inBar = new Set<string>([...leftTabs, rightTab].filter(Boolean).map((t) => t!.href));
  const moreItems = NAV_ITEMS.filter((i) => !inBar.has(i.href));

  const Tab = ({ tab }: { tab: (typeof MOBILE_TABS)[number] }) => {
    const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
    return (
      <Link
        href={tab.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium",
          active ? "text-accent" : "text-muted"
        )}
      >
        <tab.icon className="h-5 w-5" aria-hidden />
        {tab.label}
      </Link>
    );
  };

  return (
    <BottomBarShell>
      {leftTabs.map((t) => (
        <Tab key={t.href} tab={t} />
      ))}

      {/* Center column reserved for the FAB. */}
      <div className="flex-1" aria-hidden />

      {rightTab && <Tab tab={rightTab} />}

      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-muted"
          aria-label="More pages"
        >
          <MoreHorizontal className="h-5 w-5" aria-hidden />
          More
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top">
          {moreItems.map((i) => (
            <DropdownMenuItem key={i.href} asChild>
              {i.newTab ? (
                <a href={i.href} target="_blank" rel="noopener">
                  <i.icon />
                  {i.label}
                </a>
              ) : (
                <Link href={i.href}>
                  <i.icon />
                  {i.label}
                </Link>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* FAB — absolutely centered over the whole bar. */}
      <button
        aria-label="Add trade"
        onClick={() => setQuickAddOpen(true)}
        className="absolute left-1/2 top-0 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent-solid text-accent-fg shadow-lg ring-4 ring-bg transition-transform active:scale-95"
      >
        <Plus className="h-6 w-6" aria-hidden />
      </button>
    </BottomBarShell>
  );
}
