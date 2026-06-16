"use client";

import { Gauge } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Ring } from "@/components/shared/ring";
import { PnlText } from "@/components/shared/pnl-text";
import { cn } from "@/lib/utils";
import { useAdherence } from "../queries";
import { ExpensiveHabitNudge } from "./expensive-habit";

/** A compact label-over-value stat — sits in a 2×2 grid so the card stays dense. */
function Stat({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

/**
 * Headline rule-adherence card: the costliest-habit nudge pinned at the top, then
 * a fill-in ring (% of checks followed) beside the followed / broken counts and
 * the ₹ cost of broken-rule days. (The nudge already names the worst rule, so the
 * old "most broken" stat was dropped to avoid showing the same rule twice.)
 * Renders nothing until at least one rule check is logged in the range, so it
 * never shows an empty 100% on a fresh journal.
 */
export function AdherenceRingCard({ from, to }: { from: string | null; to: string | null }) {
  const { data } = useAdherence(from, to);
  if (!data || data.rules.length === 0) return null;

  const followed = data.rules.reduce((s, r) => s + r.followed, 0);
  const broken = data.rules.reduce((s, r) => s + r.broken, 0);
  if (followed + broken === 0) return null;

  const cost = data.rules.reduce((s, r) => s + r.brokenDayCost, 0);
  const pct = data.overallPct * 100;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4 text-muted" aria-hidden /> Adherence
        </CardTitle>
        <p className="text-xs text-muted">This period</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <ExpensiveHabitNudge from={from} to={to} />
        <div className="flex items-center gap-5">
          <Ring
            value={pct}
            label={`${Math.round(pct)}%`}
            sub="followed"
            size={104}
            stroke={9}
            color="var(--profit)"
          />
          <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-3">
            <Stat label="Followed">
              <span className="font-money text-lg font-semibold text-profit">{followed}</span>
            </Stat>
            <Stat label="Broken">
              <span className="font-money text-lg font-semibold text-loss">{broken}</span>
            </Stat>
            <Stat label="Cost of breaks" className="col-span-2">
              <PnlText value={cost} className="text-sm font-semibold" />
            </Stat>
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}
