"use client";

import * as React from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTemplatesStore } from "@/stores/templates-store";

/** Manage saved note/journal templates: rename and delete. */
export function TemplateManagerDialog({
  open,
  onOpenChange,
  playbooks,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playbooks: { id: string; name: string }[];
}) {
  const { templates, rename, remove } = useTemplatesStore();
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");

  const playbookName = (id?: string) => playbooks.find((p) => p.id === id)?.name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage templates</DialogTitle>
          <DialogDescription>
            Rename or delete your saved note templates. Create new ones from the trade form.
          </DialogDescription>
        </DialogHeader>
        {templates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No templates yet.</p>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <div
                key={t.id}
                className="rounded-lg border bg-surface-2/40 p-3"
                data-testid="managed-template"
              >
                <div className="flex items-center gap-2">
                  {editing === t.id ? (
                    <>
                      <Input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        maxLength={60}
                        className="h-8 text-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            rename(t.id, draft);
                            setEditing(null);
                          }
                          if (e.key === "Escape") setEditing(null);
                        }}
                      />
                      <Button
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        aria-label="Save name"
                        onClick={() => {
                          rename(t.id, draft);
                          setEditing(null);
                        }}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        aria-label="Cancel rename"
                        onClick={() => setEditing(null)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 truncate text-sm font-medium">{t.name}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted"
                        aria-label={`Rename ${t.name}`}
                        onClick={() => {
                          setEditing(t.id);
                          setDraft(t.name);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted hover:text-loss"
                        aria-label={`Delete ${t.name}`}
                        onClick={() => remove(t.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
                <div className="mt-1.5 space-y-0.5 text-xs text-muted">
                  {t.notes && <p className="line-clamp-2">{t.notes}</p>}
                  <div className="flex flex-wrap gap-x-3">
                    {playbookName(t.playbookId) && <span>Setup: {playbookName(t.playbookId)}</span>}
                    {t.confidence != null && <span>Confidence: {t.confidence}/5</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
