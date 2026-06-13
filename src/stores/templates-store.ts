import { create } from "zustand";
import { persist } from "zustand/middleware";
import { newId } from "@/lib/id";
import {
  sanitizeTemplates,
  upsertTemplate,
  renameTemplate as renameTmpl,
  deleteTemplate as deleteTmpl,
  type NoteTemplate,
} from "@/features/workflow/templates";

interface TemplatesState {
  templates: NoteTemplate[];
  /** Create or update by name; ignores empty / all-empty inputs. */
  save: (input: {
    id?: string;
    name: string;
    notes: string;
    playbookId?: string;
    confidence?: number;
  }) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
}

// Persisted alongside the other tm.* preferences; sanitized on rehydrate since
// localStorage is user-editable. Named note/journal templates ("3MA breakout").
export const useTemplatesStore = create<TemplatesState>()(
  persist(
    (set) => ({
      templates: [],
      save: (input) =>
        set((s) => ({
          templates: upsertTemplate(s.templates, { ...input, id: input.id || newId() }),
        })),
      rename: (id, name) => set((s) => ({ templates: renameTmpl(s.templates, id, name) })),
      remove: (id) => set((s) => ({ templates: deleteTmpl(s.templates, id) })),
    }),
    {
      name: "tm.note-templates",
      // Re-validate stored data on load (drop anything tampered/corrupt).
      merge: (persisted, current) => ({
        ...current,
        templates: sanitizeTemplates((persisted as { templates?: unknown })?.templates),
      }),
    }
  )
);
