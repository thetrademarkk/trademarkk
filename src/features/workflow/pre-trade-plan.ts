import type { TradeFormValues } from "@/features/trades/schemas";
import { productsForSegment } from "@/features/trades/schemas";
import type { Segment, Product } from "@/features/trades/types";

/**
 * A pre-trade idea/plan: what you intend to do BEFORE entering. Captured ahead
 * of execution so plan-vs-actual (discipline v2) has the planned levels to grade
 * against. A plan is a lightweight localStorage record (`tm.trade-plans`); when
 * you actually take the trade it seeds the trade form's defaults — the
 * planned_entry / planned_sl / planned_target columns (already in the schema)
 * are written straight from the plan, never fabricated later.
 */
export interface TradePlan {
  id: string;
  symbol: string;
  segment: Segment;
  product: Product;
  direction: "long" | "short";
  plannedEntry?: number;
  plannedSl?: number;
  plannedTarget?: number;
  /** Why this idea — copied into the trade-form notes when executed. */
  rationale?: string;
  createdAt: string;
  /** Set once the plan has been turned into a real trade (kept for history). */
  executedAt?: string;
}

export const MAX_PLANS = 100;

const SEGMENTS: Segment[] = ["EQ", "FUT", "OPT", "COMM", "CDS"];

const posNum = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * Coerces an untrusted object into a valid {@link TradePlan} or null. Requires
 * a symbol; clamps segment/product/direction to legal values and keeps product
 * valid for the segment (so a stored "EQ + NRML" can't slip through).
 */
export function sanitizePlan(raw: unknown): TradePlan | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const symbol = typeof r.symbol === "string" ? r.symbol.trim().toUpperCase().slice(0, 30) : "";
  if (!symbol) return null;
  const segment: Segment = SEGMENTS.includes(r.segment as Segment) ? (r.segment as Segment) : "EQ";
  const allowed = productsForSegment(segment);
  // productsForSegment never returns an empty list; ?? "MIS" satisfies the
  // (noUncheckedIndexedAccess) type checker without a real fallback path.
  const product: Product = allowed.includes(r.product as Product)
    ? (r.product as Product)
    : (allowed[0] ?? "MIS");
  const direction = r.direction === "short" ? "short" : "long";
  return {
    id: typeof r.id === "string" && r.id ? r.id : "",
    symbol,
    segment,
    product,
    direction,
    plannedEntry: posNum(r.plannedEntry),
    plannedSl: posNum(r.plannedSl),
    plannedTarget: posNum(r.plannedTarget),
    rationale:
      typeof r.rationale === "string" && r.rationale.trim()
        ? r.rationale.slice(0, 1000)
        : undefined,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date(0).toISOString(),
    executedAt: typeof r.executedAt === "string" ? r.executedAt : undefined,
  };
}

export function sanitizePlans(raw: unknown): TradePlan[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(sanitizePlan)
    .filter((p): p is TradePlan => p != null)
    .slice(0, MAX_PLANS);
}

/**
 * Maps a plan onto trade-form defaults so "take this trade" opens the quick-add
 * pre-filled. The planned_* fields land in `plannedEntry/plannedSl/plannedTarget`
 * (written verbatim to the schema columns); `plannedEntry` also seeds the actual
 * `avgEntry` as a starting point the trader confirms/edits on fill. Only fields
 * the plan carries are set — undefined leaves the form default intact.
 */
export function planToFormDefaults(plan: TradePlan): Partial<TradeFormValues> {
  const defaults: Partial<TradeFormValues> = {
    symbol: plan.symbol,
    segment: plan.segment,
    product: plan.product,
    direction: plan.direction,
  };
  if (plan.plannedEntry != null) {
    defaults.plannedEntry = plan.plannedEntry;
    defaults.avgEntry = plan.plannedEntry;
  }
  if (plan.plannedSl != null) defaults.plannedSl = plan.plannedSl;
  if (plan.plannedTarget != null) defaults.plannedTarget = plan.plannedTarget;
  if (plan.rationale) defaults.notes = plan.rationale;
  return defaults;
}

/**
 * Risk:reward implied by the plan (|target−entry| / |entry−sl|), or null if any
 * leg is missing or the stop equals the entry. Direction-agnostic — uses
 * absolute distances, which is what R:R means for both longs and shorts.
 */
export function planRiskReward(plan: TradePlan): number | null {
  const { plannedEntry: e, plannedSl: sl, plannedTarget: t } = plan;
  if (e == null || sl == null || t == null) return null;
  const risk = Math.abs(e - sl);
  if (risk === 0) return null;
  return Math.round((Math.abs(t - e) / risk) * 100) / 100;
}
