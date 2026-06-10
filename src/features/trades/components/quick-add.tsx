"use client";

import { useUiStore } from "@/stores/ui-store";
import { useIsDesktop } from "@/hooks/use-media-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TradeForm } from "./trade-form";

/** Global quick-add: Dialog on desktop, bottom sheet on mobile. Opens via FAB / `T`. */
export function QuickAdd() {
  const { quickAddOpen, setQuickAddOpen } = useUiStore();
  const isDesktop = useIsDesktop();
  const close = () => setQuickAddOpen(false);

  if (isDesktop) {
    return (
      <Dialog open={quickAddOpen} onOpenChange={setQuickAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add trade</DialogTitle>
          </DialogHeader>
          <TradeForm quick onSaved={close} />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={quickAddOpen} onOpenChange={setQuickAddOpen}>
      <SheetContent title="Add trade">
        <TradeForm quick onSaved={close} />
      </SheetContent>
    </Sheet>
  );
}
