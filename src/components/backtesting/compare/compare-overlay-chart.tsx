"use client";

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatINR } from "@/lib/utils";
import type { OverlayPoint } from "@/features/backtest/journal-compare/compare";
import { compareOverlayAriaSummary } from "@/features/analytics/chart-aria";

/**
 * The two-color REAL (your journaled trading) vs BASELINE (mechanical backtest)
 * cumulative-equity overlay. Reuses the SAME Recharts ComposedChart idiom as the
 * BT-11 walk-forward curve (no new charting dep): two cumulative lines on a
 * shared rupee axis over the union of trading days, `connectNulls` so a line
 * simply starts once that side has its first day.
 *
 * Descriptive only — the colours distinguish the two streams, they do NOT imply
 * one is "right". Real = accent (the journal is the hero); baseline = muted.
 * Semantic tokens only; animation off so e2e never waits on a transition.
 */
export function CompareOverlayChart({ overlay }: { overlay: OverlayPoint[] }) {
  return (
    <div
      className="h-56 w-full"
      data-testid="bt-compare-overlay"
      role="img"
      aria-label={compareOverlayAriaSummary(overlay)}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={overlay} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
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
            labelFormatter={(d) =>
              new Date(String(d) + "T12:00:00").toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })
            }
            formatter={(value: number | string, name: string) => [
              formatINR(Number(value), { decimals: true, signed: true }),
              name === "real" ? "Your trading" : "Mechanical baseline",
            ]}
          />
          <ReferenceLine y={0} stroke="var(--border)" />
          <Line
            type="monotone"
            dataKey="baseline"
            name="baseline"
            stroke="var(--text-muted)"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="real"
            name="real"
            stroke="var(--accent-solid)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
