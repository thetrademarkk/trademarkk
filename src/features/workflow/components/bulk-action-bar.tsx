"use client";

import * as React from "react";
import { toast } from "sonner";
import { BookOpenText, Tag, TagsIcon, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useTags, usePlaybooks } from "@/features/trades";
import { useBulkAction } from "../queries";
import { describeBulkResult, type BulkAction } from "../bulk-actions";

/**
 * Floating action bar for the trades multi-select. Appears when ≥1 trade is
 * selected; batch-tag (add/remove), reassign playbook, or delete — each runs in
 * one transaction via {@link useBulkAction}. Mobile-friendly: it docks to the
 * bottom on phones and wraps its actions; respects the bottom nav.
 */
export function BulkActionBar({
  selectedIds,
  onClear,
}: {
  selectedIds: string[];
  onClear: () => void;
}) {
  const { data: tags = [] } = useTags();
  const { data: playbooks = [] } = usePlaybooks();
  const bulk = useBulkAction();
  const confirm = useConfirm();
  const count = selectedIds.length;

  const run = async (action: BulkAction, closeMenu?: () => void) => {
    try {
      const n = await bulk.mutateAsync({ action, ids: selectedIds });
      toast.success(describeBulkResult(action, n));
      closeMenu?.();
      if (action.kind === "delete") onClear();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk action failed");
    }
  };

  const onDelete = async () => {
    const ok = await confirm({
      title: `Delete ${count} trade${count === 1 ? "" : "s"}?`,
      description:
        "This permanently removes the selected trades and their fills. Cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) await run({ kind: "delete" });
  };

  if (count === 0) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-20 z-40 mx-auto w-[calc(100%-1.5rem)] max-w-3xl md:bottom-6"
      data-testid="bulk-action-bar"
    >
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-surface px-3 py-2 shadow-lg">
        <span className="text-sm font-medium" aria-live="polite">
          {count} selected
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <TagMenu
            mode="add"
            tags={tags}
            disabled={bulk.isPending}
            onPick={(tagId, close) => run({ kind: "addTag", tagId }, close)}
          />
          <TagMenu
            mode="remove"
            tags={tags}
            disabled={bulk.isPending}
            onPick={(tagId, close) => run({ kind: "removeTag", tagId }, close)}
          />
          <PlaybookMenu
            playbooks={playbooks}
            disabled={bulk.isPending}
            onPick={(playbookId, close) => run({ kind: "setPlaybook", playbookId }, close)}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-loss hover:text-loss"
            disabled={bulk.isPending}
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={onClear}
            aria-label="Clear selection"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        </div>
      </div>
    </div>
  );
}

function TagMenu({
  mode,
  tags,
  disabled,
  onPick,
}: {
  mode: "add" | "remove";
  tags: { id: string; name: string; color: string }[];
  disabled: boolean;
  onPick: (tagId: string, close: () => void) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const close = () => setOpen(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8" disabled={disabled}>
          {mode === "add" ? <Tag className="h-3.5 w-3.5" /> : <TagsIcon className="h-3.5 w-3.5" />}
          {mode === "add" ? "Add tag" : "Remove tag"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="end">
        {tags.length === 0 ? (
          <p className="px-1.5 py-1 text-xs text-muted">No tags yet — tag a trade first.</p>
        ) : (
          <div className="max-h-60 space-y-0.5 overflow-y-auto">
            {tags.map((t) => (
              <button
                key={t.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-surface-2"
                onClick={() => onPick(t.id, close)}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: t.color }}
                />
                <span className="truncate">{t.name}</span>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function PlaybookMenu({
  playbooks,
  disabled,
  onPick,
}: {
  playbooks: { id: string; name: string }[];
  disabled: boolean;
  onPick: (playbookId: string | null, close: () => void) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const close = () => setOpen(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8" disabled={disabled}>
          <BookOpenText className="h-3.5 w-3.5" /> Playbook
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="end">
        <div className="max-h-60 space-y-0.5 overflow-y-auto">
          <button
            type="button"
            className="flex w-full items-center rounded-md px-1.5 py-1.5 text-left text-sm text-muted hover:bg-surface-2"
            onClick={() => onPick(null, close)}
          >
            Clear playbook
          </button>
          {playbooks.map((p) => (
            <button
              key={p.id}
              type="button"
              className="flex w-full items-center rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-surface-2"
              onClick={() => onPick(p.id, close)}
            >
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
