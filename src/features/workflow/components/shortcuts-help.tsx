"use client";

import * as React from "react";
import { Keyboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { shortcutHelpRows } from "../shortcuts";

/** Discoverable keyboard-shortcuts cheat sheet (opened with "?"). */
export function ShortcutsHelpSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Detect macOS once on the client so the modifier label matches the keys.
  const isMac = React.useMemo(
    () =>
      typeof navigator !== "undefined" &&
      /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent),
    []
  );
  const rows = shortcutHelpRows(isMac);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="shortcuts-help">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-accent" aria-hidden /> Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>Work faster — press ? anytime to see this.</DialogDescription>
        </DialogHeader>
        <ul className="divide-y text-sm">
          {rows.map((r) => (
            <li key={r.keys} className="flex items-center justify-between py-2">
              <span className="text-muted">{r.label}</span>
              <kbd className="rounded border bg-surface-2 px-2 py-0.5 font-mono text-xs">
                {r.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
