"use client";

import * as React from "react";
import { toast } from "sonner";
import { useUiStore } from "@/stores/ui-store";
import { useDraftStore } from "@/stores/draft-store";
import { useIsDesktop } from "@/hooks/use-media-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TradeForm } from "./trade-form";

/**
 * Global quick-add. Two layers of data-loss protection:
 * 1. Every keystroke streams into a persisted draft (survives close + refresh).
 * 2. While the form is dirty, clicking outside does NOT dismiss the dialog —
 *    only Escape or the X button close it (and the draft is kept, with a toast).
 */
export function QuickAdd() {
  const { quickAddOpen, setQuickAddOpen } = useUiStore();
  const { tradeDraft, setTradeDraft, clearTradeDraft } = useDraftStore();
  const isDesktop = useIsDesktop();
  const dirtyRef = React.useRef(false);
  const savedRef = React.useRef(false);

  const handleOpenChange = (open: boolean) => {
    if (!open && dirtyRef.current && !savedRef.current) {
      toast.info("Draft saved — reopen Add trade to continue where you left off");
    }
    if (!open) savedRef.current = false;
    setQuickAddOpen(open);
  };

  const close = () => {
    savedRef.current = true; // saved successfully — no draft toast
    setQuickAddOpen(false);
  };

  const form = (
    <TradeForm
      defaults={tradeDraft ?? undefined}
      onSaved={close}
      onDirtyChange={(d) => (dirtyRef.current = d)}
      onDraftChange={setTradeDraft}
      onSavedClearDraft={clearTradeDraft}
    />
  );

  if (isDesktop) {
    return (
      <Dialog open={quickAddOpen} onOpenChange={handleOpenChange}>
        <DialogContent
          // Dirty form? Outside clicks are ignored — a misclick can't eat your entry.
          onInteractOutside={(e) => {
            if (dirtyRef.current) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add trade</DialogTitle>
          </DialogHeader>
          {form}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={quickAddOpen} onOpenChange={handleOpenChange}>
      <SheetContent title="Add trade">{form}</SheetContent>
    </Sheet>
  );
}
