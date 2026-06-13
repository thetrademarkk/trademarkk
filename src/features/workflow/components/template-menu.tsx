"use client";

import * as React from "react";
import { toast } from "sonner";
import { ChevronDown, Plus, Settings2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTemplatesStore } from "@/stores/templates-store";
import { applyTemplate, type NoteTemplate, type TemplatePatch } from "../templates";
import { TemplateManagerDialog } from "./template-manager-dialog";

/**
 * Quick-apply template dropdown for the trade form. Picking a template fills
 * setup notes + playbook + confidence; "Save current as template" snapshots the
 * form's current notes/playbook/confidence into a new named template; "Manage"
 * opens the rename/delete manager.
 */
export function TemplateMenu({
  onApply,
  current,
  playbooks,
}: {
  onApply: (patch: TemplatePatch) => void;
  current: { notes?: string; playbookId?: string; confidence?: number };
  playbooks: { id: string; name: string }[];
}) {
  const { templates, save } = useTemplatesStore();
  const [managerOpen, setManagerOpen] = React.useState(false);
  const [savingName, setSavingName] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");

  const apply = (t: NoteTemplate) => {
    onApply(applyTemplate(t));
    toast.success(`Applied "${t.name}"`);
  };

  const saveCurrent = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!current.notes?.trim() && !current.playbookId && current.confidence == null) {
      toast.error("Add notes, a playbook or confidence before saving a template");
      return;
    }
    save({
      name: trimmed,
      notes: current.notes ?? "",
      playbookId: current.playbookId,
      confidence: current.confidence,
    });
    toast.success(`Template "${trimmed}" saved`);
    setName("");
    setSavingName(null);
  };

  return (
    <>
      <DropdownMenu
        onOpenChange={(o) => {
          if (!o) setSavingName(null);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-8">
            <Sparkles className="h-3.5 w-3.5" /> Templates
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>Apply a template</DropdownMenuLabel>
          {templates.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted">
              No templates yet. Save your current setup notes, playbook and confidence as a reusable
              template.
            </p>
          ) : (
            templates.map((t) => (
              <DropdownMenuItem
                key={t.id}
                onSelect={(e) => {
                  e.preventDefault();
                  apply(t);
                }}
              >
                <span className="truncate">{t.name}</span>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          {savingName === null ? (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setSavingName("");
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Save current as template
            </DropdownMenuItem>
          ) : (
            <div className="flex gap-1.5 p-1.5" onKeyDown={(e) => e.stopPropagation()}>
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Template name…"
                maxLength={60}
                className="h-8 text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveCurrent();
                  }
                }}
              />
              <Button type="button" size="sm" className="h-8" onClick={saveCurrent}>
                Save
              </Button>
            </div>
          )}
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setManagerOpen(true);
            }}
          >
            <Settings2 className="h-3.5 w-3.5" /> Manage templates
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TemplateManagerDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        playbooks={playbooks}
      />
    </>
  );
}
