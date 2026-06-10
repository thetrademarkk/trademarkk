"use client";

import { useFilterStore, periodToRange } from "@/stores/filter-store";
import { useTrades } from "@/features/trades";
import { useAdherence } from "@/features/rules";
import { KpiRow, EquityChart, RecentTrades } from "@/features/dashboard";
import { DailyChecklist, MistakesPanel } from "@/features/rules";
import { MonthHeatmap } from "@/features/calendar";
import { useJournalDates } from "@/features/journal";
import { dailyPnl, closedOnly } from "@/lib/stats/stats";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { todayKey } from "@/lib/utils";
import Link from "next/link";

export default function DashboardPage() {
  const { period } = useFilterStore();
  const { from, to } = periodToRange(period);
  const { data: trades, isLoading } = useTrades({ from, to });
  const { data: allTrades = [] } = useTrades({});
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
  const monthPnl = dailyPnl(closedOnly(allTrades));

  return (
    <div className="space-y-4">
      <KpiRow trades={trades} adherencePct={adherence?.overallPct} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <EquityChart trades={trades} />
        </div>
        <DailyChecklist date={todayKey()} compact />
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
