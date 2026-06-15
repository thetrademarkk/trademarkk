"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  CandlestickChart,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  User,
} from "lucide-react";
import { NAV_SECTIONS, type NavItem } from "@/config/nav";
import { useUiStore } from "@/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebar, setQuickAddOpen } = useUiStore();

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh flex-col border-r bg-surface transition-[width] duration-200 md:flex",
        sidebarCollapsed ? "w-16" : "w-60"
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          "flex h-14 items-center gap-2.5 border-b px-4",
          sidebarCollapsed && "justify-center px-0"
        )}
      >
        <Link
          href="/app/dashboard"
          aria-label="TradeMarkk dashboard"
          className="flex items-center gap-2.5"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
            <CandlestickChart className="size-[18px]" aria-hidden />
          </span>
          {!sidebarCollapsed && (
            <span className="text-[17px] font-bold leading-none tracking-tight">
              Trade<span className="text-accent">Markk</span>
            </span>
          )}
        </Link>
      </div>

      {/* Primary action */}
      <div className="p-3">
        <Button
          className={cn("w-full", sidebarCollapsed && "px-0")}
          size={sidebarCollapsed ? "icon" : "default"}
          onClick={() => setQuickAddOpen(true)}
        >
          <Plus />
          {!sidebarCollapsed && <span>Add trade</span>}
        </Button>
      </div>

      {/* Sectioned nav */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-1">
            {!sidebarCollapsed && (
              <div className="px-3 pb-1.5 pt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-muted/80">
                {section.label}
              </div>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  collapsed={sidebarCollapsed}
                  active={!item.newTab && pathname.startsWith(item.href)}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Account footer + collapse */}
      <div
        className={cn(
          "flex items-center gap-1.5 border-t p-3",
          sidebarCollapsed && "flex-col gap-2"
        )}
      >
        {!sidebarCollapsed && (
          <Link
            href="/app/settings"
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-1 transition-colors hover:bg-surface-2"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
              <User className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 truncate text-[12.5px] font-bold leading-tight">
              My account
            </span>
          </Link>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn(!sidebarCollapsed && "shrink-0")}
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!sidebarCollapsed}
        >
          {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </Button>
      </div>
    </aside>
  );
}

/** A single nav row — active state gets the accent-soft fill + left accent bar. */
function NavLink({
  item,
  active,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}) {
  const className = cn(
    "group relative flex h-9 items-center gap-3 rounded-xl px-3 text-[13.5px] transition-colors",
    active
      ? "bg-accent/12 font-medium text-accent"
      : "text-muted hover:bg-surface-2 hover:text-foreground",
    collapsed && "justify-center px-0"
  );
  const inner = (
    <>
      {/* Active left accent bar — sits flush with the nav's outer edge. */}
      {active && !collapsed && (
        <span
          className="absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-accent"
          aria-hidden
        />
      )}
      <item.icon className="size-[18px] shrink-0" aria-hidden />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && item.newTab && (
        <ArrowUpRight className="ml-auto size-3.5 shrink-0 opacity-50" aria-hidden />
      )}
    </>
  );

  // Community / Backtesting are their own surfaces — open in a new tab.
  const link = item.newTab ? (
    <a href={item.href} target="_blank" rel="noopener" className={className}>
      {inner}
    </a>
  ) : (
    <Link href={item.href} className={className}>
      {inner}
    </Link>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}
