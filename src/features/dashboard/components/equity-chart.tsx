"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/utils";
import { equityCurve, withStartBaseline, closedOnly, type TradeLike } from "@/lib/stats/stats";
import { useReducedMotion } from "@/hooks/use-media-query";
import { equityCurveAriaSummary } from "@/features/analytics/chart-aria";

export function EquityChart({ trades }: { trades: TradeLike[] }) {
  const points = withStartBaseline(equityCurve(closedOnly(trades)));
  const reduced = useReducedMotion();
  if (points.length < 2) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Equity curve</CardTitle>
        </CardHeader>
        <CardContent className="flex h-48 items-center justify-center text-sm text-muted">
          Log a few trades to see your curve.
        </CardContent>
      </Card>
    );
  }
  const last = points[points.length - 1]!.equity;
  const color = last >= 0 ? "var(--profit)" : "var(--loss)";

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Equity curve (cumulative net P&L)</CardTitle>
      </CardHeader>
      <CardContent
        className="h-56 md:h-64 pl-0"
        role="img"
        aria-label={equityCurveAriaSummary(points)}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(d: string) =>
                new Date(d + "T12:00:00").toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                })
              }
              minTickGap={40}
            />
            <YAxis
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatINR(v)}
              width={72}
            />
            <Tooltip
              contentStyle={{
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--text-muted)" }}
              formatter={(value: number | string) => [formatINR(Number(value)), "Equity"]}
            />
            <Area
              type="monotone"
              dataKey="equity"
              stroke={color}
              strokeWidth={1.5}
              fill="url(#equityFill)"
              dot={points.length <= 5 ? { r: 3, fill: color, strokeWidth: 0 } : false}
              isAnimationActive={!reduced}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
