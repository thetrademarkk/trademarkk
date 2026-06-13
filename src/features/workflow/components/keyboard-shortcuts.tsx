"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useUiStore } from "@/stores/ui-store";
import { todayKey } from "@/lib/utils";
import { matchShortcut, shouldPreventDefault } from "../shortcuts";
import { ShortcutsHelpSheet } from "./shortcuts-help";

/**
 * Global keyboard shortcuts for the app shell. Ctrl/Cmd+S saves the focused
 * form (or fires a `tm:save` event for non-form pages like the journal),
 * Ctrl/Cmd+Q opens quick-add, Ctrl/Cmd+L opens today's journal, and "?" opens
 * the help sheet. Matching (incl. the "ignore typing in inputs" rule) lives in
 * the pure {@link matchShortcut}; Ctrl+K and the T/J keys stay owned by the
 * command palette.
 */
export function KeyboardShortcuts() {
  const router = useRouter();
  const { setQuickAddOpen } = useUiStore();
  const [helpOpen, setHelpOpen] = React.useState(false);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const action = matchShortcut(e, e.target as HTMLElement | null);
      if (!action) return;
      if (shouldPreventDefault(action)) e.preventDefault();
      switch (action) {
        case "save": {
          // Submit the form the user is in; else let pages handle their own save.
          const active = document.activeElement as HTMLElement | null;
          const form = active?.closest("form") as HTMLFormElement | null;
          if (form) form.requestSubmit();
          else window.dispatchEvent(new CustomEvent("tm:save"));
          break;
        }
        case "quickAdd":
          setQuickAddOpen(true);
          break;
        case "quickLog":
          router.push(`/app/journal?date=${todayKey()}`);
          break;
        case "help":
          setHelpOpen((o) => !o);
          break;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router, setQuickAddOpen]);

  return <ShortcutsHelpSheet open={helpOpen} onOpenChange={setHelpOpen} />;
}
