import type { TradeFormValues } from "@/features/trades/schemas";

/**
 * Named note / journal templates (e.g. "3MA breakout") that pre-fill a trade's
 * setup notes + playbook + confidence in one click. Stored client-side in
 * localStorage (key `tm.note-templates`) like every other workflow preference —
 * never touches the journal DB or the server. Pure here so it is unit-testable
 * and the React store / form just consume these helpers.
 */
export interface NoteTemplate {
  id: string;
  /** Display name, e.g. "3MA breakout". 1–60 chars after trim. */
  name: string;
  /** Pre-filled setup notes (the trade-form Notes field). */
  notes: string;
  /** Playbook to assign, if the user picked one when creating the template. */
  playbookId?: string;
  /** Pre-set conviction 1–5. */
  confidence?: number;
  createdAt: string;
}

/** The subset of the trade form a template fills. */
export type TemplatePatch = Pick<TradeFormValues, "notes" | "playbookId" | "confidence">;

export const MAX_TEMPLATES = 50;
export const MAX_TEMPLATE_NAME = 60;
const MAX_TEMPLATE_NOTES = 2000;

const clampInt = (v: unknown, lo: number, hi: number): number | undefined => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  const i = Math.round(n);
  return i >= lo && i <= hi ? i : undefined;
};

/**
 * Coerces an untrusted object (localStorage is user-editable) into a valid
 * {@link NoteTemplate}, or null if it cannot be salvaged. A template MUST have
 * a non-empty name and at least one fillable field (notes/playbook/confidence)
 * — an all-empty template would silently do nothing on apply.
 */
export function sanitizeTemplate(raw: unknown): NoteTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim().slice(0, MAX_TEMPLATE_NAME) : "";
  if (!name) return null;
  const notes = typeof r.notes === "string" ? r.notes.slice(0, MAX_TEMPLATE_NOTES) : "";
  const playbookId =
    typeof r.playbookId === "string" && r.playbookId.trim() ? r.playbookId : undefined;
  const confidence = clampInt(r.confidence, 1, 5);
  if (!notes && !playbookId && confidence == null) return null;
  return {
    id: typeof r.id === "string" && r.id ? r.id : "",
    name,
    notes,
    playbookId,
    confidence,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date(0).toISOString(),
  };
}

/** Sanitizes a stored array, dropping junk and capping the count. */
export function sanitizeTemplates(raw: unknown): NoteTemplate[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(sanitizeTemplate)
    .filter((t): t is NoteTemplate => t != null)
    .slice(0, MAX_TEMPLATES);
}

/**
 * Builds the form patch a template applies. Only sets fields the template
 * actually carries — an undefined field leaves the form's current value alone,
 * EXCEPT notes, which is always set (an empty-notes template intentionally
 * clears the field so re-applying a different template is predictable).
 */
export function applyTemplate(template: NoteTemplate): TemplatePatch {
  const patch: TemplatePatch = { notes: template.notes };
  if (template.playbookId) patch.playbookId = template.playbookId;
  if (template.confidence != null) patch.confidence = template.confidence;
  return patch;
}

/**
 * Upserts a template by case-insensitive name (so saving "3MA breakout" twice
 * updates the existing one rather than duplicating). Returns a NEW array.
 * Ignores empty names / all-empty templates (sanitize rejects them).
 */
export function upsertTemplate(
  templates: NoteTemplate[],
  input: { id?: string; name: string; notes: string; playbookId?: string; confidence?: number }
): NoteTemplate[] {
  const draft = sanitizeTemplate({ ...input, createdAt: new Date().toISOString() });
  if (!draft) return templates;
  // Match by id first (a rename), else by name (re-save of the same template).
  const byId = input.id ? templates.findIndex((t) => t.id === input.id) : -1;
  const byName =
    byId === -1
      ? templates.findIndex((t) => t.name.toLowerCase() === draft.name.toLowerCase())
      : -1;
  const idx = byId !== -1 ? byId : byName;
  const existing = idx !== -1 ? templates[idx] : undefined;
  if (existing) {
    const next = [...templates];
    next[idx] = { ...draft, id: existing.id, createdAt: existing.createdAt };
    return next;
  }
  return [{ ...draft, id: input.id || draft.id }, ...templates].slice(0, MAX_TEMPLATES);
}

export function renameTemplate(
  templates: NoteTemplate[],
  id: string,
  name: string
): NoteTemplate[] {
  const trimmed = name.trim().slice(0, MAX_TEMPLATE_NAME);
  if (!trimmed) return templates;
  // Block renaming onto another template's name (case-insensitive).
  if (templates.some((t) => t.id !== id && t.name.toLowerCase() === trimmed.toLowerCase()))
    return templates;
  return templates.map((t) => (t.id === id ? { ...t, name: trimmed } : t));
}

export function deleteTemplate(templates: NoteTemplate[], id: string): NoteTemplate[] {
  return templates.filter((t) => t.id !== id);
}
