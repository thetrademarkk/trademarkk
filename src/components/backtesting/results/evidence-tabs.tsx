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
    <Tabs
      defaultValue="returns"
      className="w-full bt-boot bt-boot-1"
      data-testid="bt-evidence-tabs"
    >
      <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
        <TabsTrigger
          value="returns"
          data-testid="bt-tab-returns"
          className="font-mono uppercase tracking-wide"
        >
          Returns
        </TabsTrigger>
        <TabsTrigger
          value="risk"
          data-testid="bt-tab-risk"
          className="font-mono uppercase tracking-wide"
        >
          Risk
        </TabsTrigger>
        <TabsTrigger
          value="calendar"
          data-testid="bt-tab-calendar"
          className="font-mono uppercase tracking-wide"
        >
          Calendar
        </TabsTrigger>
        <TabsTrigger
          value="robustness"
          data-testid="bt-tab-robustness"
          className="font-mono uppercase tracking-wide"
        >
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
