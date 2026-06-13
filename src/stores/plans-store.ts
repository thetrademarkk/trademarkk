import { create } from "zustand";
import { persist } from "zustand/middleware";
import { newId } from "@/lib/id";
import {
  sanitizePlan,
  sanitizePlans,
  MAX_PLANS,
  type TradePlan,
} from "@/features/workflow/pre-trade-plan";

interface PlansState {
  plans: TradePlan[];
  /** Add a pre-trade plan (idea logged BEFORE entry). Returns the new id. */
  add: (input: Omit<TradePlan, "id" | "createdAt" | "executedAt">) => string | null;
  /** Mark a plan executed (kept for plan-vs-actual history), or remove it. */
  markExecuted: (id: string) => void;
  remove: (id: string) => void;
}

// Pre-trade idea/plan log. Plans write the planned_* trade columns when taken,
// tying into discipline-v2 plan-adherence. Persisted client-side (tm.trade-plans).
export const usePlansStore = create<PlansState>()(
  persist(
    (set) => ({
      plans: [],
      add: (input) => {
        const plan = sanitizePlan({ ...input, id: newId(), createdAt: new Date().toISOString() });
        if (!plan) return null;
        set((s) => ({ plans: [plan, ...s.plans].slice(0, MAX_PLANS) }));
        return plan.id;
      },
      markExecuted: (id) =>
        set((s) => ({
          plans: s.plans.map((p) =>
            p.id === id ? { ...p, executedAt: new Date().toISOString() } : p
          ),
        })),
      remove: (id) => set((s) => ({ plans: s.plans.filter((p) => p.id !== id) })),
    }),
    {
      name: "tm.trade-plans",
      merge: (persisted, current) => ({
        ...current,
        plans: sanitizePlans((persisted as { plans?: unknown })?.plans),
      }),
    }
  )
);
