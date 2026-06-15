"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Circular progress ring with a centered label. The arc fills in once on mount
 * (0 → value) via a stroke-dashoffset transition; reduced-motion users get it
 * fully drawn immediately. `value` is a 0–100 percentage.
 */
export function Ring({
  value,
  size = 92,
  stroke = 9,
  color = "var(--accent)",
  label,
  sub,
  className,
}: {
  value: number;
  size?: number;
  stroke?: number;
  /** Arc colour (any CSS colour / token). Track is always the surface tint. */
  color?: string;
  label: React.ReactNode;
  sub?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;

  // Fill in on mount: start empty, then transition to the real value.
  const [shown, setShown] = useState(0);
  useEffect(() => setShown(pct), [pct]);
  const offset = circ * (1 - shown / 100);

  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-[1100ms] ease-out motion-reduce:transition-none"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div
            className="font-money font-bold leading-none"
            style={{ fontSize: size > 80 ? 19 : 15 }}
          >
            {label}
          </div>
          {sub ? <div className="mt-0.5 text-[10px] text-muted">{sub}</div> : null}
        </div>
      </div>
    </div>
  );
}
