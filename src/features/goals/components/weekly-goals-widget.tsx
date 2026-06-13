"use client";

import * as React from "react";
import Link from "next/link";
import { Target, X } from "lucide-react";
import { useTrades } from "@/features/trades";
import { useJournalDates } from "@/features/journal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PnlText } from "@/components/shared/pnl-text";
import { formatINR } from "@/lib/utils";
import { weeklyProgress } from "../compute";
import { useGoalSettings } from "../queries";

const weekLabel = (from: string, to: string): string => {
  const fmt = (k: string) =>
    new Date(`${k}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return `${fmt(from)} – ${fmt(to)}`;
};

/** Weekly profit + process-goal progress, computed from the fetched journal. */
export function WeeklyGoalsWidget() {
  const { data: settings } = useGoalSettings();
  const { data: trades } = useTrades({});
  const { data: journalDates = [] } = useJournalDates();
  const [hidden, setHidden] = React.useState(false);
  React.useEffect(() => {
    try {
      if (localStorage.getItem("tm.goals-nudge-hidden") === "1") setHidden(true);
    } catch {
      /* storage blocked */
    }
  }, []);
  if (!settings) return null;

  const hasWeeklyGoals =
    settings.weeklyProfitTargetPaise != null || settings.weeklyJournalDaysTarget != null;
  if (!hasWeeklyGoals) {
    if (hidden) return null;
    return (
      <Card data-testid="weekly-goals-empty">
        <CardContent className="flex flex-wrap items-center gap-2 py-3 text-sm text-muted">
          <Target className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <span className="min-w-0">
            Set a weekly profit goal and a journaling habit to track here.
          </span>
          <Link href="/app/settings" className="font-medium text-accent hover:underline">
            Set goals →
          </Link>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              try {
                localStorage.setItem("tm.goals-nudge-hidden", "1");
              } catch {
                /* storage blocked */
              }
              setHidden(true);
            }}
            className="ml-auto shrink-0 text-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </CardContent>
      </Card>
    );
  }

  const p = weeklyProgress(settings, trades ?? [], journalDates);
  return (
    <Card data-testid="weekly-goals">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-1.5">
          <Target className="h-4 w-4 text-accent" aria-hidden="true" /> This week
        </CardTitle>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span>{weekLabel(p.weekFrom, p.weekTo)}</span>
          <Link href="/app/settings" className="text-accent hover:underline">
            Edit goals
          </Link>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {p.profit && (
          <div data-testid="goal-profit" data-pct={p.profit.pct}>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
              <span className="text-muted">Profit goal</span>
              <span className="min-w-0">
                <PnlText value={p.profit.actualPaise / 100} className="text-sm" />
                <span className="text-xs text-muted">
                  {" "}
                  of {formatINR(p.profit.targetPaise / 100)}
                </span>
              </span>
            </div>
            <Progress value={p.profit.pct} aria-label="Weekly profit goal progress" />
          </div>
        )}
        {p.journalDays && (
          <div data-testid="goal-journal" data-pct={p.journalDays.pct}>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
              <span className="text-muted">Journaling</span>
              <span>
                <span className="font-medium">{p.journalDays.actual}</span>
                <span className="text-xs text-muted"> of {p.journalDays.target} days</span>
              </span>
            </div>
            <Progress value={p.journalDays.pct} aria-label="Weekly journaling goal progress" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
