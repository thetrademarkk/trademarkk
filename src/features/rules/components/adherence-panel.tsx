"use client";

import { TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PnlText } from "@/components/shared/pnl-text";
import { formatPct } from "@/lib/utils";
import { useAdherence } from "../queries";

/** Adherence % per rule + the ₹ cost of days where each rule was broken. */
export function AdherencePanel({ from, to }: { from: string | null; to: string | null }) {
  const { data } = useAdherence(from, to);
  if (!data || data.rules.length === 0) return null;

  const worst = data.rules[0];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Rule adherence</CardTitle>
        <span className="text-sm font-semibold font-money">{formatPct(data.overallPct)}</span>
      </CardHeader>
      <CardContent className="space-y-3">
        {worst && worst.brokenDayCost < 0 && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            <TrendingDown className="mr-1 inline h-3.5 w-3.5 text-warning" aria-hidden />
            Your most expensive habit: <span className="font-medium">“{worst.rule.text}”</span> —
            broken-rule days cost you{" "}
            <PnlText value={worst.brokenDayCost} className="font-semibold" />
          </div>
        )}
        {data.rules.map(({ rule, followed, broken, adherencePct, brokenDayCost }) => (
          <div key={rule.id} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{rule.text}</span>
              <span className="shrink-0 text-xs text-muted">
                {followed}✓ {broken}✗
                {brokenDayCost < 0 && (
                  <>
                    {" · "}
                    <PnlText value={brokenDayCost} className="text-xs" />
                  </>
                )}
              </span>
            </div>
            <Progress value={adherencePct * 100} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
