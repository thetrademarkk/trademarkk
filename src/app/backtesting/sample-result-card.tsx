"use client";

import * as React from "react";
import { Activity, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatINR } from "@/lib/utils";
import type { QualityChip, RunResult } from "@/features/backtest/shared";

/** Map a quality-chip level to a semantic Badge variant (no raw hex). */
function chipVariant(level: QualityChip["level"]): "profit" | "warning" | "loss" {
  return level === "good" ? "profit" : level === "warning" ? "warning" : "loss";
}

/** A tiny inline SVG equity sparkline — pure, no chart lib, no animation. */
function Sparkline({ points }: { points: { ts: number; equity: number }[] }) {
  if (points.length < 2) return null;
  const w = 320;
  const h = 64;
  const xs = points.map((p) => p.equity);
  const min = Math.min(...xs, 0);
  const max = Math.max(...xs, 0);
  const span = max - min || 1;
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p.equity - min) / span) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = points[points.length - 1]!.equity;
  const up = last >= 0;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-16 w-full"
      role="img"
      aria-label={`Sample equity curve ending at ${formatINR(last, { signed: true })}`}
      preserveAspectRatio="none"
    >
      <path
        d={path}
        fill="none"
        strokeWidth={2}
        className={up ? "stroke-profit" : "stroke-loss"}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "profit" | "loss" | "default";
}) {
  return (
    <div className="rounded-lg border bg-surface px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-sm font-semibold tabular-nums",
          tone === "profit" && "text-profit",
          tone === "loss" && "text-loss"
        )}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Reusable result card rendering a RunResult. On the landing it shows the
 * PRE-BAKED sample (instant, zero WASM). It leads with the coverage-honesty
 * chips, then the 6 headline stats and a sparkline — verdict → evidence in
 * miniature. All colors are semantic tokens so the 4 themes + colorblind +
 * reduced-motion inherit for free.
 */
export function SampleResultCard({ run, sample = false }: { run: RunResult; sample?: boolean }) {
  const s = run.stats;
  return (
    <div className="rounded-2xl border bg-surface-2 p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-accent" aria-hidden />
          <span className="text-sm font-semibold">{run.config.name}</span>
          {sample && (
            <Badge variant="secondary" className="uppercase tracking-wide">
              Sample
            </Badge>
          )}
        </div>
        <span className="text-[11px] text-muted">
          {run.config.market.symbol} · {run.config.market.dateRange.start} →{" "}
          {run.config.market.dateRange.end}
        </span>
      </div>

      {/* Honesty layer — quiet by default, loud on problems. */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5 text-muted" aria-hidden />
        {run.qualityChips.map((c, i) => (
          <Badge key={i} variant={chipVariant(c.level)}>
            {c.label}
          </Badge>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat
          label="Net P&L"
          value={formatINR(s.netPnl, { signed: true })}
          tone={s.netPnl >= 0 ? "profit" : "loss"}
        />
        <Stat label="Win rate" value={`${Math.round(s.winRate * 100)}%`} />
        <Stat label="Max drawdown" value={formatINR(s.maxDrawdown)} tone="loss" />
        <Stat label="Expectancy" value={`${formatINR(s.expectancy, { signed: true })}/trade`} />
        <Stat label="Profit factor" value={s.profitFactor.toFixed(2)} />
        <Stat label="Sharpe" value={s.sharpe.toFixed(2)} />
      </div>

      <div className="mt-4 rounded-lg border bg-surface p-3">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted">
          {s.netPnl >= 0 ? (
            <TrendingUp className="h-3.5 w-3.5 text-profit" aria-hidden />
          ) : (
            <TrendingDown className="h-3.5 w-3.5 text-loss" aria-hidden />
          )}
          Equity curve
        </div>
        <Sparkline points={run.equityCurve} />
      </div>
    </div>
  );
}
