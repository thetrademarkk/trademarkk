"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR, formatPct, cn } from "@/lib/utils";
import type { GroupStat } from "@/lib/stats/stats";
import { groupBarAriaSummary } from "../chart-aria";

/**
 * Net P&L per group (hour, weekday, setup, instrument…) as horizontal bars —
 * label + signed value on top, a gradient track sized to |net| vs the row max,
 * and a trades/win-rate meta line. Profit bars run green, losses red.
 */
export function GroupBar({ title, stats }: { title: string; stats: GroupStat[] }) {
  const max = Math.max(...stats.map((s) => Math.abs(s.netPnl)), 1);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {stats.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">Not enough data yet.</p>
        ) : (
          <div className="space-y-3.5" role="img" aria-label={groupBarAriaSummary(title, stats)}>
            {stats.map((s) => {
              const pos = s.netPnl >= 0;
              const pct = (Math.abs(s.netPnl) / max) * 100;
              return (
                <div key={s.key}>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-semibold">{s.key}</span>
                    <span
                      className={cn(
                        "shrink-0 font-money text-sm",
                        pos ? "text-profit" : "text-loss"
                      )}
                    >
                      {formatINR(s.netPnl, { signed: true })}
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
                  <div className="mt-1 text-[11px] text-muted">
                    {s.trades} trades · {formatPct(s.winRate, 0)} win
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
