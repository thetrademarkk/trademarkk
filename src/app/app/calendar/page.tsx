"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MonthHeatmap } from "@/features/calendar";
import { useTrades, describeInstrument } from "@/features/trades";
import { useJournalDates, useDayTrades } from "@/features/journal";
import { dailyPnl, closedOnly } from "@/lib/stats/stats";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PnlText } from "@/components/shared/pnl-text";
import { PageHeader } from "@/components/shared/page-header";

function DayPanel({ date }: { date: string }) {
  const { data: trades = [] } = useDayTrades(date);
  const pnl = trades.filter((t) => t.status === "closed").reduce((s, t) => s + t.net_pnl, 0);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>
          {new Date(date + "T12:00:00").toLocaleDateString("en-IN", {
            weekday: "short",
            day: "numeric",
            month: "long",
          })}
        </CardTitle>
        {trades.length > 0 && <PnlText value={pnl} className="font-semibold" />}
      </CardHeader>
      <CardContent className="space-y-2">
        {trades.length === 0 ? (
          <p className="text-sm text-muted">No trades this day.</p>
        ) : (
          <div className="divide-y">
            {trades.map((t) => (
              <Link
                key={t.id}
                href={`/app/trades/${t.id}`}
                className="flex items-center justify-between py-2 text-sm hover:bg-surface-2 -mx-2 px-2 rounded"
              >
                <span>{describeInstrument(t)}</span>
                {t.status === "closed" ? (
                  <PnlText value={t.net_pnl} />
                ) : (
                  <Badge variant="warning">open</Badge>
                )}
              </Link>
            ))}
          </div>
        )}
        <Button variant="outline" size="sm" asChild>
          <Link href={`/app/journal?date=${date}`}>Open journal for this day →</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function CalendarPage() {
  const now = new Date();
  const [year, setYear] = React.useState(now.getFullYear());
  const [month, setMonth] = React.useState(now.getMonth());
  const [selected, setSelected] = React.useState<string | null>(null);

  // Deep link from the dashboard heatmap: /app/calendar?date=YYYY-MM-DD
  React.useEffect(() => {
    const date = new URLSearchParams(window.location.search).get("date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    setSelected(date);
    setYear(Number(date.slice(0, 4)));
    setMonth(Number(date.slice(5, 7)) - 1);
  }, []);
  const { data: trades = [] } = useTrades({});
  const { data: journalDates = [] } = useJournalDates();

  // Per-day P&L scans the whole journal; only re-derive when trades change.
  const pnlMap = React.useMemo(() => dailyPnl(closedOnly(trades)), [trades]);
  const shift = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setSelected(null);
  };
  const monthTotal = React.useMemo(
    () =>
      [...pnlMap.entries()]
        .filter(([k]) => k.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`))
        .reduce((s, [, v]) => s + v, 0),
    [pnlMap, year, month]
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Calendar"
        description="Your P&L, day by day. Dots mark journaled days; the bar under a day shows a position was held across it."
      />
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => shift(-1)}>
          <ChevronLeft />
        </Button>
        <div className="min-w-[160px] text-center text-sm font-semibold">
          {new Date(year, month).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
        </div>
        <Button variant="outline" size="icon" aria-label="Next month" onClick={() => shift(1)}>
          <ChevronRight />
        </Button>
        <div className="ml-auto text-sm">
          Month: <PnlText value={monthTotal} className="font-semibold" />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="pt-4">
            <MonthHeatmap
              year={year}
              month={month}
              dailyPnl={pnlMap}
              journaledDates={new Set(journalDates)}
              trades={trades}
              selected={selected}
              onSelect={setSelected}
            />
          </CardContent>
        </Card>
        {selected ? (
          <DayPanel date={selected} />
        ) : (
          <Card>
            <CardContent className="flex h-full min-h-40 items-center justify-center text-sm text-muted">
              Select a day to see trades & journal.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
