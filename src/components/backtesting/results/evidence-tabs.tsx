"use client";

import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RunResult } from "@/features/backtest/shared/run-result";

// Lazy-load each tab's content so heatmaps / cones aren't computed until the tab
// is selected (the spec's "lazy-mount each tab" rule). The fallbacks are sized to
// the real content so the layout doesn't jump.
const ReturnsTab = React.lazy(() =>
  import("./returns-tab").then((m) => ({ default: m.ReturnsTab }))
);
const RiskTab = React.lazy(() => import("./risk-tab").then((m) => ({ default: m.RiskTab })));
const CalendarTab = React.lazy(() =>
  import("./calendar-tab").then((m) => ({ default: m.CalendarTab }))
);
const RobustnessTab = React.lazy(() =>
  import("./robustness-tab").then((m) => ({ default: m.RobustnessTab }))
);

function TabFallback() {
  return <div className="h-40 animate-pulse rounded-lg bg-surface-2/60" aria-hidden />;
}

/**
 * Tier 2 — the EVIDENCE tabs (Radix Tabs). Returns · Risk · Calendar, each
 * lazy-mounted: we only mount (and only then compute) the active tab's content.
 * Radix unmounts inactive tab panels by default, so switching tabs mounts fresh.
 */
export function EvidenceTabs({ run }: { run: RunResult }) {
  return (
    <Tabs defaultValue="returns" className="w-full" data-testid="bt-evidence-tabs">
      {/* A ruled tab bar — active tab marked by a 2px amber underline, not a
          filled pill (the journal's four themes keep the primitive's pills). */}
      <TabsList className="w-full justify-start gap-1 overflow-x-auto rounded-none border-b bg-transparent p-0 sm:w-auto">
        <TabsTrigger value="returns" data-testid="bt-tab-returns" className="bt-tab">
          Returns
        </TabsTrigger>
        <TabsTrigger value="risk" data-testid="bt-tab-risk" className="bt-tab">
          Risk
        </TabsTrigger>
        <TabsTrigger value="calendar" data-testid="bt-tab-calendar" className="bt-tab">
          Calendar
        </TabsTrigger>
        <TabsTrigger value="robustness" data-testid="bt-tab-robustness" className="bt-tab">
          Robustness
        </TabsTrigger>
      </TabsList>

      <TabsContent value="returns">
        <React.Suspense fallback={<TabFallback />}>
          <ReturnsTab run={run} />
        </React.Suspense>
      </TabsContent>
      <TabsContent value="risk">
        <React.Suspense fallback={<TabFallback />}>
          <RiskTab run={run} />
        </React.Suspense>
      </TabsContent>
      <TabsContent value="calendar">
        <React.Suspense fallback={<TabFallback />}>
          <CalendarTab run={run} />
        </React.Suspense>
      </TabsContent>
      <TabsContent value="robustness">
        <React.Suspense fallback={<TabFallback />}>
          <RobustnessTab run={run} />
        </React.Suspense>
      </TabsContent>
    </Tabs>
  );
}
