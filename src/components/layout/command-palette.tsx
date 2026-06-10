"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Plus, NotebookPen } from "lucide-react";
import { NAV_ITEMS } from "@/config/nav";
import { useUiStore } from "@/stores/ui-store";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { todayKey } from "@/lib/utils";

export function CommandPalette() {
  const router = useRouter();
  const { commandOpen, setCommandOpen, setQuickAddOpen } = useUiStore();

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(!commandOpen);
      }
      if (typing) return;
      if (e.key.toLowerCase() === "t") {
        e.preventDefault();
        setQuickAddOpen(true);
      }
      if (e.key.toLowerCase() === "j") {
        e.preventDefault();
        router.push(`/app/journal?date=${todayKey()}`);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [commandOpen, setCommandOpen, setQuickAddOpen, router]);

  const run = (fn: () => void) => {
    setCommandOpen(false);
    fn();
  };

  return (
    <Dialog open={commandOpen} onOpenChange={setCommandOpen}>
      <DialogContent className="p-0 max-w-md overflow-hidden">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command className="bg-surface" label="Command palette">
          <Command.Input
            placeholder="Type a command or search…"
            className="w-full border-b bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted"
          />
          <Command.List className="max-h-72 overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted">No results.</Command.Empty>
            <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:micro-label [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
              <Command.Item
                onSelect={() => run(() => setQuickAddOpen(true))}
                className="flex items-center gap-2 rounded-md px-2 py-2 text-sm cursor-pointer data-[selected=true]:bg-surface-2"
              >
                <Plus className="h-4 w-4" /> Add trade <kbd className="ml-auto text-[10px] text-muted">T</kbd>
              </Command.Item>
              <Command.Item
                onSelect={() => run(() => router.push(`/app/journal?date=${todayKey()}`))}
                className="flex items-center gap-2 rounded-md px-2 py-2 text-sm cursor-pointer data-[selected=true]:bg-surface-2"
              >
                <NotebookPen className="h-4 w-4" /> Today&apos;s journal{" "}
                <kbd className="ml-auto text-[10px] text-muted">J</kbd>
              </Command.Item>
            </Command.Group>
            <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:micro-label [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
              {NAV_ITEMS.map((item) => (
                <Command.Item
                  key={item.href}
                  onSelect={() => run(() => router.push(item.href))}
                  className="flex items-center gap-2 rounded-md px-2 py-2 text-sm cursor-pointer data-[selected=true]:bg-surface-2"
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
