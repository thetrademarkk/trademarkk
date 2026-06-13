// Public API of the workflow-polish feature: bulk edit, note templates, daily
// prompts, pre-trade plans, and keyboard shortcuts. Other features import only
// from here.
export { BulkActionBar } from "./components/bulk-action-bar";
export { PlanTradeDialog } from "./components/plan-trade-dialog";
export { TemplateMenu } from "./components/template-menu";
export { DailyPromptsWidget } from "./components/daily-prompts-widget";
export { KeyboardShortcuts } from "./components/keyboard-shortcuts";

export { useBulkAction } from "./queries";
export {
  selectionReducer,
  selectAllState,
  buildBulkStatements,
  describeBulkResult,
} from "./bulk-actions";
export type { BulkAction, SelectionEvent, SelectAllState } from "./bulk-actions";
export { applyTemplate, sanitizeTemplate, sanitizeTemplates, upsertTemplate } from "./templates";
export type { NoteTemplate, TemplatePatch } from "./templates";
export {
  parsePrompts,
  serializePrompts,
  hasPromptsBlock,
  EMPTY_PROMPTS,
  PROMPT_FIELDS,
} from "./daily-prompts";
export type { DailyPrompts } from "./daily-prompts";
export { sanitizePlan, sanitizePlans, planToFormDefaults, planRiskReward } from "./pre-trade-plan";
export type { TradePlan } from "./pre-trade-plan";
export { matchShortcut, isTypingTarget, shortcutHelpRows } from "./shortcuts";
export type { ShortcutAction } from "./shortcuts";
