"use client";

import { TrendingDown } from "lucide-react";
import { PnlText } from "@/components/shared/pnl-text";
import { useAdherence } from "../queries";

/** The single most actionable nudge in the app: your costliest broken rule. */
export function ExpensiveHabitNudge({ from, to }: { from: string | null; to: string | null }) {
  const { data } = useAdherence(from, to);
  const worst = data?.rules[0];
  if (!worst || worst.brokenDayCost >= 0) return null;

  return (
    <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
      <TrendingDown className="mr-1 inline h-3.5 w-3.5 text-warning" aria-hidden />
      Your most expensive habit: <span className="font-medium">“{worst.rule.text}”</span> —
      broken-rule days cost you <PnlText value={worst.brokenDayCost} className="font-semibold" />
    </div>
  );
}
