"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

/**
 * Tab visual variants:
 * - "pill" (default) — the segmented control on a surface-2 track. The right
 *   idiom for in-page filters and sub-section switchers.
 * - "underline" — a Groww-style top-tab strip: no track, a full-width baseline
 *   rule, and a 2px violet underline under the active tab. Scrolls horizontally
 *   when it overflows on mobile. Reserve for PRIMARY page-level navigation.
 *
 * The list publishes its variant through context so triggers inherit it with no
 * extra props. Default stays "pill", so every existing call site is unchanged.
 */
type TabsVariant = "pill" | "underline";
const TabsVariantContext = React.createContext<TabsVariant>("pill");

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { variant?: TabsVariant }
>(({ className, variant = "pill", ...props }, ref) => (
  <TabsVariantContext.Provider value={variant}>
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        variant === "underline"
          ? // Full-width strip: baseline rule + horizontal scroll on mobile,
            // shrinks to content width from sm up. items-stretch so each trigger
            // spans the full height and its underline sits flush on the baseline.
            "inline-flex h-9 w-full items-stretch justify-start gap-1 overflow-x-auto rounded-none border-b border-border bg-transparent p-0 text-muted no-scrollbar sm:w-auto"
          : "inline-flex h-9 items-center justify-center rounded-lg bg-surface-2 p-1 text-muted",
        className
      )}
      {...props}
    />
  </TabsVariantContext.Provider>
));
TabsList.displayName = "TabsList";

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & { variant?: TabsVariant }
>(({ className, variant, ...props }, ref) => {
  const ctx = React.useContext(TabsVariantContext);
  const v = variant ?? ctx;
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-all focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        v === "underline"
          ? // The active underline is drawn as a 2px inset box-shadow at the
            // trigger's bottom (sits on the baseline). Using box-shadow — not a
            // border — sidesteps the global `* { border-color }` rule, so the
            // violet --accent renders reliably across all four themes. The
            // focus ring (also a box-shadow) composes with it.
            "rounded-sm bg-transparent px-3 text-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-[inset_0_-2px_0_0_var(--accent)]"
          : "rounded-md px-3 py-1 data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:shadow",
        className
      )}
      {...props}
    />
  );
});
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("mt-3 focus-visible:outline-none", className)}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
