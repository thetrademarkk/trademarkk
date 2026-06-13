/**
 * Builder-local types + the wizard step model (BT-06). Re-exports the shared
 * StrategyDef vocabulary so the builder modules import from one place, and
 * defines the 5-node wizard step enum used by the stepper, the per-step
 * validation gate, and deep-linking.
 */

import type { LegDef, OverallRisk, StrategyDef, StrikeSelector } from "../shared/strategy-def";

export type { LegDef, OverallRisk, StrategyDef, StrikeSelector };
export type OptionTypeT = LegDef["optionType"];

/** The 5 wizard nodes, in order. "review" is the final run gate. */
export const WIZARD_STEPS = ["setup", "legs", "timing", "risk", "review"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Human label for each step (used by the stepper + mobile crumb). */
export const STEP_LABEL: Record<WizardStep, string> = {
  setup: "Setup",
  legs: "Legs",
  timing: "Timing",
  risk: "Risk",
  review: "Review",
};

/** Index of a step in the ordered flow. */
export function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step);
}

/** The next/previous step, clamped to the flow bounds (null at the edges). */
export function nextStep(step: WizardStep): WizardStep | null {
  const i = stepIndex(step);
  return i < WIZARD_STEPS.length - 1 ? WIZARD_STEPS[i + 1]! : null;
}
export function prevStep(step: WizardStep): WizardStep | null {
  const i = stepIndex(step);
  return i > 0 ? WIZARD_STEPS[i - 1]! : null;
}
