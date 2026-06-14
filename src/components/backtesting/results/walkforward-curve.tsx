"use client";

import * as React from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatINR } from "@/lib/utils";
import type { WalkForwardCurvePoint } from "@/lib/backtest/walkforward";

/**
 * The two-color IN-SAMPLE / OUT-OF-SAMPLE equity curve. Reuses the SAME Recharts
 * ComposedChart idiom as the hero chart (no new charting dep): cumulative equity
 * split at the train→test boundary, in-sample shaded with the accent token and
 * out-of-sample shaded with a distinct token. A reference line marks the split.
 * Semantic tokens only; no animation so e2e never waits on a transition.
 */
export function WalkForwardCurve({ curve }: { curve: WalkForwardCurvePoint[] }) {
  const boundaryDay = React.useMemo(() => curve.find((p) => p.boundary)?.day, [curve]);

  return (
    <div className="h-56 w-full" data-testid="bt-wf-curve">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={curve} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="wfIsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-solid)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--accent-solid)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="wfOosFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--profit)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--profit)" stopOpacity={0} />
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
              name === "isEquity" ? "In-sample" : "Out-of-sample",
            ]}
          />
          <ReferenceLine y={0} stroke="var(--border)" />
          {boundaryDay && (
            <ReferenceLine
              x={boundaryDay}
              stroke="var(--text-muted)"
              strokeDasharray="4 4"
              label={{
                value: "OOS →",
                position: "insideTopRight",
                fill: "var(--text-muted)",
                fontSize: 10,
              }}
            />
          )}
          <Area
            type="monotone"
            dataKey="isEquity"
            name="isEquity"
            stroke="var(--accent-solid)"
            strokeWidth={1.75}
            fill="url(#wfIsFill)"
            isAnimationActive={false}
            connectNulls={false}
          />
          <Area
            type="monotone"
            dataKey="oosEquity"
            name="oosEquity"
            stroke="var(--profit)"
            strokeWidth={1.75}
            fill="url(#wfOosFill)"
            isAnimationActive={false}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
