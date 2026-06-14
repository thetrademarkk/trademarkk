"use client";

import * as React from "react";
import { Drawer as VaulDrawer } from "vaul";
import { cn } from "@/lib/utils";

/**
 * Mobile-first bottom sheet (vaul). On desktop the same content is typically
 * shown in a Dialog; forms render identically inside both.
 */
export const Sheet = VaulDrawer.Root;
export const SheetTrigger = VaulDrawer.Trigger;
export const SheetClose = VaulDrawer.Close;

export function SheetContent({
  className,
  children,
  title,
  hideTitle = false,
}: {
  className?: string;
  children: React.ReactNode;
  title: string;
  /** Keep the title for a11y but hide it visually (the body renders its own). */
  hideTitle?: boolean;
}) {
  return (
    <VaulDrawer.Portal>
      <VaulDrawer.Overlay className="fixed inset-0 z-50 bg-black/70" />
      <VaulDrawer.Content
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 mt-24 flex max-h-[92vh] flex-col rounded-t-2xl border bg-surface",
          className
        )}
      >
        <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-surface-2" />
        <VaulDrawer.Title
          className={cn("px-5 pt-3 text-base font-semibold", hideTitle && "sr-only")}
        >
          {title}
        </VaulDrawer.Title>
        <div className="overflow-y-auto p-5 pt-3 no-scrollbar">{children}</div>
      </VaulDrawer.Content>
    </VaulDrawer.Portal>
  );
}
