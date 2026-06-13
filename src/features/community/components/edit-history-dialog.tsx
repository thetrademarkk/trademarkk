"use client";

import * as React from "react";
import { History } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatPostDate } from "../format";
import type { CommentEditSnapshot, PostEditSnapshot } from "../edit-window";

/** One prior version, rendered read-only (this is an audit trail, never editable). */
function HistoryEntry({
  editedAt,
  title,
  body,
  tags,
}: {
  editedAt: string;
  title?: string | null;
  body: string;
  tags?: string[];
}) {
  return (
    <li className="rounded-lg border bg-surface-2/40 p-3">
      <p className="micro-label mb-1.5 text-muted">{formatPostDate(editedAt)}</p>
      {title != null && title !== "" && (
        <p className="mb-1 text-sm font-semibold leading-snug">{title}</p>
      )}
      <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/90">{body}</p>
      {tags && tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded-md bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent"
            >
              #{t}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * Read-only, immutable edit history: shows every PRE-edit snapshot newest-first.
 * The snapshots are append-only on the server — this dialog only ever displays
 * them, so a bad market call can never be silently scrubbed from the record.
 */
export function EditHistoryDialog({
  open,
  onOpenChange,
  kind,
  history,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "post" | "comment";
  history: (PostEditSnapshot | CommentEditSnapshot)[];
}) {
  // Newest prior version first (the array is stored oldest-first, append-only).
  const ordered = React.useMemo(() => [...history].reverse(), [history]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" aria-hidden /> Edit history
          </DialogTitle>
          <DialogDescription>
            {ordered.length === 1
              ? "The previous version of this " + kind + ", before it was edited."
              : `The ${ordered.length} previous versions of this ${kind}. History is permanent — prior versions are never removed.`}
          </DialogDescription>
        </DialogHeader>
        {ordered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No prior versions.</p>
        ) : (
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
            {ordered.map((entry, i) => (
              <HistoryEntry
                key={`${entry.editedAt}-${i}`}
                editedAt={entry.editedAt}
                title={"title" in entry ? entry.title : undefined}
                body={entry.body}
                tags={"tags" in entry ? entry.tags : undefined}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The inline "Edited · view history" marker shown under edited content. Clicking
 * "view history" opens the read-only history dialog.
 */
export function EditedMarker({
  kind,
  history,
  className,
}: {
  kind: "post" | "comment";
  history: (PostEditSnapshot | CommentEditSnapshot)[];
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <span className={className} data-edited-marker>
        Edited
        {history.length > 0 && (
          <>
            {" · "}
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="font-medium underline-offset-2 hover:text-accent hover:underline"
            >
              view history
            </button>
          </>
        )}
      </span>
      <EditHistoryDialog open={open} onOpenChange={setOpen} kind={kind} history={history} />
    </>
  );
}
