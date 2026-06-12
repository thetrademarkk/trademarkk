import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toDateKey } from "@/lib/utils";

export type PeriodPreset = "7d" | "30d" | "90d" | "ytd" | "all";

interface FilterState {
  period: PeriodPreset;
  setPeriod: (p: PeriodPreset) => void;
}

// Persisted: users land on the same timeline they last chose.
// (Theme persistence is handled by next-themes in localStorage.)
export const useFilterStore = create<FilterState>()(
  persist(
    (set) => ({
      period: "all",
      setPeriod: (period) => set({ period }),
    }),
    { name: "tm.filters" }
  )
);

/** Resolves a preset to an inclusive [from, to] date-key range (null = unbounded). */
export function periodToRange(period: PeriodPreset): { from: string | null; to: string | null } {
  const today = new Date();
  const to = toDateKey(today);
  if (period === "all") return { from: null, to: null };
  if (period === "ytd") return { from: `${today.getFullYear()}-01-01`, to };
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  const from = new Date(today);
  from.setDate(from.getDate() - days);
  return { from: toDateKey(from), to };
}

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  ytd: "YTD",
  all: "All time",
};
