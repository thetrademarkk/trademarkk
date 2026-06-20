import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The ONE shared segmented control for the backtesting builder — extracted from
 * the copy-pasted `Segmented` in legs-step and the inline toggles drifting across
 * timing/risk/setup. A pill group on `--bt-panel-2`; the active option lifts to
 * `--bt-panel` with a hairline shadow. Generic over the option value so callers
 * keep their literal-union types.
 */
export interface SegOption<T extends string> {
  value: T;
  label: React.ReactNode;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  testid,
  className,
  ariaLabel,
}: {
  value: T;
  options: readonly SegOption<T>[];
  onChange: (v: T) => void;
  testid?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      className={cn("inline-flex rounded-md border bg-surface-2 p-0.5", className)}
      data-testid={testid}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          data-value={o.value}
          data-active={value === o.value || undefined}
          className={cn(
            "rounded px-2.5 py-0.5 text-xs transition-colors",
            value === o.value
              ? "bg-surface font-medium shadow-sm"
              : "text-muted hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
