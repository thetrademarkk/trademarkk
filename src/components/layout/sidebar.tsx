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
      <div className={cn("flex items-center gap-2 px-4 h-14 border-b", sidebarCollapsed && "justify-center px-0")}>
        <CandlestickChart className="h-5 w-5 text-accent shrink-0" />
        {!sidebarCollapsed && (
          <span className="font-semibold tracking-tight">
            Trade<span className="text-accent">Mark</span>
          </span>
        )}
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
          const active = pathname.startsWith(item.href);
          const link = (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-accent/12 text-accent font-medium"
                  : "text-muted hover:bg-surface-2 hover:text-foreground",
                sidebarCollapsed && "justify-center px-0"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!sidebarCollapsed && <span>{item.label}</span>}
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
        <Button variant="ghost" size="icon" className="w-full" onClick={toggleSidebar}>
          {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </Button>
      </div>
    </aside>
  );
}
