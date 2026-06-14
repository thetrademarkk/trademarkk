"use client";

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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR, formatPct } from "@/lib/utils";
import type { GroupStat } from "@/lib/stats/stats";
import { useReducedMotion } from "@/hooks/use-media-query";
import { groupBarAriaSummary } from "../chart-aria";

/** Net P&L bar chart per group (hour, weekday, setup, instrument…) + stat list. */
export function GroupBar({ title, stats }: { title: string; stats: GroupStat[] }) {
  const reduced = useReducedMotion();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {stats.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">Not enough data yet.</p>
        ) : (
          <>
            <div className="h-44" role="img" aria-label={groupBarAriaSummary(title, stats)}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="key"
                    tick={{ fill: "var(--text-muted)", fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                    angle={stats.length > 7 ? -35 : 0}
                    height={stats.length > 7 ? 50 : 24}
                    textAnchor={stats.length > 7 ? "end" : "middle"}
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
                    contentStyle={{
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value: number | string) => [
                      formatINR(Number(value), { signed: true }),
                      "Net P&L",
                    ]}
                  />
                  <Bar dataKey="netPnl" radius={[4, 4, 0, 0]} isAnimationActive={!reduced}>
                    {stats.map((s) => (
                      <Cell
                        key={s.key}
                        fill={s.netPnl >= 0 ? "var(--profit)" : "var(--loss)"}
                        fillOpacity={0.85}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="divide-y text-xs">
              {stats.map((s) => (
                <div key={s.key} className="flex items-center justify-between py-1.5">
                  <span className="font-medium">{s.key}</span>
                  <span className="text-muted">
                    {s.trades} trades · {formatPct(s.winRate, 0)} win ·{" "}
                    <span className={s.netPnl >= 0 ? "text-profit" : "text-loss"}>
                      {formatINR(s.netPnl, { signed: true })}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
