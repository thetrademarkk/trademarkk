/**
 * Keyboard-shortcut matching, kept pure so the "ignore typing in inputs" rule
 * and the modifier logic are unit-testable without a DOM. The React layer
 * (keyboard-shortcuts.tsx) just wires `matchShortcut` to a global keydown
 * listener and dispatches the resulting action.
 */

export type ShortcutAction =
  | "save" // Ctrl/Cmd+S — submit the active form
  | "quickAdd" // Ctrl/Cmd+Q — open quick-add trade
  | "quickLog" // Ctrl/Cmd+L — open the day's journal (quick-log)
  | "help"; // ? — open the shortcuts help sheet

/** The minimal slice of a KeyboardEvent we match on (so tests need no DOM). */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** The minimal slice of an event target we inspect for focus context. */
export interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  /** Some hosts (Radix) mark dismissable layers; we still allow Escape there. */
  type?: string;
}

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * True when focus is in a text-entry context, where global single-key
 * shortcuts (like "?") must NOT fire so the user can type freely. Modifier
 * combos (Ctrl+S) are handled separately — Ctrl+S is still useful while typing
 * in a form field, so it is allowed there.
 */
export function isTypingTarget(target: TargetLike | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return TYPING_TAGS.has((target.tagName ?? "").toUpperCase());
}

const isMod = (e: KeyLike) => e.ctrlKey || e.metaKey;

/**
 * Resolves a keyboard event to a {@link ShortcutAction}, or null for no match.
 *
 * Rules:
 *  - Ctrl/Cmd+S → save (allowed even while typing — you save mid-edit).
 *  - Ctrl/Cmd+Q → quickAdd, Ctrl/Cmd+L → quickLog (only when NOT typing, so
 *    they never clobber a field; both avoid browser-critical keys when paired
 *    with their letter — Ctrl+Q/Ctrl+L are safe to intercept in-app).
 *  - "?" (Shift+/) → help, only when not typing and no Ctrl/Cmd/Alt held.
 *  - Any other Alt combo, or a bare letter, is ignored (no hijacking).
 */
export function matchShortcut(
  e: KeyLike,
  target: TargetLike | null | undefined
): ShortcutAction | null {
  const typing = isTypingTarget(target);
  const key = e.key.toLowerCase();

  if (isMod(e) && !e.altKey) {
    if (key === "s") return "save";
    // Don't fire if Shift is also held (e.g. Ctrl+Shift+Q dev shortcuts).
    if (!e.shiftKey && key === "q") return typing ? null : "quickAdd";
    if (!e.shiftKey && key === "l") return typing ? null : "quickLog";
    return null;
  }

  // Bare "?" — never with Ctrl/Cmd/Alt. Browsers report the resolved char "?",
  // but match Shift+"/" too (some synthetic events report the physical key).
  const isQuestion = e.key === "?" || (e.key === "/" && e.shiftKey);
  if (!isMod(e) && !e.altKey && isQuestion && !typing) return "help";

  return null;
}

/** True if an action should call preventDefault (it overrides a browser default). */
export function shouldPreventDefault(action: ShortcutAction): boolean {
  // Ctrl+S would trigger "Save page"; the others have no critical default but
  // we still prevent so the key doesn't double-handle.
  return action === "save" || action === "quickAdd" || action === "quickLog" || action === "help";
}

/** Display rows for the help sheet. Uses ⌘ on macOS, Ctrl elsewhere. */
export function shortcutHelpRows(isMac: boolean): { keys: string; label: string }[] {
  const mod = isMac ? "⌘" : "Ctrl";
  return [
    { keys: `${mod} + S`, label: "Save the open form" },
    { keys: `${mod} + Q`, label: "Quick-add a trade" },
    { keys: `${mod} + L`, label: "Quick-log today's journal" },
    { keys: "T", label: "Add trade" },
    { keys: "J", label: "Today's journal" },
    { keys: `${mod} + K`, label: "Command palette" },
    { keys: "?", label: "Show this help" },
  ];
}
