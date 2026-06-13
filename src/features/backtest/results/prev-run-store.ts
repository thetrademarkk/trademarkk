/**
 * Holds the PREVIOUS run's headline snapshot for the "change one thing"
 * iteration loop. When a new run finishes, the results screen reads this to ghost
 * the prior run and show per-stat deltas, then promotes the new run to "previous"
 * for the next iteration.
 *
 * zustand + persist (already a dep; matches the builder-store idiom) keyed
 * `tmk.bt.prevrun` so the comparison survives a navigation between build and
 * results. Only the lightweight HeadlineStats snapshot is kept — never the full
 * blotter — so localStorage stays tiny.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PrevRunSnapshot } from "./stat-cards";

export const PREV_RUN_STORAGE_KEY = "tmk.bt.prevrun";

interface PrevRunState {
  prev: PrevRunSnapshot | null;
  /** Record a finished run as the new "previous" (for the NEXT comparison). */
  remember: (snap: PrevRunSnapshot) => void;
  clear: () => void;
}

export const usePrevRunStore = create<PrevRunState>()(
  persist(
    (set) => ({
      prev: null,
      remember: (snap) => set({ prev: snap }),
      clear: () => set({ prev: null }),
    }),
    { name: PREV_RUN_STORAGE_KEY }
  )
);
