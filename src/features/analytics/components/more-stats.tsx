"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Clock, ListOrdered, Gauge, Percent, Boxes, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PnlText } from "@/components/shared/pnl-text";
import { formatINR, formatNumber, formatPct, cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/use-media-query";
import {
  durationBuckets,
  streakLengthDistribution,
  expectancyByConfidence,
  rPercentiles,
  notionalBuckets,
  MIN_SAMPLE,
  type TradeLike,
} from "@/lib/stats/stats";

const CHART_TOOLTIP = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
} as const;

/** A titled card wrapper with a lucide icon and an n-gated empty state. */
function StatCard({
  title,
  icon: Icon,
  empty,
  emptyLabel = "Not enough data yet.",
  children,
}: {
  title: string;
  icon: LucideIcon;
  empty: boolean;
  emptyLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4 text-muted" aria-hidden />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {empty ? <p className="py-8 text-center text-sm text-muted">{emptyLabel}</p> : children}
      </CardContent>
    </Card>
  );
}

/** Hold-duration buckets — count, avg net P&L, win rate per bucket (n≥MIN_SAMPLE). */
function HoldDurationCard({ trades }: { trades: TradeLike[] }) {
  const reduced = useReducedMotion();
  const buckets = useMemo(
    () => durationBuckets(trades).filter((b) => b.trades >= MIN_SAMPLE),
    [trades]
  );
  const aria = `Hold duration, average net profit and loss across ${buckets.length} duration bucket${buckets.length === 1 ? "" : "s"}.`;
  return (
    <StatCard
      title="Hold duration"
      icon={Clock}
      empty={buckets.length === 0}
      emptyLabel={`No hold-duration bucket has ${MIN_SAMPLE}+ trades yet.`}
    >
      <div className="h-44" role="img" aria-label={aria}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={buckets} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="key"
              tick={{ fill: "var(--text-muted)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              interval={0}
            />
            <YAxis
              tick={{ fill: "var(--text-muted)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatINR(v)}
              width={64}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              contentStyle={CHART_TOOLTIP}
              formatter={(value: number | string) => [
                formatINR(Number(value), { signed: true }),
                "Avg P&L",
              ]}
            />
            <Bar dataKey="avgPnl" radius={[4, 4, 0, 0]} isAnimationActive={!reduced}>
              {buckets.map((b) => (
                <Cell
                  key={b.key}
                  fill={b.avgPnl >= 0 ? "var(--profit)" : "var(--loss)"}
                  fillOpacity={0.85}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="divide-y text-xs">
        {buckets.map((b) => (
          <div key={b.key} className="flex items-center justify-between py-1.5">
            <span className="font-medium">{b.key}</span>
            <span className="text-muted">
              {b.trades} trades · {formatPct(b.winRate, 0)} win ·{" "}
              <PnlText value={b.avgPnl} className="text-xs" /> avg
            </span>
          </div>
        ))}
      </div>
    </StatCard>
  );
}

/** Win/loss streak-length distribution histogram (needs MIN_SAMPLE decided trades). */
function StreakLengthCard({ trades }: { trades: TradeLike[] }) {
  const reduced = useReducedMotion();
  const dist = useMemo(() => streakLengthDistribution(trades), [trades]);
  const decided = useMemo(
    () => trades.filter((t) => t.closed_at && t.net_pnl !== 0).length,
    [trades]
  );
  const data = dist.map((r) => ({ label: `${r.length}`, wins: r.wins, losses: r.losses }));
  const aria = `Streak-length distribution: how often runs of N consecutive wins or losses occurred, across ${data.length} run length${data.length === 1 ? "" : "s"}.`;
  return (
    <StatCard
      title="Streak-length distribution"
      icon={ListOrdered}
      empty={data.length === 0 || decided < MIN_SAMPLE}
      emptyLabel={`Need ${MIN_SAMPLE}+ decided trades to chart streak lengths.`}
    >
      <div className="h-44" role="img" aria-label={aria}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--text-muted)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              interval={0}
            />
            <YAxis
              tick={{ fill: "var(--text-muted)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={28}
            />
            <Tooltip cursor={{ fill: "var(--surface-2)" }} contentStyle={CHART_TOOLTIP} />
            <Bar
              dataKey="wins"
              name="Win runs"
              fill="var(--profit)"
              fillOpacity={0.85}
              radius={[3, 3, 0, 0]}
              isAnimationActive={!reduced}
            />
            <Bar
              dataKey="losses"
              name="Loss runs"
              fill="var(--loss)"
              fillOpacity={0.85}
              radius={[3, 3, 0, 0]}
              isAnimationActive={!reduced}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11px] text-muted">
        How often a run of N consecutive wins (green) or losses (red) occurred.
      </p>
    </StatCard>
  );
}

/** Expectancy by confidence rating (1–5) — surfaces over/under-confidence. */
function ConfidenceCard({ trades }: { trades: TradeLike[] }) {
  const bins = useMemo(() => expectancyByConfidence(trades), [trades]);
  const shown = bins.filter((b) => b.enough);
  return (
    <StatCard
      title="Expectancy by confidence"
      icon={Gauge}
      empty={shown.length === 0}
      emptyLabel={
        bins.length === 0
          ? "Rate your trades 1–5 to calibrate confidence."
          : `No confidence rating has ${MIN_SAMPLE}+ trades yet.`
      }
    >
      <div className="space-y-2 text-xs">
        {bins.map((b) => (
          <div
            key={b.confidence}
            className={cn(
              "flex items-center justify-between rounded-md border px-3 py-2",
              !b.enough && "opacity-50"
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              <span className="tabular-nums">{b.confidence}/5</span>
              <span className="text-muted">
                {b.trades} trade{b.trades === 1 ? "" : "s"}
              </span>
            </span>
            {b.enough ? (
              <span className="text-muted">
                {formatPct(b.winRate, 0)} win · <PnlText value={b.expectancy} className="text-xs" />{" "}
                exp.
              </span>
            ) : (
              <span className="text-muted">need {MIN_SAMPLE}</span>
            )}
          </div>
        ))}
      </div>
    </StatCard>
  );
}

/** R-multiple percentiles p10/p25/median/p75/p90. */
function RPercentilesCard({ trades }: { trades: TradeLike[] }) {
  const p = useMemo(() => rPercentiles(trades), [trades]);
  const enough = p != null && p.count >= MIN_SAMPLE;
  const rows: { label: string; value: number }[] = p
    ? [
        { label: "p10", value: p.p10 },
        { label: "p25", value: p.p25 },
        { label: "Median", value: p.median },
        { label: "p75", value: p.p75 },
        { label: "p90", value: p.p90 },
      ]
    : [];
  return (
    <StatCard
      title="R-multiple percentiles"
      icon={Percent}
      empty={!enough}
      emptyLabel={
        p == null
          ? "Set stop losses to build the R distribution."
          : `Only ${p.count} trade${p.count === 1 ? "" : "s"} with R — need ${MIN_SAMPLE}.`
      }
    >
      <div className="grid grid-cols-5 gap-2 text-center">
        {rows.map((r) => (
          <div key={r.label} className="rounded-md border px-1 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted">{r.label}</div>
            <div
              className={cn(
                "font-money text-sm tabular-nums",
                r.value > 0 ? "text-profit" : r.value < 0 ? "text-loss" : ""
              )}
            >
              {formatNumber(r.value, 2)}R
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted">Across {p?.count ?? 0} trades with a defined risk.</p>
    </StatCard>
  );
}

/** Position-size (notional) buckets vs win rate — flags over/under-sizing (n≥MIN_SAMPLE). */
function PositionSizeCard({ trades }: { trades: TradeLike[] }) {
  const reduced = useReducedMotion();
  const all = useMemo(() => notionalBuckets(trades), [trades]);
  const buckets = all.filter((b) => b.trades >= MIN_SAMPLE);
  const aria = `Position size, win rate by notional size across ${buckets.length} size bucket${buckets.length === 1 ? "" : "s"}.`;
  return (
    <StatCard
      title="Position size"
      icon={Boxes}
      empty={buckets.length === 0}
      emptyLabel={
        all.length === 0
          ? "Add quantity and entry price to size-analyse your trades."
          : `No size bucket has ${MIN_SAMPLE}+ trades yet.`
      }
    >
      <div className="h-44" role="img" aria-label={aria}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={buckets} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="key"
              tick={{ fill: "var(--text-muted)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              interval={0}
              angle={buckets.length > 4 ? -30 : 0}
              height={buckets.length > 4 ? 44 : 24}
              textAnchor={buckets.length > 4 ? "end" : "middle"}
            />
            <YAxis
              tick={{ fill: "var(--text-muted)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
              domain={[0, 1]}
              width={36}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              contentStyle={CHART_TOOLTIP}
              formatter={(value: number | string) => [formatPct(Number(value), 0), "Win rate"]}
            />
            <Bar dataKey="winRate" radius={[4, 4, 0, 0]} isAnimationActive={!reduced}>
              {buckets.map((b) => (
                <Cell
                  key={b.key}
                  fill={b.netPnl >= 0 ? "var(--profit)" : "var(--loss)"}
                  fillOpacity={0.85}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="divide-y text-xs">
        {buckets.map((b) => (
          <div key={b.key} className="flex items-center justify-between py-1.5">
            <span className="font-medium">{b.key}</span>
            <span className="text-muted">
              {b.trades} trades · {formatPct(b.winRate, 0)} win ·{" "}
              <PnlText value={b.avgPnl} className="text-xs" /> avg
            </span>
          </div>
        ))}
      </div>
    </StatCard>
  );
}

/** The "More statistics" section — six charts gated at MIN_SAMPLE per bucket. */
export function MoreStats({ trades }: { trades: TradeLike[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <HoldDurationCard trades={trades} />
      <PositionSizeCard trades={trades} />
      <StreakLengthCard trades={trades} />
      <ConfidenceCard trades={trades} />
      <RPercentilesCard trades={trades} />
    </div>
  );
}
