"use client";

import * as React from "react";
import { useFilterStore, periodToRange } from "@/stores/filter-store";
import { useTrades } from "@/features/trades";
import { useAdherence } from "@/features/rules";
import { KpiRow, RecentTrades, Greeting } from "@/features/dashboard";
import { DailyChecklist, ExpensiveHabitNudge, MistakesPanel } from "@/features/rules";
import { MonthHeatmap } from "@/features/calendar";
import { useJournalDates } from "@/features/journal";
import { dailyPnl, closedOnly } from "@/lib/stats/stats";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { todayKey } from "@/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

// recharts is ~100 kB of route JS — load the chart after first paint so the
// KPI row (the LCP element) isn't gated on it.
const EquityChart = dynamic(
  () => import("@/features/dashboard/components/equity-chart").then((m) => m.EquityChart),
  { ssr: false, loading: () => <Skeleton className="h-72 lg:h-full" /> }
);

export default function DashboardPage() {
  const router = useRouter();
  const { period } = useFilterStore();
  const { from, to } = periodToRange(period);
  // One table scan instead of two: fetch all trades once, filter the period
  // client-side (the heatmap needs the full set anyway).
  const { data: allTrades, isLoading } = useTrades({});
  const trades = React.useMemo(
    () =>
      (allTrades ?? []).filter((t) => {
        const d = t.opened_at.slice(0, 10);
        return (!from || d >= from) && (!to || d <= to);
      }),
    [allTrades, from, to]
  );
  const { data: adherence } = useAdherence(from, to);
  const { data: journalDates = [] } = useJournalDates();

  if (isLoading || !trades) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const now = new Date();
  const monthPnl = dailyPnl(closedOnly(allTrades ?? []));

  return (
    <div className="space-y-4">
      <Greeting />
      <KpiRow trades={trades} adherencePct={adherence?.overallPct} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <EquityChart trades={trades} />
        </div>
        <DailyChecklist
          date={todayKey()}
          compact
          footer={<ExpensiveHabitNudge from={from} to={to} />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>
              {now.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
            </CardTitle>
            <Link href="/app/calendar" className="text-xs text-accent hover:underline">
              Calendar →
            </Link>
          </CardHeader>
          <CardContent>
            <MonthHeatmap
              year={now.getFullYear()}
              month={now.getMonth()}
              dailyPnl={monthPnl}
              journaledDates={new Set(journalDates)}
              onSelect={(date) => router.push(`/app/calendar?date=${date}`)}
              compact
            />
          </CardContent>
        </Card>
        <MistakesPanel from={from} to={to} />
        <RecentTrades trades={trades} />
      </div>
    </div>
  );
}
