"use client";

import { useFilterStore, periodToRange } from "@/stores/filter-store";
import {
  AdherencePanel,
  AdherenceRingCard,
  DailyChecklist,
  MistakesPanel,
  RulesManager,
} from "@/features/rules";
import { PageHeader } from "@/components/shared/page-header";
import { todayKey } from "@/lib/utils";

export default function RulesPage() {
  const { period } = useFilterStore();
  const { from, to } = periodToRange(period);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Rules & Mistakes"
        description="Discipline, measured. What did breaking your rules cost you?"
      />
      <AdherenceRingCard from={from} to={to} />
      <div className="grid gap-4 lg:grid-cols-2">
        <DailyChecklist date={todayKey()} />
        <AdherencePanel from={from} to={to} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <MistakesPanel from={from} to={to} />
        <RulesManager />
      </div>
    </div>
  );
}
