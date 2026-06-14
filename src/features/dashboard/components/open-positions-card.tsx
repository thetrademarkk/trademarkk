"use client";

import Link from "next/link";
import { Layers, Timer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { describeInstrument, type TradeWithMeta } from "@/features/trades";
import { openPositions, openPositionsSummary } from "@/lib/stats/open-positions";
import { formatINR, cn } from "@/lib/utils";

const dayLabel = (d: number) => (d <= 0 ? "today" : `${d}d held`);

/**
 * Open-positions card (SEG-06) — the still-open trades that intraday day-stats
 * never surface: how many are live, the total cost-basis exposure (never a
 * marked value — we have no live prices) and how long each has been held. The
 * adaptive dashboard promotes this card for swing/positional traders. Empty
 * state is explicit so a flat-at-EOD intraday trader sees a clean "all square".
 */
export function OpenPositionsCard({ trades }: { trades: TradeWithMeta[] }) {
  const positions = openPositions(trades);
  const summary = openPositionsSummary(trades);
  const byId = new Map(trades.map((t) => [t.id, t]));

  return (
    <Card data-testid="open-positions">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Layers className="size-4 text-muted" aria-hidden />
          Open positions
        </CardTitle>
        {summary.count > 0 && (
          <span className="text-sm font-semibold" data-open-count>
            {summary.count}
          </span>
        )}
      </CardHeader>
      <CardContent>
        {summary.count === 0 ? (
          <EmptyState
            icon={Timer}
            title="No open positions"
            description="Every trade is squared off — nothing carrying overnight risk."
            className="border-0 py-8"
          />
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-surface-2 px-2 py-2">
                <div className="micro-label">Exposure</div>
                <div className="mt-0.5 font-money text-sm font-semibold" data-exposure>
                  {formatINR(summary.totalExposure)}
                </div>
                <div className="text-[10px] text-muted">cost basis</div>
              </div>
              <div className="rounded-lg bg-surface-2 px-2 py-2">
                <div className="micro-label">Longest held</div>
                <div className="mt-0.5 font-money text-sm font-semibold" data-max-held>
                  {summary.maxDaysHeld}d
                </div>
                <div className="text-[10px] text-muted">avg {summary.avgDaysHeld}d</div>
              </div>
              <div className="rounded-lg bg-surface-2 px-2 py-2">
                <div className="micro-label">Over a week</div>
                <div className="mt-0.5 font-money text-sm font-semibold">{summary.overWeek}</div>
                <div className="text-[10px] text-muted">{">7d"} old</div>
              </div>
            </div>
            <div className="divide-y">
              {positions.slice(0, 6).map((p) => {
                const t = byId.get(p.id);
                return (
                  <Link
                    key={p.id}
                    href={`/app/trades/${p.id}`}
                    className="-mx-2 flex items-center justify-between gap-2 rounded px-2 py-2 text-sm hover:bg-surface-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">
                        {t ? describeInstrument(t) : p.symbol}
                      </span>
                      <Badge variant={p.direction === "short" ? "warning" : "default"}>
                        {p.direction}
                      </Badge>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-money text-xs",
                        p.daysHeld > 7 ? "text-loss" : "text-muted"
                      )}
                    >
                      {dayLabel(p.daysHeld)}
                    </span>
                  </Link>
                );
              })}
            </div>
            {positions.length > 6 && (
              <Link href="/app/trades" className="block text-xs text-accent hover:underline">
                View all {positions.length} open positions →
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
