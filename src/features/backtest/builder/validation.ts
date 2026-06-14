/**
 * Per-step validation gates for the no-code wizard (BT-06). Each gate validates
 * just the slice a step owns, using the BT-02 zod schemas as the source of truth
 * plus a few cross-field rules the schema can't express per-step. The wizard
 * BLOCKS "Continue" while a step is invalid and surfaces the messages inline.
 *
 * Pure + framework-free so it is unit-tested directly (advance blocked on
 * invalid, allowed on valid). Returns a flat list of human messages — the UI
 * decides where to anchor each one.
 */

import {
  legSchema,
  marketConfigSchema,
  overallRiskSchema,
  timingConfigSchema,
  validateExactStrike,
} from "../shared/strategy-def";
import { isValidStrike } from "../shared/instruments";
import type { StrategyDef, WizardStep } from "./types";

export interface StepValidation {
  ok: boolean;
  errors: string[];
  /** Non-blocking advisories (e.g. naked-short, low coverage) — shown but allow Continue. */
  warnings: string[];
}

const OK: StepValidation = { ok: true, errors: [], warnings: [] };

/** Collect zod issue messages into plain strings (deduped, order-stable). */
function zodMessages(result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}): string[] {
  if (result.success || !result.error) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of result.error.issues) {
    if (!seen.has(i.message)) {
      seen.add(i.message);
      out.push(i.message);
    }
  }
  return out;
}

/** Step 1 — Setup: market (index, interval, valid date range). */
export function validateSetup(s: StrategyDef): StepValidation {
  const errors = zodMessages(marketConfigSchema.safeParse(s.market));
  return errors.length ? { ok: false, errors, warnings: [] } : OK;
}

/** Step 2 — Legs: ≥1 enabled leg, each leg valid, exact strikes on the grid. */
export function validateLegs(s: StrategyDef): StepValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const enabled = s.legs.filter((l) => l.enabled);
  if (enabled.length === 0) {
    errors.push("Add at least one leg to continue.");
    return { ok: false, errors, warnings };
  }
  for (const leg of s.legs) {
    for (const m of zodMessages(legSchema.safeParse(leg))) errors.push(m);
    // EXACT strike must sit on the index grid (needs the index → not in the union refine).
    const gridErr = validateExactStrike(s.market.symbol, leg);
    if (gridErr) errors.push(gridErr);
    if (leg.strike.mode === "EXACT" && !isValidStrike(s.market.symbol, leg.strike.strike)) {
      // Covered by gridErr but keep the guard explicit for non-EXACT-safe inputs.
    }
  }
  // Advisory: a net unhedged short carries unlimited risk → nudge (never block).
  const allShortSameType =
    enabled.length >= 1 &&
    enabled.every((l) => l.side === "sell") &&
    !enabled.some((l) => l.side === "buy");
  if (allShortSameType) {
    warnings.push(
      "This position has short legs with no long hedge — unlimited risk. Consider a hedge leg or an overall stop in the Risk step."
    );
  }
  return errors.length ? { ok: false, errors, warnings } : { ...OK, warnings };
}

/** Step 3 — Timing: entry < exit, both valid HH:mm, day/DTE filters in range. */
export function validateTiming(s: StrategyDef): StepValidation {
  const errors = zodMessages(timingConfigSchema.safeParse(s.timing));
  return errors.length ? { ok: false, errors, warnings: [] } : OK;
}

/** Step 4 — Risk: overall block valid; per-leg triggers already validated in legs. */
export function validateRisk(s: StrategyDef): StepValidation {
  const errors = zodMessages(overallRiskSchema.safeParse(s.risk));
  const warnings: string[] = [];
  // Advisory: short legs with neither a per-leg stop nor an overall stop.
  const hasOverallStop = Boolean(s.risk.stopLoss || s.risk.maxLossRupees);
  const nakedShort = s.legs.some((l) => l.enabled && l.side === "sell" && !l.stopLoss);
  if (nakedShort && !hasOverallStop) {
    warnings.push("A short leg has no stop and there's no overall stop — add one to cap risk.");
  }
  return errors.length ? { ok: false, errors, warnings } : { ...OK, warnings };
}

/** Step 5 — Review: the whole strategy must parse (all gates together). */
export function validateReview(s: StrategyDef): StepValidation {
  const all = [validateSetup(s), validateLegs(s), validateTiming(s), validateRisk(s)];
  const errors = all.flatMap((v) => v.errors);
  const warnings = all.flatMap((v) => v.warnings);
  return errors.length ? { ok: false, errors, warnings } : { ...OK, warnings };
}

/** Validate the slice a given step owns. */
export function validateStep(step: WizardStep, s: StrategyDef): StepValidation {
  switch (step) {
    case "setup":
      return validateSetup(s);
    case "legs":
      return validateLegs(s);
    case "timing":
      return validateTiming(s);
    case "risk":
      return validateRisk(s);
    case "review":
      return validateReview(s);
  }
}

/**
 * Can the user advance PAST `step`? True only when the step's own slice is
 * valid. The wizard calls this on Continue and to gate clicking a future
 * stepper node.
 */
export function canAdvance(step: WizardStep, s: StrategyDef): boolean {
  return validateStep(step, s).ok;
}
