"use client";

import { useEffect, useState } from "react";
import NumberFlow, { type Format } from "@number-flow/react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { statTileAriaValue } from "@/features/analytics/chart-aria";

interface StatCardProps {
  label: string;
  value: number;
  format?: Format;
  prefix?: string;
  suffix?: string;
  tone?: "auto" | "neutral";
  sub?: string;
  className?: string;
}

/** KPI card with an animated rolling number (NumberFlow). */
export function StatCard({
  label,
  value,
  format,
  prefix,
  suffix,
  tone = "neutral",
  sub,
  className,
}: StatCardProps) {
  const color =
    tone === "auto"
      ? value > 0
        ? "text-profit"
        : value < 0
          ? "text-loss"
          : "text-foreground"
      : "text-foreground";
  const resolvedFormat = format ?? { maximumFractionDigits: 2 };
  // Subtle count-up on mount: NumberFlow only animates value CHANGES, so we paint
  // 0 first and set the real value after mount → the digits roll up once on load.
  // Later data updates animate from the previous value as usual. NumberFlow honours
  // prefers-reduced-motion (it snaps instead of rolling), and the real number is
  // always in the sr-only span below, so a11y never depends on the animation.
  const [shown, setShown] = useState(0);
  useEffect(() => setShown(value), [value]);
  // NumberFlow paints its rolling digits aria-hidden, so a screen reader hears
  // nothing — announce the formatted value (with label + sub) on a wrapper and
  // hide the visual ticker from the a11y tree.
  const ariaValue = statTileAriaValue(value, {
    format: resolvedFormat,
    prefix,
    suffix,
    locale: "en-IN",
  });
  return (
    <Card className={cn("p-4 min-w-0", className)}>
      <div className="micro-label">{label}</div>
      <div className={cn("mt-1.5 text-xl md:text-2xl font-semibold font-money", color)}>
        {/* SR-only value — NumberFlow's rolling digits are aria-hidden, so the
            announced number lives here; the visual ticker is hidden from a11y.
            The visible micro-label above is already read, so it isn't repeated. */}
        <span className="sr-only">
          {ariaValue}
          {sub ? `, ${sub}` : ""}
        </span>
        <span aria-hidden="true">
          <NumberFlow
            value={shown}
            format={resolvedFormat}
            prefix={prefix}
            suffix={suffix}
            locales="en-IN"
          />
        </span>
      </div>
      {sub ? (
        <div className="mt-1 text-xs text-muted truncate" aria-hidden="true">
          {sub}
        </div>
      ) : null}
    </Card>
  );
}

// Paise included — money displays are never rounded away.
export const inrFormat: Format = {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};
