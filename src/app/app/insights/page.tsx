"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { HeartPulse, Lightbulb } from "lucide-react";
import { useFilterStore, periodToRange, PERIOD_LABELS } from "@/stores/filter-store";
import { useTrades } from "@/features/trades";
import { horizonMix, shouldGateIntradayPanels } from "@/lib/stats/horizon";
import { useAdherence, useRuleBreaksByDay } from "@/features/rules";
import {
  computeInsights,
  computeTiltInsights,
  ruleBreakInsight,
  splitRevenge,
  buildDayInfractions,
  confidenceCalibration,
  disciplineTrend,
  planAdherenceSummary,
  InsightCard,
  MIN_SAMPLE,
} from "@/features/insights";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

// recharts (the score trend line) stays out of the route bundle — the section
// hydrates after first paint, same pattern as the analytics charts.
const DisciplineSection = dynamic(
  () =>
    import("@/features/insights/components/discipline-section").then((m) => m.DisciplineSection),
  {
    ssr: false,
    loading: () => (
      <div className="grid gap-3 pt-2 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-72" />
        ))}
      </div>
    ),
  }
);

export default function InsightsPage() {
  const { period } = useFilterStore();
  const { from, to } = periodToRange(period);
  // Same single-scan pattern as the dashboard: fetch once, filter client-side.
  const { data: allTrades, isLoading } = useTrades({});
  const { data: adherence } = useAdherence(from, to);
  const { data: ruleBreaksByDay } = useRuleBreaksByDay();

  const trades = React.useMemo(
    () =>
      (allTrades ?? []).filter((t) => {
        const d = t.opened_at.slice(0, 10);
        return (!from || d >= from) && (!to || d <= to);
      }),
    [allTrades, from, to]
  );

  // When the book is predominantly multi-day, the intraday-only signals
  // (entry-hour insight + minutes-between-trades tilt checks) carry little
  // signal — gate them and explain why instead of misleading the trader.
  const gateIntraday = React.useMemo(
    () => shouldGateIntradayPanels(horizonMix(trades.filter((t) => t.status === "closed"))),
    [trades]
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
    const list = rule ? [rule, ...computed] : computed;
    return gateIntraday ? list.filter((i) => i.id !== "hour-of-day") : list;
  }, [trades, adherence, gateIntraday]);

  const tilt = React.useMemo(() => {
    const all = computeTiltInsights(trades);
    // tilt-pace (re-entry speed) and tilt-fade (late-session edge) are derived
    // from minutes between same-day trades — irrelevant for a multi-day book.
    return gateIntraday ? all.filter((i) => i.id !== "tilt-pace" && i.id !== "tilt-fade") : all;
  }, [trades, gateIntraday]);

  // Discipline & psychology v2 — per-day score trend, plan adherence, calibration.
  const discipline = React.useMemo(() => {
    const closed = trades.filter((t) => t.status === "closed");
    // Per-day tilt triggers = trades opened within 15min of a losing close.
    const { revenge } = splitRevenge(closed);
    const tiltTriggersByDay = new Map<string, number>();
    for (const t of revenge) {
      const d = t.opened_at.slice(0, 10);
      tiltTriggersByDay.set(d, (tiltTriggersByDay.get(d) ?? 0) + 1);
    }
    const dayRows = buildDayInfractions({
      trades: trades.map((t) => ({
        id: t.id,
        status: t.status,
        opened_at: t.opened_at,
        closed_at: t.closed_at,
        net_pnl: t.net_pnl,
        mistakeTagCount: t.tags.filter((g) => g.kind === "mistake" || g.kind === "emotion").length,
      })),
      ruleBreaksByDay: ruleBreaksByDay ?? new Map(),
      tiltTriggersByDay,
    });
    return {
      trend: disciplineTrend(dayRows),
      plan: planAdherenceSummary(trades),
      calibration: confidenceCalibration(trades),
    };
  }, [trades, ruleBreaksByDay]);

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

      {gateIntraday && allTrades.length > 0 && (
        <p className="rounded-lg border bg-surface px-3 py-2 text-xs text-muted" role="note">
          Most of your trades are held overnight, so intraday-only reads (entry hour, re-entry
          speed, late-session edge) are hidden — they would only mislead a multi-day book.
        </p>
      )}

      {allTrades.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="No insights yet"
          description="Log or import your trades and your patterns will start showing up here."
        />
      ) : insights.length === 0 && tilt.length === 0 ? (
        <>
          <EmptyState
            icon={Lightbulb}
            title="Not enough data yet"
            description={`Insights unlock once a pattern has at least ${MIN_SAMPLE} closed trades behind it in the selected period (${PERIOD_LABELS[period]}). Keep journaling.`}
          />
          <DisciplineSection
            trend={discipline.trend}
            plan={discipline.plan}
            calibration={discipline.calibration}
          />
        </>
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
            {gateIntraday && (
              <p className="text-xs text-muted" role="note">
                Re-entry-speed and late-session checks are intraday only — hidden because most of
                your trades are held overnight.
              </p>
            )}
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

          <DisciplineSection
            trend={discipline.trend}
            plan={discipline.plan}
            calibration={discipline.calibration}
          />

          <p className="text-xs text-muted">
            Every insight needs at least {MIN_SAMPLE} trades behind it — thin patterns stay hidden
            until the data is there.
          </p>
        </>
      )}
    </div>
  );
}
