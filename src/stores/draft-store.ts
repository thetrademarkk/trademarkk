import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TradeFormValues } from "@/features/trades/schemas";

interface DraftState {
  /** Unsaved quick-add trade — survives accidental closes AND page refreshes. */
  tradeDraft: Partial<TradeFormValues> | null;
  setTradeDraft: (draft: Partial<TradeFormValues>) => void;
  clearTradeDraft: () => void;
}

export const useDraftStore = create<DraftState>()(
  persist(
    (set) => ({
      tradeDraft: null,
      setTradeDraft: (tradeDraft) => set({ tradeDraft }),
      clearTradeDraft: () => set({ tradeDraft: null }),
    }),
    { name: "tm.trade-draft" }
  )
);
