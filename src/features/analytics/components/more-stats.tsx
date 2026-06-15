"use client";

import { useMemo } from "react";
import { Clock, ListOrdered, Gauge, Percent, Boxes, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PnlText } from "@/components/shared/pnl-text";
import { formatINR, formatNumber, formatPct, cn } from "@/lib/utils";
import {
  durationBuckets,
  streakLengthDistribution,
  expectancyByConfidence,
  rPercentiles,
  notionalBuckets,
  MIN_SAMPLE,
  type TradeLike,
} from "@/lib/stats/stats";

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

/** Horizontal gradient bar row — label + value on top, a track sized to `pct`. */
function BarRow({
  label,
  value,
  pct,
  pos,
  meta,
}: {
  label: string;
  value: string;
  pct: number;
  pos: boolean;
  meta?: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="truncate text-sm font-semibold">{label}</span>
        <span className={cn("shrink-0 font-money text-sm", pos ? "text-profit" : "text-loss")}>
          {value}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn(
            "h-full origin-left rounded-full motion-safe:animate-grow-x",
            pos
              ? "bg-gradient-to-r from-profit/60 to-profit"
              : "bg-gradient-to-r from-loss to-loss/60"
          )}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      {meta && <div className="mt-1 text-[11px] text-muted">{meta}</div>}
    </div>
  );
}

/** Hold-duration buckets — avg net P&L per bucket as gradient bar-rows (n≥MIN_SAMPLE). */
function HoldDurationCard({ trades }: { trades: TradeLike[] }) {
  const buckets = useMemo(
    () => durationBuckets(trades).filter((b) => b.trades >= MIN_SAMPLE),
    [trades]
  );
  const max = Math.max(...buckets.map((b) => Math.abs(b.avgPnl)), 1);
  const aria = `Hold duration, average net profit and loss across ${buckets.length} duration bucket${buckets.length === 1 ? "" : "s"}.`;
  return (
    <StatCard
      title="Hold duration"
      icon={Clock}
      empty={buckets.length === 0}
      emptyLabel={`No hold-duration bucket has ${MIN_SAMPLE}+ trades yet.`}
    >
      <div className="space-y-3.5" role="img" aria-label={aria}>
        {buckets.map((b) => (
          <BarRow
            key={b.key}
            label={b.key}
            value={formatINR(b.avgPnl, { signed: true })}
            pct={(Math.abs(b.avgPnl) / max) * 100}
            pos={b.avgPnl >= 0}
            meta={`${b.trades} trades · ${formatPct(b.winRate, 0)} win`}
          />
        ))}
      </div>
    </StatCard>
  );
}

/** Win/loss streak-length distribution — paired gradient columns per run length. */
function StreakLengthCard({ trades }: { trades: TradeLike[] }) {
  const dist = useMemo(() => streakLengthDistribution(trades), [trades]);
  const decided = useMemo(
    () => trades.filter((t) => t.closed_at && t.net_pnl !== 0).length,
    [trades]
  );
  const data = dist.map((r) => ({ label: `${r.length}`, wins: r.wins, losses: r.losses }));
  const max = Math.max(...data.flatMap((d) => [d.wins, d.losses]), 1);
  const aria = `Streak-length distribution: how often runs of N consecutive wins or losses occurred, across ${data.length} run length${data.length === 1 ? "" : "s"}.`;
  return (
    <StatCard
      title="Streak-length distribution"
      icon={ListOrdered}
      empty={data.length === 0 || decided < MIN_SAMPLE}
      emptyLabel={`Need ${MIN_SAMPLE}+ decided trades to chart streak lengths.`}
    >
      <div className="flex h-44 items-end gap-2" role="img" aria-label={aria}>
        {data.map((d) => (
          <div
            key={d.label}
            className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
          >
            <div className="flex w-full flex-1 items-end justify-center gap-1">
              <div
                className="w-1/2 origin-bottom rounded-t-[4px] bg-gradient-to-t from-profit to-profit/55 motion-safe:animate-grow-y"
                style={{ height: `${(d.wins / max) * 100}%` }}
                title={`${d.wins} win run${d.wins === 1 ? "" : "s"}`}
              />
              <div
                className="w-1/2 origin-bottom rounded-t-[4px] bg-gradient-to-t from-loss to-loss/55 motion-safe:animate-grow-y"
                style={{ height: `${(d.losses / max) * 100}%` }}
                title={`${d.losses} loss run${d.losses === 1 ? "" : "s"}`}
              />
            </div>
            <span className="font-money text-[10px] text-muted">{d.label}</span>
          </div>
        ))}
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
      <div className="space-y-3.5" role="img" aria-label={aria}>
        {buckets.map((b) => (
          <BarRow
            key={b.key}
            label={b.key}
            value={formatPct(b.winRate, 0)}
            pct={b.winRate * 100}
            pos={b.netPnl >= 0}
            meta={`${b.trades} trades · ${formatINR(b.avgPnl, { signed: true })} avg`}
          />
        ))}
      </div>
    </StatCard>
  );
}

/** The "More statistics" section — six panels gated at MIN_SAMPLE per bucket. */
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
