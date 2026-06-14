"use client";

import { useMemo } from "react";
import { CalendarRange, Hourglass, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PnlText } from "@/components/shared/pnl-text";
import { formatPct, cn } from "@/lib/utils";
import {
  holdingPeriodBuckets,
  tradingStyle,
  MIN_SAMPLE,
  type Horizon,
  type HorizonTradeLike,
} from "@/lib/stats/horizon";

const STYLE_ICON: Record<Horizon, LucideIcon> = {
  intraday: Hourglass,
  swing: CalendarRange,
  positional: CalendarRange,
};

/**
 * One-line "trading style" summary — e.g. "Mostly positional — 68% of trades
 * held >7 days". Renders a neutral empty-state line when there's no data.
 * `compact` drops the card chrome for the dashboard row.
 */
export function TradingStyleSummary({
  trades,
  compact = false,
}: {
  trades: HorizonTradeLike[];
  compact?: boolean;
}) {
  const style = useMemo(() => tradingStyle(trades), [trades]);
  const Icon = style.dominant ? STYLE_ICON[style.dominant] : Hourglass;

  const inner = (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium">Your trading style</p>
        <p className="text-sm text-muted">{style.summary}</p>
        {style.mix.total > 0 && (
          <p className="mt-1 text-xs text-muted">
            {style.mix.intraday} intraday · {style.mix.swing} swing · {style.mix.positional}{" "}
            positional ({style.mix.total} closed)
          </p>
        )}
      </div>
    </div>
  );

  if (compact) {
    return (
      <div className="rounded-lg border bg-surface px-3 py-2" data-testid="trading-style">
        {inner}
      </div>
    );
  }
  return (
    <Card data-testid="trading-style">
      <CardContent className="pt-6">{inner}</CardContent>
    </Card>
  );
}

/**
 * Holding-period buckets — count, net P&L and win rate per horizon (intraday /
 * swing / positional). Each bucket is gated at MIN_SAMPLE: thin buckets are
 * greyed and their win-rate/P&L withheld so we never sell noise as signal.
 */
export function HoldingPeriodCard({ trades }: { trades: HorizonTradeLike[] }) {
  const buckets = useMemo(() => holdingPeriodBuckets(trades), [trades]);
  const anyEnough = buckets.some((b) => b.enough);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarRange className="size-4 text-muted" aria-hidden />
          Holding period
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {buckets.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">
            No closed trades to break down by holding period yet.
          </p>
        ) : (
          <>
            {!anyEnough && (
              <p className="text-xs text-muted">
                No horizon has {MIN_SAMPLE}+ trades yet — counts shown, win rate and P&amp;L stay
                hidden until there&rsquo;s enough.
              </p>
            )}
            <div className="divide-y text-sm">
              {buckets.map((b) => (
                <div
                  key={b.horizon}
                  className={cn(
                    "flex items-center justify-between gap-3 py-2",
                    !b.enough && "opacity-50"
                  )}
                  data-horizon={b.horizon}
                >
                  <span className="font-medium">{b.label}</span>
                  {b.enough ? (
                    <span className="text-muted">
                      {b.trades} trades · {formatPct(b.winRate, 0)} win ·{" "}
                      <PnlText value={b.netPnl} className="text-sm" />
                    </span>
                  ) : (
                    <span className="text-muted">
                      {b.trades} trade{b.trades === 1 ? "" : "s"} · need {MIN_SAMPLE}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
