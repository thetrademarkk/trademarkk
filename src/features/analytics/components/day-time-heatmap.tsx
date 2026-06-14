"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dayTimeHeatmap, MIN_SAMPLE, type HeatCell, type TradeLike } from "@/lib/stats/stats";
import { formatINR, formatPct, cn } from "@/lib/utils";
import { heatCellAriaLabel } from "../chart-aria";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type Metric = "pnl" | "win";

/**
 * Weekday × entry-hour heatmap. Plain SVG (no recharts) so it stays light and
 * scales cleanly. Cell colour = net P&L (profit/loss tokens) or win rate.
 * Cells below MIN_SAMPLE are drawn muted with a sample-size hint on hover.
 */
export function DayTimeHeatmap({ trades }: { trades: TradeLike[] }) {
  const [metric, setMetric] = useState<Metric>("pnl");
  const cells = useMemo(() => dayTimeHeatmap(trades), [trades]);

  // Only render the hour columns that actually have trades, so the grid stays
  // tight on mobile instead of showing 24 empty market-closed hours.
  const hours = useMemo(() => {
    const set = new Set(cells.map((c) => c.hour));
    return [...set].sort((a, b) => a - b);
  }, [cells]);

  const byKey = useMemo(() => {
    const m = new Map<string, HeatCell>();
    for (const c of cells) m.set(`${c.weekday}:${c.hour}`, c);
    return m;
  }, [cells]);

  // Symmetric P&L scale so profit/loss intensity is comparable.
  const maxAbsPnl = useMemo(
    () =>
      Math.max(1, ...cells.filter((c) => c.trades >= MIN_SAMPLE).map((c) => Math.abs(c.netPnl))),
    [cells]
  );

  if (cells.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Day × time of day</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted">Not enough data yet.</p>
        </CardContent>
      </Card>
    );
  }

  const cellFill = (c: HeatCell | undefined): string => {
    if (!c) return "var(--surface-2)";
    if (c.trades < MIN_SAMPLE) return "var(--surface-2)";
    if (metric === "win") {
      // 0% → loss tint, 100% → profit tint, 50% → neutral.
      const above = c.winRate >= 0.5;
      const intensity = Math.min(1, Math.abs(c.winRate - 0.5) * 2);
      return above
        ? `color-mix(in srgb, var(--profit) ${Math.round(intensity * 85)}%, var(--surface-2))`
        : `color-mix(in srgb, var(--loss) ${Math.round(intensity * 85)}%, var(--surface-2))`;
    }
    const intensity = Math.min(1, Math.abs(c.netPnl) / maxAbsPnl);
    const token = c.netPnl >= 0 ? "var(--profit)" : "var(--loss)";
    return `color-mix(in srgb, ${token} ${Math.round(intensity * 85)}%, var(--surface-2))`;
  };

  const cellTitle = (c: HeatCell | undefined, wd: number, h: number): string => {
    const slot = `${WEEKDAYS[wd]} ${String(h).padStart(2, "0")}:00`;
    if (!c) return `${slot} — no trades`;
    if (c.trades < MIN_SAMPLE)
      return `${slot} — only ${c.trades} trade${c.trades === 1 ? "" : "s"} (need ${MIN_SAMPLE})`;
    return `${slot} — ${c.trades} trades · ${formatPct(c.winRate, 0)} win · ${formatINR(c.netPnl, { signed: true })}`;
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Day × time of day</CardTitle>
        <div
          className="flex rounded-md border p-0.5 text-xs"
          role="group"
          aria-label="Heatmap metric"
        >
          {(["pnl", "win"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              aria-pressed={metric === m}
              className={cn(
                "rounded px-2 py-0.5 transition-colors",
                metric === m ? "bg-accent-solid text-accent-fg" : "text-muted hover:text-foreground"
              )}
            >
              {m === "pnl" ? "Net P&L" : "Win %"}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <div className="max-w-full overflow-x-auto">
          <table className="border-separate" style={{ borderSpacing: 2 }}>
            <thead>
              <tr>
                <th className="w-8" />
                {hours.map((h) => (
                  <th
                    key={h}
                    className="pb-1 text-center text-[10px] font-normal text-muted tabular-nums"
                  >
                    {String(h).padStart(2, "0")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEEKDAYS.map((label, wd) => {
                // Hide weekend rows when the market never trades them.
                const hasRow = hours.some((h) => byKey.has(`${wd}:${h}`));
                if (!hasRow) return null;
                return (
                  <tr key={wd}>
                    <td className="pr-1 text-right text-[10px] text-muted">{label}</td>
                    {hours.map((h) => {
                      const c = byKey.get(`${wd}:${h}`);
                      // Only cells with trades get an accessible name; empty
                      // market-closed slots stay silent so SR isn't flooded.
                      const ariaLabel = c
                        ? heatCellAriaLabel({
                            weekday: WEEKDAYS[wd]!,
                            hour: h,
                            trades: c.trades,
                            winRate: c.winRate,
                            netPnl: c.netPnl,
                            minSample: MIN_SAMPLE,
                          })
                        : undefined;
                      return (
                        <td key={h} className="p-0">
                          <div
                            title={cellTitle(c, wd, h)}
                            {...(ariaLabel ? { role: "img", "aria-label": ariaLabel } : {})}
                            className="h-6 min-w-6 rounded-sm border border-border/40"
                            style={{ background: cellFill(c) }}
                            data-cell={`${wd}:${h}`}
                            data-trades={c?.trades ?? 0}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted">
          Cells with fewer than {MIN_SAMPLE} trades stay muted. Entry hour is your local time.
        </p>
      </CardContent>
    </Card>
  );
}
