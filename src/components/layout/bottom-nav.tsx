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
import { cn } from "@/lib/utils";

/** Mobile bottom tab bar with a center floating quick-add button. */
export function BottomNav() {
  const pathname = usePathname();
  const { setQuickAddOpen } = useUiStore();
  const firstTwo = MOBILE_TABS.slice(0, 2);
  const lastTwo = MOBILE_TABS.slice(2);
  const moreItems = NAV_ITEMS.filter((i) => !MOBILE_TABS.some((t) => t.href === i.href));

  const Tab = ({ tab }: { tab: (typeof MOBILE_TABS)[number] }) => {
    const active = pathname.startsWith(tab.href);
    return (
      <Link
        href={tab.href}
        className={cn(
          "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium",
          active ? "text-accent" : "text-muted"
        )}
      >
        <tab.icon className="h-5 w-5" />
        {tab.label}
      </Link>
    );
  };

  return (
    <nav
      className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t bg-surface/95 backdrop-blur flex items-stretch"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {firstTwo.map((t) => (
        <Tab key={t.href} tab={t} />
      ))}
      <div className="relative flex-1 flex justify-center">
        <button
          aria-label="Add trade"
          onClick={() => setQuickAddOpen(true)}
          className="absolute -top-5 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg active:scale-95 transition-transform"
        >
          <Plus className="h-6 w-6" />
        </button>
      </div>
      {lastTwo.map((t) => (
        <Tab key={t.href} tab={t} />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-muted">
          <MoreHorizontal className="h-5 w-5" />
          More
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top">
          {moreItems.map((i) => (
            <DropdownMenuItem key={i.href} asChild>
              <Link href={i.href}>
                <i.icon />
                {i.label}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
