"use client";

import { useTags } from "../queries";
import { cn } from "@/lib/utils";

/** Multi-select chip picker for mistake/emotion tags. */
export function TagPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data: tags = [] } = useTags();
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  const groups = [
    { kind: "mistake", label: "Mistakes" },
    { kind: "emotion", label: "Emotions" },
    { kind: "custom", label: "Custom" },
  ] as const;

  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const groupTags = tags.filter((t) => t.kind === g.kind);
        if (groupTags.length === 0) return null;
        return (
          <div key={g.kind}>
            <div className="micro-label mb-1">{g.label}</div>
            <div className="flex flex-wrap gap-1.5">
              {groupTags.map((t) => {
                const active = value.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggle(t.id)}
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-xs transition-colors",
                      active ? "border-transparent" : "border-border text-muted hover:text-foreground"
                    )}
                    style={active ? { backgroundColor: `${t.color}26`, color: t.color } : undefined}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
