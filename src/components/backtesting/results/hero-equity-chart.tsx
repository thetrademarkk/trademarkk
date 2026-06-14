"use client";

import * as React from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { formatINR } from "@/lib/utils";
import { buildHeroSeries, type HeroPoint } from "@/features/backtest/results/equity-series";
import type { BenchmarkPoint } from "@/features/backtest/results/benchmark";
import type { EquityPoint } from "@/features/backtest/shared/run-result";

/**
 * The HERO chart: cumulative net-P&L equity (area) with the underwater drawdown
 * area on a shared X axis (TradingView canon — drawdown shaded beneath), plus an
 * opt-in NIFTY buy-&-hold benchmark overlay (dashed). Reuses the app's existing
 * charting dep (Recharts) and the exact equity-gradient idiom from the dashboard
 * equity-chart. Semantic tokens only.
 */
export function HeroEquityChart({
  curve,
  benchmark,
}: {
  curve: EquityPoint[];
  benchmark?: BenchmarkPoint[] | null;
}) {
  const [showBenchmark, setShowBenchmark] = React.useState(true);
  const data = React.useMemo(
    () => mergeSeries(buildHeroSeries(curve), benchmark),
    [curve, benchmark]
  );
  const last = curve.length ? curve[curve.length - 1]!.equity : 0;
  const color = last >= 0 ? "var(--profit)" : "var(--loss)";

  return (
    <Card data-testid="bt-hero-equity">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Equity curve · cumulative net P&L</CardTitle>
        {benchmark && benchmark.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted">
            NIFTY buy &amp; hold
            <Switch
              checked={showBenchmark}
              onCheckedChange={setShowBenchmark}
              aria-label="Toggle NIFTY buy and hold benchmark"
            />
          </label>
        )}
      </CardHeader>
      <CardContent className="h-64 pl-0 md:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="btEquityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="day"
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(d: string) =>
                new Date(d + "T12:00:00").toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                })
              }
              minTickGap={36}
            />
            <YAxis
              yAxisId="equity"
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatINR(v)}
              width={72}
            />
            {/* Hidden secondary axis for the underwater band (always ≤ 0). */}
            <YAxis yAxisId="dd" orientation="right" hide domain={["dataMin", 0]} />
            <Tooltip
              contentStyle={{
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--text-muted)" }}
              labelFormatter={(d) =>
                new Date(String(d) + "T12:00:00").toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })
              }
              formatter={(value: number | string, name: string) => [
                formatINR(Number(value), { decimals: true, signed: true }),
                LABELS[name] ?? name,
              ]}
            />
            <ReferenceLine yAxisId="equity" y={0} stroke="var(--border)" />
            <Area
              yAxisId="dd"
              type="monotone"
              dataKey="drawdown"
              name="drawdown"
              stroke="none"
              fill="var(--loss)"
              fillOpacity={0.12}
              isAnimationActive={false}
            />
            <Area
              yAxisId="equity"
              type="monotone"
              dataKey="equity"
              name="equity"
              stroke={color}
              strokeWidth={1.75}
              fill="url(#btEquityFill)"
              isAnimationActive={false}
            />
            {showBenchmark && benchmark && benchmark.length > 0 && (
              <Line
                yAxisId="equity"
                type="monotone"
                dataKey="benchmark"
                name="benchmark"
                stroke="var(--text-muted)"
                strokeWidth={1.25}
                strokeDasharray="4 4"
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

const LABELS: Record<string, string> = {
  equity: "Equity",
  drawdown: "Drawdown",
  benchmark: "NIFTY B&H",
};

interface MergedRow extends HeroPoint {
  benchmark?: number;
}

function mergeSeries(hero: HeroPoint[], benchmark?: BenchmarkPoint[] | null): MergedRow[] {
  if (!benchmark || benchmark.length === 0) return hero;
  const bm = new Map<number, number>();
  for (const p of benchmark) bm.set(p.ts, p.value);
  return hero.map((h) => ({ ...h, benchmark: bm.get(h.ts) }));
}
