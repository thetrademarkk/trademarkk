"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { useFilterStore, periodToRange } from "@/stores/filter-store";
import { useTrades, useAllLegs, usePlaybooks } from "@/features/trades";
import type { LegShape } from "@/lib/options/payoff";

// recharts stays out of the route bundle — the charts hydrate after first paint.
const GroupBar = dynamic(
  () => import("@/features/analytics/components/group-bar").then((m) => m.GroupBar),
  { ssr: false, loading: () => <Skeleton className="h-64" /> }
);
const RHistogram = dynamic(
  () => import("@/features/analytics/components/r-histogram").then((m) => m.RHistogram),
  { ssr: false, loading: () => <Skeleton className="h-64" /> }
);
const MoreStats = dynamic(
  () => import("@/features/analytics/components/more-stats").then((m) => m.MoreStats),
  { ssr: false, loading: () => <Skeleton className="h-64" /> }
);
const DayTimeHeatmap = dynamic(
  () => import("@/features/analytics/components/day-time-heatmap").then((m) => m.DayTimeHeatmap),
  { ssr: false, loading: () => <Skeleton className="h-64" /> }
);
const OptionsStats = dynamic(
  () => import("@/features/analytics/components/options-stats").then((m) => m.OptionsStats),
  { ssr: false, loading: () => <Skeleton className="h-64" /> }
);
const MonteCarlo = dynamic(
  () => import("@/features/analytics/components/monte-carlo").then((m) => m.MonteCarlo),
  { ssr: false, loading: () => <Skeleton className="h-64" /> }
);
import { PageHeader } from "@/components/shared/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  byDirection,
  byExpiryDay,
  byHourOfDay,
  bySegment,
  bySymbol,
  byWeekday,
  closedOnly,
  groupBy,
  streaks,
} from "@/lib/stats/stats";
import { EmotionsPanel } from "@/features/rules";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AnalyticsPage() {
  const { period } = useFilterStore();
  const { from, to } = periodToRange(period);
  const { data: trades, isLoading } = useTrades({ from, to });
  const { data: playbooks = [] } = usePlaybooks();
  const { data: legRows } = useAllLegs();

  // trade id → leg shapes (for multi-leg strategy classification).
  const legsByTrade = useMemo(() => {
    const map = new Map<string, LegShape[]>();
    if (!legRows) return map;
    for (const [tradeId, legs] of legRows) {
      const shapes = legs
        .filter((l) => l.strike != null && l.option_type != null)
        .map((l) => ({
          strike: l.strike!,
          optionType: l.option_type!,
          direction: l.direction,
          qty: l.qty,
        }));
      if (shapes.length > 0) map.set(tradeId, shapes);
    }
    return map;
  }, [legRows]);

  if (isLoading || !trades) return <Skeleton className="h-96" />;
  const closed = closedOnly(trades);
  const playbookName = new Map(playbooks.map((p) => [p.id, p.name]));
  const bySetup = groupBy(
    closed.filter((t) => t.playbook_id),
    (t) => playbookName.get(t.playbook_id ?? "") ?? "Unknown"
  );
  const streakInfo = streaks(closed);

  return (
    <div className="space-y-4">
      <PageHeader title="Analytics" description="Where your edge actually is — and isn't." />

      <Tabs defaultValue="time">
        <TabsList className="flex max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="time">Time</TabsTrigger>
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="instrument">Instrument</TabsTrigger>
          <TabsTrigger value="distribution">Distribution</TabsTrigger>
          <TabsTrigger value="options">Options</TabsTrigger>
          <TabsTrigger value="montecarlo">Monte Carlo</TabsTrigger>
          <TabsTrigger value="more">More</TabsTrigger>
        </TabsList>

        <TabsContent value="time" className="grid gap-4 md:grid-cols-2">
          <GroupBar title="By entry hour" stats={byHourOfDay(closed)} />
          <GroupBar title="By day of week" stats={byWeekday(closed)} />
          <GroupBar title="Expiry day vs other days (options)" stats={byExpiryDay(closed)} />
        </TabsContent>

        <TabsContent value="setup">
          <GroupBar title="By playbook / setup" stats={bySetup} />
        </TabsContent>

        <TabsContent value="instrument" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <GroupBar title="By symbol" stats={bySymbol(closed).slice(0, 10)} />
          <GroupBar title="By segment" stats={bySegment(closed)} />
          <GroupBar title="Long vs short" stats={byDirection(closed)} />
        </TabsContent>

        <TabsContent value="distribution" className="grid gap-4 md:grid-cols-2">
          <RHistogram trades={closed} />
          <EmotionsPanel from={from} to={to} />
          <Card>
            <CardHeader>
              <CardTitle>Streaks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Current streak</span>
                <span
                  className={
                    streakInfo.current >= 0 ? "text-profit font-money" : "text-loss font-money"
                  }
                >
                  {Math.abs(streakInfo.current)} {streakInfo.current >= 0 ? "wins" : "losses"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Longest win streak</span>
                <span className="font-money text-profit">{streakInfo.longestWin}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Longest loss streak</span>
                <span className="font-money text-loss">{streakInfo.longestLoss}</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="options" className="space-y-4">
          <OptionsStats trades={closed} legsByTrade={legsByTrade} />
        </TabsContent>

        <TabsContent value="montecarlo" className="space-y-4">
          <MonteCarlo trades={closed} />
        </TabsContent>

        <TabsContent value="more" className="space-y-4">
          <DayTimeHeatmap trades={closed} />
          <MoreStats trades={closed} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
