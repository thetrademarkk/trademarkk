"use client";

import * as React from "react";
import { useFilterStore, periodToRange } from "@/stores/filter-store";
import { useTrades } from "@/features/trades";
import { useAdherence } from "@/features/rules";
import { KpiRow, RecentTrades, Greeting, OpenPositionsCard } from "@/features/dashboard";
import {
  TradingStyleSummary,
  HoldingPeriodCard,
} from "@/features/analytics/components/horizon-stats";
import { horizonMix, dashboardEmphasis, GATE_MIN_TRADES } from "@/lib/stats/horizon";
import { useTraderProfile } from "@/features/onboarding/queries";
import { dashboardEmphasisForTraderType } from "@/features/onboarding/trader-profile";
import { RiskGuardrailBanner, WeeklyGoalsWidget } from "@/features/goals";
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
  const { data: allTrades, isLoading } = useTrades({}, { withTags: false });
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
  const { data: traderProfile } = useTraderProfile();

  // Full-journal derivations (heatmap + holding-style emphasis) only change when
  // the underlying trade set does — memoize so they don't re-scan every render.
  const allClosed = React.useMemo(() => closedOnly(allTrades ?? []), [allTrades]);
  const monthPnl = React.useMemo(() => dailyPnl(allClosed), [allClosed]);
  const mix = React.useMemo(() => horizonMix(allClosed), [allClosed]);

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
  // The dashboard adapts to the trader's holding style: positional/swing users
  // get open-positions + holding emphasis, intraday users keep the day-focused
  // arrangement, and a thin/mixed journal degrades to the balanced layout.
  // SEG-08: until there are enough classifiable trades to read the style from
  // the data, fall back to the onboarding trader-type's emphasis so a brand-new
  // swing/F&O trader gets a relevant layout from their very first session.
  const emphasis =
    mix.total < GATE_MIN_TRADES && traderProfile
      ? dashboardEmphasisForTraderType(traderProfile.traderType)
      : dashboardEmphasis(mix);
  const positional = emphasis === "positional";

  // Daily checklist / expensive-habit nudge — an intraday-trader staple. Held
  // high for intraday/balanced, demoted (not removed) for positional users.
  const dailyChecklist = (
    <DailyChecklist
      date={todayKey()}
      compact
      footer={<ExpensiveHabitNudge from={from} to={to} />}
    />
  );

  const calendarCard = (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{now.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</CardTitle>
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
          trades={allTrades ?? []}
          onSelect={(date) => router.push(`/app/calendar?date=${date}`)}
          compact
        />
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <Greeting />
        {allClosed.length > 0 && <TradingStyleSummary trades={allClosed} inline />}
      </div>
      <RiskGuardrailBanner />
      <KpiRow trades={trades} adherencePct={adherence?.overallPct} emphasis={emphasis} />

      {positional ? (
        // Positional/swing lean: live carry + holding period come first; the
        // equity curve and the intraday checklist drop below.
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <OpenPositionsCard trades={allTrades ?? []} />
            </div>
            <HoldingPeriodCard trades={allClosed} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <EquityChart trades={trades} />
            </div>
            {dailyChecklist}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {calendarCard}
            <MistakesPanel from={from} to={to} />
            <RecentTrades trades={trades} />
          </div>
        </>
      ) : (
        // Intraday / balanced: the day-focused layout, with open positions kept
        // alongside recent trades rather than hidden.
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <EquityChart trades={trades} />
            </div>
            {dailyChecklist}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {calendarCard}
            <MistakesPanel from={from} to={to} />
            <RecentTrades trades={trades} />
          </div>
          <OpenPositionsCard trades={allTrades ?? []} />
        </>
      )}

      <WeeklyGoalsWidget />
    </div>
  );
}
