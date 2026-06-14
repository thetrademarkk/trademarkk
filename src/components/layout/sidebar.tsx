"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CandlestickChart, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { NAV_ITEMS } from "@/config/nav";
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
        "hidden md:flex h-dvh sticky top-0 flex-col border-r bg-surface transition-[width] duration-200",
        sidebarCollapsed ? "w-16" : "w-60"
      )}
    >
      <div
        className={cn(
          "flex items-center px-4 h-14 border-b",
          sidebarCollapsed && "justify-center px-0"
        )}
      >
        <Link
          href="/app/dashboard"
          aria-label="TradeMarkk dashboard"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <CandlestickChart className="h-5 w-5 text-accent shrink-0" aria-hidden />
          {!sidebarCollapsed && (
            <span>
              Trade<span className="text-accent">Mark</span>
            </span>
          )}
        </Link>
      </div>

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

      <nav className="flex-1 space-y-0.5 px-3 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const active = !item.newTab && pathname.startsWith(item.href);
          const className = cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
            active
              ? "bg-accent/12 text-accent font-medium"
              : "text-muted hover:bg-surface-2 hover:text-foreground",
            sidebarCollapsed && "justify-center px-0"
          );
          const inner = (
            <>
              <item.icon className="h-4 w-4 shrink-0" aria-hidden />
              {!sidebarCollapsed && <span>{item.label}</span>}
            </>
          );
          // Community is its own surface — open it in a new tab, keep the journal where it is.
          const link = item.newTab ? (
            <a
              key={item.href}
              href={item.href}
              target="_blank"
              rel="noopener"
              className={className}
            >
              {inner}
            </a>
          ) : (
            <Link key={item.href} href={item.href} className={className}>
              {inner}
            </Link>
          );
          return sidebarCollapsed ? (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          ) : (
            link
          );
        })}
      </nav>

      <div className="border-t p-3">
        <Button
          variant="ghost"
          size="icon"
          className="w-full"
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
