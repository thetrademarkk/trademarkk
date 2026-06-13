"use client";

import * as React from "react";
import { toast } from "sonner";
import { useUiStore } from "@/stores/ui-store";
import { useDraftStore } from "@/stores/draft-store";
import { useIsDesktop } from "@/hooks/use-media-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TradeForm } from "./trade-form";
import { useTraderProfile } from "@/features/onboarding/queries";
import { traderTypeDefaults } from "@/features/onboarding/trader-profile";
import type { TradeFormValues } from "../schemas";

/**
 * Global quick-add. Two layers of data-loss protection:
 * 1. Every keystroke streams into a persisted draft (survives close + refresh).
 * 2. While the form is dirty, clicking outside does NOT dismiss the dialog —
 *    only Escape or the X button close it (and the draft is kept, with a toast).
 */
export function QuickAdd() {
  const { quickAddOpen, setQuickAddOpen } = useUiStore();
  const { tradeDraft, setTradeDraft, clearTradeDraft } = useDraftStore();
  const { data: traderProfile } = useTraderProfile();
  const isDesktop = useIsDesktop();
  const dirtyRef = React.useRef(false);
  const savedRef = React.useRef(false);

  // SEG-08 — a blank new-trade form opens with the user's trader-type default
  // segment + product (e.g. swing → EQ+CNC, F&O → OPT+NRML). It's passed as
  // `defaults` so it's part of the form's initial render (the controlled segment
  // select reflects it with no post-mount mutation). A restored draft takes
  // precedence — the user was mid-entry — and `mixed` adds nothing (the form's
  // own EQ+MIS default already covers it).
  const traderDefaults = React.useMemo((): Partial<TradeFormValues> | undefined => {
    if (tradeDraft) return tradeDraft;
    if (!traderProfile || traderProfile.traderType === "mixed") return undefined;
    const d = traderTypeDefaults(traderProfile.traderType);
    return { segment: d.segment, product: d.product };
  }, [tradeDraft, traderProfile]);

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
      // Remount only when the SEG-08 default segment changes (e.g. the trader
      // profile resolves from cache on cold load) — NOT on draft keystrokes, so
      // in-progress input is never lost.
      key={tradeDraft ? "draft" : (traderDefaults?.segment ?? "blank")}
      defaults={traderDefaults}
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
