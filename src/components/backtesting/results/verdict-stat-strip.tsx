"use client";

import * as React from "react";
import { ChevronDown, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn, formatINR } from "@/lib/utils";
import {
  buildStatCards,
  computeStatDeltas,
  type StatCardView,
  type StatDelta,
  type StatKey,
} from "@/features/backtest/results/stat-cards";
import {
  deriveChargesWaterfall,
  waterfallLines,
  type ChargesWaterfall,
} from "@/features/backtest/results/charges-derive";
import type { HeadlineStats, RunResult } from "@/features/backtest/shared/run-result";

/**
 * The 6 StatCards in the R24 lead order (Net P&L → Win% → Max DD → Expectancy →
 * Profit Factor → Sharpe) with TAP-TO-DERIVE. Tapping Net P&L expands the honest
 * gross → net waterfall (the computeCharges breakdown), making every paisa
 * traceable — the moat's centrepiece. When a previous run exists, each card shows
 * its directional delta (the iteration loop).
 *
 * Semantic tokens only; reduced-motion inherits via globals.css.
 */
export function VerdictStatStrip({
  run,
  prevStats,
}: {
  run: RunResult;
  prevStats?: HeadlineStats | null;
}) {
  const cards = React.useMemo(() => buildStatCards(run), [run]);
  const deltas = React.useMemo(
    () => (prevStats ? computeStatDeltas(run.stats, prevStats) : null),
    [run.stats, prevStats]
  );
  const waterfall = React.useMemo(() => deriveChargesWaterfall(run), [run]);
  const [open, setOpen] = React.useState<StatKey | null>(null);
  const deltaByKey = React.useMemo(() => {
    const m = new Map<StatKey, StatDelta>();
    deltas?.forEach((d) => m.set(d.key, d));
    return m;
  }, [deltas]);

  return (
    <div data-testid="bt-stat-strip">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-6">
        {cards.map((card) => (
          <StatTile
            key={card.key}
            card={card}
            delta={deltaByKey.get(card.key) ?? null}
            expanded={open === card.key}
            onToggle={() =>
              card.derivable ? setOpen((cur) => (cur === card.key ? null : card.key)) : undefined
            }
          />
        ))}
      </div>

      {open === "netPnl" && (
        <ChargesWaterfallPanel waterfall={waterfall} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function toneClass(tone: StatCardView["tone"]): string {
  return tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : "text-foreground";
}

function StatTile({
  card,
  delta,
  expanded,
  onToggle,
}: {
  card: StatCardView;
  delta: StatDelta | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-1">
        <span className="bt-label">{card.label}</span>
        {card.derivable && (
          <ChevronDown
            className={cn("h-3.5 w-3.5 text-muted transition-transform", expanded && "rotate-180")}
            aria-hidden
          />
        )}
      </div>
      <div className={cn("bt-num mt-1.5 text-lg md:text-xl", toneClass(card.tone))}>
        {card.value}
      </div>
      <div className="mt-1 flex min-h-4 items-center gap-1.5 text-xs">
        {card.sub && <span className="truncate text-muted">{card.sub}</span>}
        {delta && delta.direction !== "flat" && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-money",
              delta.direction === "up" ? "text-profit" : "text-loss"
            )}
            title="Change vs the previous run"
            data-testid={`bt-delta-${card.key}`}
          >
            {delta.direction === "up" ? (
              <TrendingUp className="h-3 w-3" aria-hidden />
            ) : (
              <TrendingDown className="h-3 w-3" aria-hidden />
            )}
            {delta.display}
          </span>
        )}
        {delta && delta.direction === "flat" && (
          <span
            className="inline-flex items-center gap-0.5 text-muted"
            title="No change vs the previous run"
          >
            <Minus className="h-3 w-3" aria-hidden /> 0
          </span>
        )}
      </div>
    </>
  );

  if (!card.derivable) {
    return (
      <Card className="bt-panel min-w-0 p-3" data-stat-key={card.key}>
        {inner}
      </Card>
    );
  }
  return (
    <Card
      className={cn("bt-panel min-w-0 p-0", expanded && "bt-panel-active")}
      data-stat-key={card.key}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg"
        data-testid={`bt-stat-${card.key}`}
      >
        {inner}
      </button>
    </Card>
  );
}

/** The honest gross → net derivation table for Net P&L. */
function ChargesWaterfallPanel({
  waterfall,
  onClose,
}: {
  waterfall: ChargesWaterfall;
  onClose: () => void;
}) {
  const lines = waterfallLines(waterfall);
  return (
    <div
      className="bt-panel mt-3 bg-surface-2/60 p-4 animate-slide-up"
      data-testid="bt-charges-waterfall"
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="bt-display text-sm font-semibold">How Net P&L is derived</h3>
        <button
          type="button"
          onClick={onClose}
          className="bt-bracket text-xs"
          aria-label="Close derivation"
        >
          Hide
        </button>
      </div>
      <p className="mb-3 text-xs leading-5 text-muted">
        Gross is already net of modelled slippage ({waterfall.slippageLabel}). Charges are the real
        Indian-market costs for {waterfall.brokerId}, summed over every round-trip — every paisa is
        traceable.
      </p>
      <dl className="space-y-1 text-sm">
        {lines.map((l, i) => (
          <div
            key={i}
            className={cn(
              "flex items-center justify-between gap-3 py-0.5",
              l.kind === "total" && "mt-1 border-t pt-2 font-semibold"
            )}
          >
            <dt className={cn(l.kind === "sub" && "pl-3 text-muted")}>{l.label}</dt>
            <dd
              className={cn(
                "font-money tabular-nums",
                l.kind === "total"
                  ? l.value >= 0
                    ? "text-profit"
                    : "text-loss"
                  : l.kind === "sub"
                    ? "text-loss"
                    : "text-foreground"
              )}
            >
              {formatINR(l.value, { signed: l.kind !== "total", decimals: true })}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
