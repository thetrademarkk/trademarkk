"use client";

import { useMemo } from "react";
import { CalendarClock, Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PnlText } from "@/components/shared/pnl-text";
import { formatPct, cn } from "@/lib/utils";
import {
  dteBuckets,
  strategyGroups,
  MIN_SAMPLE,
  type OptionTradeLike,
} from "@/lib/options/analytics";
import type { LegShape } from "@/lib/options/payoff";

export interface OptionsStatsProps {
  /** Closed trades (any segment — non-OPT rows are filtered inside). */
  trades: OptionTradeLike[];
  /** trade id → leg shapes, for multi-leg trades. */
  legsByTrade: Map<string, LegShape[]>;
}

/** DTE-bucket performance: win rate + net P&L by days-to-expiry (n≥MIN_SAMPLE). */
function DteCard({ trades }: { trades: OptionTradeLike[] }) {
  const buckets = useMemo(() => dteBuckets(trades), [trades]);
  const shown = buckets.filter((b) => b.enough);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4 text-muted" aria-hidden />
          Days to expiry
        </CardTitle>
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            {buckets.length === 0
              ? "No options trades with an expiry yet."
              : `No DTE bucket has ${MIN_SAMPLE}+ trades yet.`}
          </p>
        ) : (
          <div className="space-y-2 text-xs" data-testid="dte-buckets">
            {buckets.map((b) => (
              <div
                key={b.bucket}
                data-dte-bucket={b.bucket}
                data-enough={b.enough}
                className={cn(
                  "flex items-center justify-between rounded-md border px-3 py-2",
                  !b.enough && "opacity-50"
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  <span className="tabular-nums">{b.bucket}</span>
                  <span className="text-muted">
                    {b.trades} trade{b.trades === 1 ? "" : "s"}
                  </span>
                </span>
                {b.enough ? (
                  <span className="text-muted">
                    {formatPct(b.winRate, 0)} win · <PnlText value={b.netPnl} className="text-xs" />
                  </span>
                ) : (
                  <span className="text-muted">need {MIN_SAMPLE}</span>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted">
          Days from entry to expiry. 0DTE = traded on expiry day. Reveals theta / expiry bias.
        </p>
      </CardContent>
    </Card>
  );
}

/** Strategy-level grouping: each multi-leg trade collapsed into one named row. */
function StrategyCard({
  trades,
  legsByTrade,
}: {
  trades: OptionTradeLike[];
  legsByTrade: Map<string, LegShape[]>;
}) {
  const groups = useMemo(() => strategyGroups(trades, legsByTrade), [trades, legsByTrade]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="size-4 text-muted" aria-hidden />
          By strategy
        </CardTitle>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No options trades yet.</p>
        ) : (
          <div className="space-y-2 text-xs" data-testid="strategy-groups">
            {groups.map((g) => (
              <div
                key={g.label}
                data-strategy={g.label}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {g.label}
                  {g.multiLeg > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      {g.multiLeg} multi-leg
                    </Badge>
                  )}
                  <span className="text-muted">
                    {g.trades} trade{g.trades === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="text-muted">
                  {formatPct(g.winRate, 0)} win · <PnlText value={g.netPnl} className="text-xs" />
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted">
          Multi-leg trades collapse into one named structure, auto-detected from the legs. Sorted
          by net P&L — your winning strategies surface first.
        </p>
      </CardContent>
    </Card>
  );
}

/** The analytics "Options" tab: DTE buckets + strategy-level grouping. */
export function OptionsStats({ trades, legsByTrade }: OptionsStatsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <StrategyCard trades={trades} legsByTrade={legsByTrade} />
      <DteCard trades={trades} />
    </div>
  );
}
