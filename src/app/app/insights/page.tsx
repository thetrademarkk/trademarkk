"use client";

import * as React from "react";
import { HeartPulse, Lightbulb } from "lucide-react";
import { useFilterStore, periodToRange, PERIOD_LABELS } from "@/stores/filter-store";
import { useTrades } from "@/features/trades";
import { useAdherence } from "@/features/rules";
import {
  computeInsights,
  computeTiltInsights,
  ruleBreakInsight,
  InsightCard,
  MIN_SAMPLE,
} from "@/features/insights";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

export default function InsightsPage() {
  const { period } = useFilterStore();
  const { from, to } = periodToRange(period);
  // Same single-scan pattern as the dashboard: fetch once, filter client-side.
  const { data: allTrades, isLoading } = useTrades({});
  const { data: adherence } = useAdherence(from, to);

  const trades = React.useMemo(
    () =>
      (allTrades ?? []).filter((t) => {
        const d = t.opened_at.slice(0, 10);
        return (!from || d >= from) && (!to || d <= to);
      }),
    [allTrades, from, to]
  );

  const insights = React.useMemo(() => {
    const computed = computeInsights(trades);
    const rule = ruleBreakInsight(
      (adherence?.rules ?? []).map((r) => ({
        text: r.rule.text,
        broken: r.broken,
        brokenDayCost: r.brokenDayCost,
      }))
    );
    return rule ? [rule, ...computed] : computed;
  }, [trades, adherence]);

  const tilt = React.useMemo(() => computeTiltInsights(trades), [trades]);

  if (isLoading || !allTrades) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Insights"
        description="Patterns found in your own trades — computed on your device, no AI involved."
      />

      {allTrades.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="No insights yet"
          description="Log or import your trades and your patterns will start showing up here."
        />
      ) : insights.length === 0 && tilt.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="Not enough data yet"
          description={`Insights unlock once a pattern has at least ${MIN_SAMPLE} closed trades behind it in the selected period (${PERIOD_LABELS[period]}). Keep journaling.`}
        />
      ) : (
        <>
          {insights.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {insights.map((i) => (
                <InsightCard key={i.id} insight={i} />
              ))}
            </div>
          )}

          <section className="space-y-3 pt-2" aria-labelledby="tilt-check">
            <div className="flex items-center gap-2">
              <HeartPulse className="h-4 w-4 text-muted" aria-hidden />
              <h2 id="tilt-check" className="text-sm font-semibold">
                Tilt check
              </h2>
            </div>
            <p className="text-xs text-muted">
              Signs of trading on tilt — sizing up after losses, rushing re-entries, an edge that
              fades through the session, overtrading bursts vs your own baseline.
            </p>
            {tilt.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {tilt.map((i) => (
                  <InsightCard key={i.id} insight={i} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted">
                Not enough data for a tilt read yet — each check needs {MIN_SAMPLE}+ trades on both
                sides of its comparison.
              </p>
            )}
          </section>

          <p className="text-xs text-muted">
            Every insight needs at least {MIN_SAMPLE} trades behind it — thin patterns stay hidden
            until the data is there.
          </p>
        </>
      )}
    </div>
  );
}
