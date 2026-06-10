"use client";

import NumberFlow, { type Format } from "@number-flow/react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
export function StatCard({ label, value, format, prefix, suffix, tone = "neutral", sub, className }: StatCardProps) {
  const color =
    tone === "auto" ? (value > 0 ? "text-profit" : value < 0 ? "text-loss" : "text-foreground") : "text-foreground";
  return (
    <Card className={cn("p-4 min-w-0", className)}>
      <div className="micro-label">{label}</div>
      <div className={cn("mt-1.5 text-xl md:text-2xl font-semibold font-money", color)}>
        <NumberFlow
          value={value}
          format={format ?? { maximumFractionDigits: 2 }}
          prefix={prefix}
          suffix={suffix}
          locales="en-IN"
        />
      </div>
      {sub ? <div className="mt-1 text-xs text-muted truncate">{sub}</div> : null}
    </Card>
  );
}

export const inrFormat: Format = {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
};
