"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Small, token-themed trend charts shared by the public Pulse page and the
 * admin overview. Data is always a zero-filled daily series (see
 * lib/pulse-stats) so gaps read as honest flat lines, never skipped days.
 */

const tickStyle = { fill: "var(--text-muted)", fontSize: 11 };
const tooltipStyle = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
} as const;

const shortDay = (d: string) =>
  new Date(d + "T12:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

export function DailyBars({
  data,
  name,
  color = "var(--accent)",
  height = 180,
}: {
  data: { day: string; count: number }[];
  name: string;
  color?: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="day"
          tick={tickStyle}
          tickLine={false}
          axisLine={false}
          tickFormatter={shortDay}
          minTickGap={32}
        />
        <YAxis tick={tickStyle} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
        <Tooltip
          cursor={{ fill: "color-mix(in srgb, var(--accent) 8%, transparent)" }}
          contentStyle={tooltipStyle}
          labelStyle={{ color: "var(--text-muted)" }}
          labelFormatter={shortDay}
          formatter={(value: number | string) => [Number(value).toLocaleString("en-IN"), name]}
        />
        <Bar dataKey="count" fill={color} fillOpacity={0.75} radius={[3, 3, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DailyViewsArea({
  data,
  height = 180,
}: {
  data: { day: string; views: number; actives: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="pulseViewsFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="day"
          tick={tickStyle}
          tickLine={false}
          axisLine={false}
          tickFormatter={shortDay}
          minTickGap={32}
        />
        <YAxis tick={tickStyle} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={{ color: "var(--text-muted)" }}
          labelFormatter={shortDay}
          formatter={(value: number | string, key) => [
            Number(value).toLocaleString("en-IN"),
            key === "views" ? "Page views" : "Signed-in visitors",
          ]}
        />
        <Area
          type="monotone"
          dataKey="views"
          stroke="var(--accent)"
          strokeWidth={1.5}
          fill="url(#pulseViewsFill)"
        />
        <Area
          type="monotone"
          dataKey="actives"
          stroke="var(--profit)"
          strokeWidth={1.5}
          fill="transparent"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
