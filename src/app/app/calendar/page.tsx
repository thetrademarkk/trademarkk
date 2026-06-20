"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Receipt } from "lucide-react";
import { MonthHeatmap, UpcomingExpiriesView } from "@/features/calendar";
import { useTrades, describeInstrument } from "@/features/trades";
import { useJournalDates, useDayTrades } from "@/features/journal";
import { dailyPnl, closedOnly } from "@/lib/stats/stats";
import { istDateKey } from "@/lib/tax/fy";
import { formatINR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PnlText } from "@/components/shared/pnl-text";
import { Donut } from "@/components/shared/donut";
import { PageHeader } from "@/components/shared/page-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

/** A coloured dot + count, for the donut legend. */
function LegendDot({ color, n, label }: { color: string; n: number; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span className="font-money font-semibold tabular-nums">{n}</span>
      <span className="text-muted">{label}</span>
    </div>
  );
}

/** A label-over-value stat tile used in the day-detail grid. */
function MiniStat({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof TrendingUp;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-surface-2/40 p-2.5">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold">{children}</div>
    </div>
  );
}

function DayPanel({ date }: { date: string }) {
  const { data: trades = [] } = useDayTrades(date);

  // The calendar cell keys realised P&L by the CLOSE day (IST) — mirror that so
  // the panel's headline P&L always matches the number shown on the calendar.
  const closedToday = trades.filter(
    (t) => t.status === "closed" && t.closed_at && istDateKey(t.closed_at) === date
  );
  const dayPnl = closedToday.reduce((s, t) => s + t.net_pnl, 0);

  const wins = closedToday.filter((t) => t.net_pnl > 0);
  const losses = closedToday.filter((t) => t.net_pnl < 0);
  const scratches = closedToday.filter((t) => t.net_pnl === 0);
  const decided = wins.length + losses.length;
  const winRate = decided > 0 ? Math.round((wins.length / decided) * 100) : null;

  const gross = closedToday.reduce((s, t) => s + t.gross_pnl, 0);
  const charges = closedToday.reduce((s, t) => s + t.charges, 0);
  const nets = closedToday.map((t) => t.net_pnl);
  const best = nets.length ? Math.max(...nets) : 0;
  const worst = nets.length ? Math.min(...nets) : 0;

  const openCount = trades.filter((t) => t.status !== "closed").length;

  const title = new Date(date + "T12:00:00").toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "long",
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        {closedToday.length > 0 ? (
          <PnlText value={dayPnl} className="text-lg font-bold" />
        ) : openCount > 0 ? (
          <Badge variant="warning">{openCount} open</Badge>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {trades.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No trades this day.</p>
        ) : (
          <>
            {closedToday.length > 0 && (
              <>
                {/* Win/loss donut + legend */}
                <div className="flex items-center gap-5">
                  <Donut
                    size={120}
                    stroke={13}
                    segments={[
                      { value: wins.length, color: "var(--profit)", label: "wins" },
                      { value: losses.length, color: "var(--loss)", label: "losses" },
                      { value: scratches.length, color: "var(--surface-2)", label: "flat" },
                    ]}
                  >
                    <div>
                      <div className="font-money text-2xl font-bold leading-none">
                        {winRate != null ? `${winRate}%` : "—"}
                      </div>
                      <div className="mt-1 text-[10px] uppercase tracking-wide text-muted">
                        win rate
                      </div>
                    </div>
                  </Donut>
                  <div className="flex flex-1 flex-col gap-2">
                    <LegendDot color="var(--profit)" n={wins.length} label="won" />
                    <LegendDot color="var(--loss)" n={losses.length} label="lost" />
                    {scratches.length > 0 && (
                      <LegendDot color="var(--surface-2)" n={scratches.length} label="flat" />
                    )}
                    <div className="mt-0.5 text-xs text-muted">
                      {closedToday.length} closed
                      {openCount > 0 ? ` · ${openCount} still open` : ""}
                    </div>
                  </div>
                </div>

                {/* Day stat grid */}
                <div className="grid grid-cols-2 gap-2">
                  <MiniStat icon={TrendingUp} label="Gross P&L">
                    <PnlText value={gross} className="text-sm" />
                  </MiniStat>
                  <MiniStat icon={Receipt} label="Charges">
                    <span className="font-money text-loss">{formatINR(charges)}</span>
                  </MiniStat>
                  {closedToday.length >= 2 && (
                    <>
                      <MiniStat icon={TrendingUp} label="Best">
                        <PnlText value={best} className="text-sm" />
                      </MiniStat>
                      <MiniStat icon={TrendingDown} label="Worst">
                        <PnlText value={worst} className="text-sm" />
                      </MiniStat>
                    </>
                  )}
                </div>
              </>
            )}

            {/* Trades touching this day */}
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                Trades ({trades.length})
              </div>
              <div className="divide-y">
                {trades.map((t) => {
                  const openedToday = istDateKey(t.opened_at) === date;
                  const tag =
                    t.status !== "closed"
                      ? openedToday
                        ? "opened today"
                        : "held"
                      : t.closed_at && istDateKey(t.closed_at) === date
                        ? openedToday
                          ? "intraday"
                          : "closed today"
                        : "opened today";
                  return (
                    <Link
                      key={t.id}
                      href={`/app/trades/${t.id}`}
                      className="-mx-2 flex items-center justify-between gap-3 rounded px-2 py-2 text-sm hover:bg-surface-2"
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{describeInstrument(t)}</span>
                        <span className="text-[11px] text-muted">{tag}</span>
                      </span>
                      {t.status === "closed" ? (
                        <PnlText value={t.net_pnl} />
                      ) : (
                        <Badge variant="warning">open</Badge>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          </>
        )}
        <Button variant="outline" size="sm" asChild className="w-full">
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
  const { data: trades = [] } = useTrades({}, { withTags: false });
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
      <Tabs defaultValue="pnl" className="space-y-4">
        <TabsList>
          <TabsTrigger value="pnl">P&amp;L calendar</TabsTrigger>
          <TabsTrigger value="expiries">Upcoming expiries</TabsTrigger>
        </TabsList>
        <TabsContent value="pnl" className="space-y-4">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous month"
              onClick={() => shift(-1)}
            >
              <ChevronLeft />
            </Button>
            <div className="min-w-[160px] text-center text-sm font-semibold">
              {new Date(year, month).toLocaleDateString("en-IN", {
                month: "long",
                year: "numeric",
              })}
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
        </TabsContent>
        <TabsContent value="expiries">
          <Card>
            <CardContent className="pt-4">
              <UpcomingExpiriesView />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
