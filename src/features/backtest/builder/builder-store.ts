/**
 * The no-code builder store (BT-06) — zustand + persist. Holds the StrategyDef
 * draft (the single source of truth) plus a tiny UI slice (current step), and
 * AUTOSAVES the whole thing to localStorage `tmk.bt.draft.nocode`. Every step is
 * deep-linkable / back-navigable WITHOUT losing state because the entire wizard
 * reads/writes this one store.
 *
 * All mutations delegate to the pure helpers in draft.ts so the logic stays
 * unit-testable without React. zustand is ALREADY a dependency (src/stores/*),
 * so this adds no new dep and matches the codebase's persist idiom (draft-store).
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { IndexSymbol } from "../shared/instruments";
import type {
  LegDef,
  MarketConfig,
  OverallRisk,
  StrategyDef,
  TimingConfig,
} from "../shared/strategy-def";
import type { WizardStep } from "./types";
import {
  addLeg,
  applyTemplate,
  duplicateLeg,
  makeInitialDraft,
  removeLeg,
  restoreDraft,
  setIndex,
  updateLeg,
} from "./draft";

/** localStorage key for the no-code wizard draft (matches tmk.bt.draft.<mode>). */
export const DRAFT_STORAGE_KEY = "tmk.bt.draft.nocode";

interface BuilderState {
  draft: StrategyDef;
  step: WizardStep;
  /** Bumps on every persisted change so the "Saved" tick can pulse. */
  savedAt: number;

  // ── navigation ──
  setStep: (step: WizardStep) => void;

  // ── setup ──
  setIndexSymbol: (symbol: IndexSymbol) => void;
  setMarket: (patch: Partial<MarketConfig>) => void;
  setDateRange: (range: { start: string; end: string }) => void;

  // ── legs ──
  addLeg: () => void;
  duplicateLeg: (legId: string) => void;
  removeLeg: (legId: string) => void;
  updateLeg: (legId: string, patch: Partial<LegDef>) => void;
  applyTemplate: (templateId: string) => void;

  // ── timing / risk ──
  setTiming: (patch: Partial<TimingConfig>) => void;
  setRisk: (patch: Partial<OverallRisk>) => void;

  // ── lifecycle ──
  setName: (name: string) => void;
  reset: () => void;
  /** Replace the whole draft (e.g. from a ?template= deep link). */
  loadDraft: (draft: StrategyDef) => void;
}

/** Stamp updatedAt + bump savedAt whenever the draft mutates. */
function touch(draft: StrategyDef): StrategyDef {
  return {
    ...draft,
    meta: draft.meta
      ? { ...draft.meta, updatedAt: new Date().toISOString() }
      : {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          builderMode: "wizard",
        },
  };
}

export const useBuilderStore = create<BuilderState>()(
  persist(
    (set) => ({
      draft: makeInitialDraft(),
      step: "setup",
      savedAt: Date.now(),

      setStep: (step) => set({ step }),

      setIndexSymbol: (symbol) =>
        set((s) => ({ draft: touch(setIndex(s.draft, symbol)), savedAt: Date.now() })),
      setMarket: (patch) =>
        set((s) => ({
          draft: touch({ ...s.draft, market: { ...s.draft.market, ...patch } }),
          savedAt: Date.now(),
        })),
      setDateRange: (range) =>
        set((s) => ({
          draft: touch({ ...s.draft, market: { ...s.draft.market, dateRange: range } }),
          savedAt: Date.now(),
        })),

      addLeg: () => set((s) => ({ draft: touch(addLeg(s.draft)), savedAt: Date.now() })),
      duplicateLeg: (legId) =>
        set((s) => ({ draft: touch(duplicateLeg(s.draft, legId)), savedAt: Date.now() })),
      removeLeg: (legId) =>
        set((s) => ({ draft: touch(removeLeg(s.draft, legId)), savedAt: Date.now() })),
      updateLeg: (legId, patch) =>
        set((s) => ({ draft: touch(updateLeg(s.draft, legId, patch)), savedAt: Date.now() })),
      applyTemplate: (templateId) =>
        set((s) => ({ draft: touch(applyTemplate(s.draft, templateId)), savedAt: Date.now() })),

      setTiming: (patch) =>
        set((s) => ({
          draft: touch({ ...s.draft, timing: { ...s.draft.timing, ...patch } }),
          savedAt: Date.now(),
        })),
      setRisk: (patch) =>
        set((s) => ({
          draft: touch({ ...s.draft, risk: { ...s.draft.risk, ...patch } }),
          savedAt: Date.now(),
        })),

      setName: (name) =>
        set((s) => ({
          draft: touch({ ...s.draft, name: name || "Untitled strategy" }),
          savedAt: Date.now(),
        })),

      reset: () => set({ draft: makeInitialDraft(), step: "setup", savedAt: Date.now() }),
      loadDraft: (draft) => set({ draft: touch(draft), step: "setup", savedAt: Date.now() }),
    }),
    {
      name: DRAFT_STORAGE_KEY,
      // Persist only the draft + step; savedAt is recomputed on load.
      partialize: (s) => ({ draft: s.draft, step: s.step }),
      // Validate the rehydrated draft so a corrupt/old blob can never crash the
      // builder — fall back to a fresh draft (draft.ts owns the sanitisation).
      merge: (persisted, current) => {
        const p = persisted as Partial<Pick<BuilderState, "draft" | "step">> | undefined;
        return {
          ...current,
          draft: restoreDraft(p?.draft),
          step: p?.step ?? "setup",
        };
      },
    }
  )
);
