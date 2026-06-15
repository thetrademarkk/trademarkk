"use client";

import { cn } from "@/lib/utils";

type Tone = "accent" | "profit" | "loss";

const ACTIVE: Record<Tone, string> = {
  accent: "border-accent bg-accent/15 text-accent",
  profit: "border-profit bg-profit/15 text-profit",
  loss: "border-loss bg-loss/15 text-loss",
};

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Per-option active tone (e.g. long=profit, short=loss). Falls back to `tone`. */
  tone?: Tone;
}

/**
 * The repo's pill-button group (Product / Direction / CE-PE), extracted from the
 * inline recipe in trade-form so every segmented choice looks identical. Pure
 * tokens, no new colours. Keeps `aria-pressed` per button (matches current a11y).
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  tone = "accent",
  size = "sm",
  columns,
  capitalize,
  className,
  ariaLabel,
}: {
  value: T | undefined;
  onChange: (v: T) => void;
  options: SegmentedOption<T>[];
  tone?: Tone;
  size?: "sm" | "touch";
  /** Fixed column count; defaults to one column per option (single row). */
  columns?: number;
  capitalize?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("grid gap-2", className)}
      style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0,1fr))` }}
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-lg border text-sm font-medium transition-colors",
              size === "touch" ? "min-h-11 px-3" : "h-9 px-2 text-xs",
              capitalize && "capitalize",
              active ? ACTIVE[o.tone ?? tone] : "border-border text-muted hover:bg-surface-2"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
