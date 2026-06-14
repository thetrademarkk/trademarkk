"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  Crosshair,
  Gauge,
  Minus,
  Scale,
  ShieldCheck,
  Target,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PnlText } from "@/components/shared/pnl-text";
import { cn, formatPct } from "@/lib/utils";
import { disciplineTrendAriaSummary } from "@/features/analytics/chart-aria";
import { MIN_SAMPLE } from "../compute";
import {
  MIN_TREND_DAYS,
  type ConfidenceCalibration,
  type DisciplineTrend,
  type ExitResolution,
  type PlanAdherenceSummary,
} from "../discipline";

const CHART_TOOLTIP = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
} as const;

const scoreToneClass = (s: number) => (s >= 80 ? "text-profit" : s >= 55 ? "" : "text-loss");

const shortDay = (d: string) =>
  new Date(d + "T12:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

/** A titled card with a lucide icon and an n-gated empty state. */
function SectionCard({
  title,
  icon: Icon,
  insightId,
  empty,
  emptyLabel,
  children,
}: {
  title: string;
  icon: LucideIcon;
  insightId: string;
  empty: boolean;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Card data-insight={insightId}>
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

const DIRECTION_META = {
  improving: { icon: ArrowUpRight, label: "improving", tone: "text-profit" },
  declining: { icon: ArrowDownRight, label: "declining", tone: "text-loss" },
  steady: { icon: Minus, label: "steady", tone: "text-muted" },
} as const;

/** Per-day discipline score: big current number, 7-day direction, trend line. */
function ScoreTrendCard({ trend }: { trend: DisciplineTrend }) {
  const data = useMemo(
    () => trend.days.map((d) => ({ date: d.date, score: d.score })),
    [trend.days]
  );
  const enough = trend.days.length >= MIN_TREND_DAYS;
  const dir = trend.direction ? DIRECTION_META[trend.direction] : null;
  const DirIcon = dir?.icon;

  return (
    <SectionCard
      title="Discipline score"
      icon={ShieldCheck}
      insightId="discipline-score"
      empty={!enough}
      emptyLabel={`Need at least ${MIN_TREND_DAYS} trading days to chart a discipline trend.`}
    >
      <div className="flex items-end justify-between gap-3">
        <div>
          <div
            className={cn(
              "font-money text-4xl leading-none tabular-nums",
              scoreToneClass(trend.current ?? 0)
            )}
            data-discipline-current={trend.current ?? ""}
          >
            {trend.current ?? "—"}
          </div>
          <p className="mt-1 text-xs text-muted">Latest day · /100</p>
        </div>
        {dir && DirIcon && (
          <div className={cn("flex items-center gap-1 text-sm font-medium", dir.tone)}>
            <DirIcon className="size-4" aria-hidden />
            <span>
              {dir.label}
              {trend.delta != null && trend.delta !== 0
                ? ` ${trend.delta > 0 ? "+" : ""}${trend.delta}`
                : ""}
            </span>
          </div>
        )}
      </div>

      <div className="h-40" role="img" aria-label={disciplineTrendAriaSummary(data, trend.average)}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: "var(--text-muted)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={shortDay}
              minTickGap={28}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 50, 100]}
              tick={{ fill: "var(--text-muted)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={28}
            />
            <ReferenceLine y={trend.average ?? 0} stroke="var(--border)" strokeDasharray="4 4" />
            <Tooltip
              cursor={{ stroke: "var(--border)" }}
              contentStyle={CHART_TOOLTIP}
              labelFormatter={shortDay}
              formatter={(value: number | string) => [`${value}/100`, "Score"]}
            />
            <Line
              type="monotone"
              dataKey="score"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <dl className="flex items-center justify-between border-t pt-3 text-xs">
        <div>
          <dt className="text-muted">Average</dt>
          <dd className={cn("font-money tabular-nums", scoreToneClass(trend.average ?? 0))}>
            {trend.average ?? "—"}
          </dd>
        </div>
        <div className="text-right">
          <dt className="text-muted">Days scored</dt>
          <dd className="font-money tabular-nums">{trend.days.length}</dd>
        </div>
      </dl>
      <p className="text-[11px] text-muted">
        100 = a clean day. Each broken rule, mistake/emotion tag and tilt trigger costs points,
        normalised by the day&apos;s trade count.
      </p>
    </SectionCard>
  );
}

const EXIT_META: Record<ExitResolution, { label: string; tone: string }> = {
  target: { label: "Hit target", tone: "text-profit" },
  cut: { label: "Cut early", tone: "" },
  stop: { label: "Hit stop", tone: "text-loss" },
  gaveBack: { label: "Loosened stop", tone: "text-loss" },
};

/** Plan adherence — entry slippage + exit resolution mix for planned trades. */
function PlanAdherenceCard({ summary }: { summary: PlanAdherenceSummary | null }) {
  const bars: { kind: ExitResolution; count: number }[] = summary
    ? [
        { kind: "target", count: summary.targets },
        { kind: "cut", count: summary.cutEarly },
        { kind: "gaveBack", count: summary.gaveBack },
        { kind: "stop", count: summary.stops },
      ]
    : [];
  return (
    <SectionCard
      title="Plan adherence"
      icon={Target}
      insightId="plan-adherence"
      empty={summary == null}
      emptyLabel={`Set planned entry, stop and target on at least ${MIN_SAMPLE} closed trades to grade your execution.`}
    >
      {summary && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md border p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted">
                <Crosshair className="size-3.5" aria-hidden />
                Reached target
              </div>
              <div
                className={cn(
                  "mt-1 font-money text-2xl tabular-nums",
                  scoreToneClass(summary.targetRate * 100)
                )}
                data-plan-target-rate={Math.round(summary.targetRate * 100)}
              >
                {formatPct(summary.targetRate, 0)}
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted">
                <Scale className="size-3.5" aria-hidden />
                Clean entries
              </div>
              <div className="mt-1 font-money text-2xl tabular-nums">
                {formatPct(summary.cleanEntryRate, 0)}
              </div>
            </div>
          </div>

          <div className="space-y-1.5 border-t pt-3 text-xs">
            {bars.map((b) => (
              <div key={b.kind} className="flex items-center justify-between gap-3">
                <span className={cn("min-w-0 truncate", EXIT_META[b.kind].tone)}>
                  {EXIT_META[b.kind].label}
                </span>
                <span className="shrink-0 text-muted">
                  {b.count} · {formatPct(b.count / summary.count, 0)}
                </span>
              </div>
            ))}
          </div>

          {summary.avgEntrySlippagePctOfRisk != null && (
            <p className="border-t pt-3 text-[11px] text-muted">
              Entries average{" "}
              <span
                className={cn(
                  "font-money",
                  summary.avgEntrySlippagePctOfRisk >= 0 ? "text-profit" : "text-loss"
                )}
              >
                {formatPct(summary.avgEntrySlippagePctOfRisk, 0)}
              </span>{" "}
              of planned risk vs your planned price ({summary.count} planned trades).
            </p>
          )}
        </>
      )}
    </SectionCard>
  );
}

const CALIB_META = {
  overconfident: { label: "Overconfident", tone: "text-loss" },
  underconfident: { label: "Underconfident", tone: "text-accent-solid" },
  calibrated: { label: "Calibrated", tone: "text-profit" },
} as const;

/** Confidence calibration — win%/expectancy by 1–5 rating + over/under flags. */
function CalibrationCard({ calibration }: { calibration: ConfidenceCalibration }) {
  return (
    <SectionCard
      title="Confidence calibration"
      icon={Gauge}
      insightId="confidence-calibration"
      empty={!calibration.hasSignal}
      emptyLabel={
        calibration.bins.length === 0
          ? "Rate your trades 1–5 to calibrate your confidence against results."
          : `No confidence rating has ${MIN_SAMPLE}+ trades yet.`
      }
    >
      {calibration.hasSignal && (
        <>
          <div className="space-y-2 text-xs">
            {calibration.bins.map((b) => {
              const meta = b.flag ? CALIB_META[b.flag] : null;
              return (
                <div
                  key={b.confidence}
                  data-calibration-bin={b.confidence}
                  data-calibration-flag={b.flag ?? ""}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-md border px-3 py-2",
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
                    <span className="flex items-center gap-2 text-muted">
                      <span>{formatPct(b.winRate, 0)} win</span>
                      <PnlText value={b.expectancy} className="text-xs" />
                      {meta && <span className={cn("font-medium", meta.tone)}>{meta.label}</span>}
                    </span>
                  ) : (
                    <span className="text-muted">need {MIN_SAMPLE}</span>
                  )}
                </div>
              );
            })}
          </div>
          {calibration.overconfident.length > 0 && (
            <p className="border-t pt-3 text-[11px] text-loss">
              High-confidence trades (
              {calibration.overconfident.map((b) => `${b.confidence}/5`).join(", ")}) are winning
              under half the time — confidence isn&apos;t matching results.
            </p>
          )}
          {calibration.underconfident.length > 0 && (
            <p className="text-[11px] text-muted">
              You under-rate your edge: low-confidence trades (
              {calibration.underconfident.map((b) => `${b.confidence}/5`).join(", ")}) are winning
              comfortably.
            </p>
          )}
        </>
      )}
    </SectionCard>
  );
}

/**
 * Discipline & psychology v2 — the three sections rendered on /app/insights:
 * per-day discipline score trend, plan adherence, and confidence calibration.
 */
export function DisciplineSection({
  trend,
  plan,
  calibration,
}: {
  trend: DisciplineTrend;
  plan: PlanAdherenceSummary | null;
  calibration: ConfidenceCalibration;
}) {
  return (
    <section className="space-y-3 pt-2" aria-labelledby="discipline">
      <div className="flex items-center gap-2">
        <TrendingUp className="size-4 text-muted" aria-hidden />
        <h2 id="discipline" className="text-sm font-semibold">
          Discipline &amp; psychology
        </h2>
      </div>
      <p className="text-xs text-muted">
        How well you followed your own process — a daily discipline score, how closely you stuck to
        your trade plans, and whether your confidence matches your results.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <ScoreTrendCard trend={trend} />
        <PlanAdherenceCard summary={plan} />
        <CalibrationCard calibration={calibration} />
      </div>
    </section>
  );
}
