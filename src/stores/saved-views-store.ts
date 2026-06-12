import { create } from "zustand";
import { persist } from "zustand/middleware";
import { newId } from "@/lib/id";
import {
  hasActiveFilters,
  sanitizeFilters,
  type AdvancedTradeFilters,
} from "@/features/trades/filter-predicate";

export interface SavedView {
  id: string;
  name: string;
  filters: AdvancedTradeFilters;
  createdAt: string;
}

interface SavedViewsState {
  views: SavedView[];
  /** Upserts by case-insensitive name; ignores empty names / empty filter sets. */
  saveView: (name: string, filters: AdvancedTradeFilters) => void;
  deleteView: (id: string) => void;
}

const MAX_VIEWS = 30;
const MAX_NAME = 40;

// Persisted like tm.filters: named filter sets survive reloads on this device.
// Filters are sanitized on save AND on apply (localStorage is user-editable).
export const useSavedViewsStore = create<SavedViewsState>()(
  persist(
    (set) => ({
      views: [],
      saveView: (name, filters) =>
        set((s) => {
          const trimmed = name.trim().slice(0, MAX_NAME);
          const clean = sanitizeFilters(filters);
          if (!trimmed || !hasActiveFilters(clean)) return s;
          const existing = s.views.find((v) => v.name.toLowerCase() === trimmed.toLowerCase());
          if (existing) {
            return {
              views: s.views.map((v) => (v.id === existing.id ? { ...v, filters: clean } : v)),
            };
          }
          const view: SavedView = {
            id: newId(),
            name: trimmed,
            filters: clean,
            createdAt: new Date().toISOString(),
          };
          return { views: [view, ...s.views].slice(0, MAX_VIEWS) };
        }),
      deleteView: (id) => set((s) => ({ views: s.views.filter((v) => v.id !== id) })),
    }),
    { name: "tm.saved-views" }
  )
);
