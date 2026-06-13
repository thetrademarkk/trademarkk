/**
 * Pure draft helpers for the no-code builder (BT-06): the blank-slate factory,
 * a smart-default date range, leg operations (add/duplicate/remove/update),
 * template application, and autosave/restore sanitisation. Kept framework-free
 * so the store is a thin zustand wrapper and the reducer logic is unit-tested
 * directly (autosave round-trip, leg ops, restore-clamps-garbage).
 *
 * The draft IS a StrategyDef (the JSON is the single source of truth), wrapped
 * with a tiny UI slice (current step) at the store layer — never inside the
 * StrategyDef itself.
 */

import { INDEX_META, type IndexSymbol } from "../shared/instruments";
import {
  makeDefaultStrategy,
  safeParseStrategyDef,
  type LegDef,
  type StrategyDef,
} from "../shared/strategy-def";
import { TEMPLATES_BY_ID } from "./templates";

/** Generate a stable-enough client id (crypto.randomUUID when available). */
export function makeId(prefix = "bt"): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return `${prefix}-${crypto.randomUUID()}`;
    }
  } catch {
    /* fall through */
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** ISO YYYY-MM-DD for a Date (UTC-day; the wizard uses calendar dates). */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The smart-default range: last ~3 months ending "today", clamped to the
 * index's true data start (so "Max"/first-build is well-covered, never empty).
 */
export function defaultRange(
  index: IndexSymbol,
  today = new Date()
): { start: string; end: string } {
  const end = isoDay(today);
  const startDate = new Date(today.getTime());
  startDate.setMonth(startDate.getMonth() - 3);
  const start = isoDay(startDate);
  const dataStart = INDEX_META[index].dataStart;
  return { start: start < dataStart ? dataStart : start, end };
}

/** A fresh, runnable draft: NIFTY, 1m, last 3 months, one ATM short straddle leg. */
export function makeInitialDraft(today = new Date()): StrategyDef {
  const id = makeId("draft");
  const base = makeDefaultStrategy(id, "NIFTY");
  const range = defaultRange("NIFTY", today);
  return {
    ...base,
    name: "New backtest",
    market: { ...base.market, dateRange: range },
    legs: [
      { ...base.legs[0]!, id: `${id}-l1`, optionType: "CE", side: "sell" },
      {
        id: `${id}-l2`,
        enabled: true,
        optionType: "PE",
        side: "sell",
        lots: 1,
        strike: { mode: "ATM_OFFSET", steps: 0 },
        expiry: "WEEKLY",
        squareOff: "partial",
      },
    ],
  };
}

/** A blank leg (ATM short CE) ready to be added to a draft. */
export function makeBlankLeg(): LegDef {
  return {
    id: makeId("leg"),
    enabled: true,
    optionType: "CE",
    side: "sell",
    lots: 1,
    strike: { mode: "ATM_OFFSET", steps: 0 },
    expiry: "WEEKLY",
    squareOff: "partial",
  };
}

const MAX_LEGS = 8;

/** Add a blank leg (no-op past the 8-leg cap). Returns a NEW draft. */
export function addLeg(draft: StrategyDef): StrategyDef {
  if (draft.legs.length >= MAX_LEGS) return draft;
  return { ...draft, legs: [...draft.legs, makeBlankLeg()] };
}

/** Duplicate a leg (the fast path to spreads), inserted right after it. */
export function duplicateLeg(draft: StrategyDef, legId: string): StrategyDef {
  if (draft.legs.length >= MAX_LEGS) return draft;
  const i = draft.legs.findIndex((l) => l.id === legId);
  if (i < 0) return draft;
  const clone: LegDef = { ...draft.legs[i]!, id: makeId("leg") };
  const legs = [...draft.legs];
  legs.splice(i + 1, 0, clone);
  return { ...draft, legs };
}

/** Remove a leg (keeps at least one leg — the last leg can't be removed). */
export function removeLeg(draft: StrategyDef, legId: string): StrategyDef {
  if (draft.legs.length <= 1) return draft;
  return { ...draft, legs: draft.legs.filter((l) => l.id !== legId) };
}

/** Patch one leg by id. Returns a NEW draft. */
export function updateLeg(draft: StrategyDef, legId: string, patch: Partial<LegDef>): StrategyDef {
  return {
    ...draft,
    legs: draft.legs.map((l) => (l.id === legId ? ({ ...l, ...patch } as LegDef) : l)),
  };
}

/** Replace the draft's legs with a template's legs (re-keyed with fresh ids). */
export function applyTemplate(draft: StrategyDef, templateId: string): StrategyDef {
  const tpl = TEMPLATES_BY_ID[templateId];
  if (!tpl) return draft;
  const baseId = makeId("tpl");
  const legs: LegDef[] = tpl.legs().map((l, i) => ({ ...l, id: `${baseId}-l${i + 1}` }));
  return {
    ...draft,
    name: tpl.name,
    legs,
    meta: {
      ...(draft.meta ?? blankMeta()),
      templateId,
      builderMode: "wizard",
      updatedAt: nowIso(),
    },
  };
}

/** Switch the index, re-clamping the date range to the new index's data start. */
export function setIndex(draft: StrategyDef, symbol: IndexSymbol): StrategyDef {
  const dataStart = INDEX_META[symbol].dataStart;
  const start = draft.market.dateRange.start < dataStart ? dataStart : draft.market.dateRange.start;
  return {
    ...draft,
    market: { ...draft.market, symbol, dateRange: { ...draft.market.dateRange, start } },
  };
}

function blankMeta(): NonNullable<StrategyDef["meta"]> {
  return { createdAt: nowIso(), updatedAt: nowIso(), builderMode: "wizard" };
}
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Restore a draft from persisted/unknown JSON. Validates with the schema; on any
 * failure returns a fresh initial draft (never crashes the builder). This is the
 * autosave/restore safety net the store relies on.
 */
export function restoreDraft(raw: unknown, today = new Date()): StrategyDef {
  const parsed = safeParseStrategyDef(raw);
  return parsed.success ? parsed.data : makeInitialDraft(today);
}
