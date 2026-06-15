"use client";

import * as React from "react";
import { BarChart3, Download, ImageDown, Printer } from "lucide-react";
import { useTrades } from "@/features/trades";
import { useAdherence, useMistakeStats } from "@/features/rules";
import {
  closedOnly,
  expectancy,
  netPnl,
  profitFactor,
  winRate,
  maxDrawdown,
  equityCurve,
} from "@/lib/stats/stats";
import { toDateKey } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PnlText } from "@/components/shared/pnl-text";
import { ShareImagePanel } from "@/components/shared/share-image-panel";
import { StatCard, inrFormat } from "@/components/shared/stat-card";
import { TagChip } from "@/components/shared/tag-chip";
import { describeInstrument } from "@/features/trades";
import { downloadFile } from "@/features/settings";
import { buildReportShareCard } from "../share-card";

type PeriodKind = "week" | "month";

function periodRange(
  kind: PeriodKind,
  offset: number
): { from: string; to: string; label: string } {
  const now = new Date();
  if (kind === "week") {
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) - offset * 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      from: toDateKey(monday),
      to: toDateKey(sunday),
      label: `Week of ${monday.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
    };
  }
  const first = new Date(now.getFullYear(), now.getMonth() - offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() - offset + 1, 0);
  return {
    from: toDateKey(first),
    to: toDateKey(last),
    label: first.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
  };
}

export function ReportView() {
  const [kind, setKind] = React.useState<PeriodKind>("week");
  const [offset, setOffset] = React.useState(0);
  const [shareOpen, setShareOpen] = React.useState(false);
  const range = periodRange(kind, offset);
  const { data: trades = [] } = useTrades({ from: range.from, to: range.to });
  const { data: adherence } = useAdherence(range.from, range.to);
  const { data: mistakes = [] } = useMistakeStats(range.from, range.to);

  const closed = closedOnly(trades);
  const sortedByPnl = [...closed].sort((a, b) => b.net_pnl - a.net_pnl);
  const best = sortedByPnl[0];
  const worst = sortedByPnl[sortedByPnl.length - 1];
  const charges = closed.reduce((s, t) => s + t.charges, 0);

  const exportCsv = () => {
    if (closed.length === 0) return;
    const header = "date,instrument,direction,qty,entry,exit,gross,charges,net,r";
    const rows = closed.map((t) =>
      [
        t.opened_at.slice(0, 10),
        describeInstrument(t).replace(/,/g, " "),
        t.direction,
        t.qty,
        t.avg_entry,
        t.avg_exit ?? "",
        t.gross_pnl,
        t.charges,
        t.net_pnl,
        t.r_multiple ?? "",
      ].join(",")
    );
    downloadFile(`trademarkk-report-${range.from}.csv`, [header, ...rows].join("\n"), "text/csv");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Select
          value={kind}
          onValueChange={(v) => {
            setKind(v as PeriodKind);
            setOffset(0);
          }}
        >
          <SelectTrigger className="w-[110px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="week">Weekly</SelectItem>
            <SelectItem value="month">Monthly</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => setOffset(offset + 1)}>
          ← Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 1))}
        >
          Next →
        </Button>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={closed.length === 0}
            onClick={() => setShareOpen(true)}
          >
            <ImageDown className="h-3.5 w-3.5" /> Share image
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" /> PDF / Print
          </Button>
        </div>
      </div>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Share {kind === "week" ? "weekly" : "monthly"} report</DialogTitle>
          </DialogHeader>
          <ShareImagePanel
            allowPnl
            build={(includePnl) =>
              buildReportShareCard(
                { kind, label: range.label, from: range.from, to: range.to, trades: closed },
                { includePnl }
              )
            }
          />
        </DialogContent>
      </Dialog>

      {closed.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted">
            No closed trades in this period.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Headline KPIs — redesign tiles with rolling numbers. */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Net P&L" value={netPnl(closed)} format={inrFormat} tone="auto" />
            <StatCard
              label="Win rate"
              value={winRate(closed) * 100}
              format={{ maximumFractionDigits: 0 }}
              suffix="%"
              sub={`${closed.length} trades`}
            />
            <StatCard
              label="Profit factor"
              value={Number.isFinite(profitFactor(closed)) ? profitFactor(closed) : 0}
              format={{ maximumFractionDigits: 2 }}
              sub={!Number.isFinite(profitFactor(closed)) ? "no losses yet" : undefined}
            />
            <StatCard
              label="Expectancy"
              value={expectancy(closed)}
              format={inrFormat}
              tone="auto"
              sub="per trade"
            />
            <StatCard label="Charges paid" value={charges} format={inrFormat} />
            <StatCard
              label="Max drawdown"
              value={-Math.abs(maxDrawdown(equityCurve(closed)))}
              format={inrFormat}
              tone="auto"
            />
            {adherence && (
              <StatCard
                label="Rule adherence"
                value={adherence.overallPct * 100}
                format={{ maximumFractionDigits: 0 }}
                suffix="%"
              />
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5 text-base">
                <BarChart3 className="h-4 w-4 text-muted" aria-hidden /> {range.label} review
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                {best && (
                  <div className="rounded-lg border p-3">
                    <div className="micro-label mb-1">Best trade</div>
                    <div className="flex justify-between text-sm">
                      <span>{describeInstrument(best)}</span>
                      <PnlText value={best.net_pnl} />
                    </div>
                  </div>
                )}
                {worst && worst !== best && (
                  <div className="rounded-lg border p-3">
                    <div className="micro-label mb-1">Worst trade</div>
                    <div className="flex justify-between text-sm">
                      <span>{describeInstrument(worst)}</span>
                      <PnlText value={worst.net_pnl} />
                    </div>
                  </div>
                )}
              </div>

              {mistakes.length > 0 && (
                <div>
                  <div className="micro-label mb-2">Mistakes this period</div>
                  <div className="space-y-1">
                    {mistakes.map((m) => (
                      <div key={m.tagId} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2">
                          <TagChip name={m.name} color={m.color} />
                          <span className="text-xs text-muted">×{m.count}</span>
                        </span>
                        <PnlText value={m.cost} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
