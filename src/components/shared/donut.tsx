"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface DonutSegment {
  value: number;
  /** Arc colour — any CSS colour or token, e.g. "var(--profit)". */
  color: string;
  /** Used for the title/aria description, not drawn. */
  label?: string;
}

/**
 * A segmented donut chart (pie with a hole). Pure SVG + tokens — no chart lib,
 * so it can never fail to render. Segments are sized by `value`; they grow from
 * their start once on mount (staggered) via a stroke-dasharray transition, and
 * if a browser won't transition that property they simply appear full instantly
 * (never blank). Reduced-motion users get them drawn immediately. Pass center
 * content as children (e.g. a big number).
 */
export function Donut({
  segments,
  size = 128,
  stroke = 14,
  gap = 4,
  children,
  className,
}: {
  segments: DonutSegment[];
  size?: number;
  stroke?: number;
  /** Visual gap (in px of arc length) between adjacent segments. */
  gap?: number;
  children?: React.ReactNode;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const data = segments.filter((s) => s.value > 0);
  const total = data.reduce((s, x) => s + x.value, 0) || 1;
  const multi = data.length > 1; // a single full ring looks better with no gap

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  let start = 0;
  const arcs = data.map((s) => {
    const len = (s.value / total) * circ;
    const drawn = multi ? Math.max(0, len - gap) : len;
    const arc = { color: s.color, drawn, offset: -start };
    start += len;
    return arc;
  });

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
        {arcs.map((a, i) => (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={a.color}
            strokeWidth={stroke}
            strokeLinecap="butt"
            strokeDasharray={`${mounted ? a.drawn : 0} ${circ}`}
            strokeDashoffset={a.offset}
            className="transition-[stroke-dasharray] duration-[850ms] ease-out motion-reduce:transition-none"
            style={{ transitionDelay: `${i * 110}ms` }}
          />
        ))}
      </svg>
      {children != null && (
        <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
      )}
    </div>
  );
}
