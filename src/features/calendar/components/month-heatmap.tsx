"use client";

import * as React from "react";
import { cn, formatINR, toDateKey } from "@/lib/utils";
import { calendarCellAriaLabel } from "@/features/analytics/chart-aria";
import { spanCoverage } from "@/lib/calendar/position-spans";
import type { HorizonTradeLike } from "@/lib/stats/horizon";

const WEEKDAY_HEADERS = ["M", "T", "W", "T", "F", "S", "S"];

interface MonthHeatmapProps {
  year: number;
  month: number; // 0-based
  dailyPnl: Map<string, number>;
  journaledDates?: Set<string>;
  /**
   * All trades — used to derive position-hold spans (SEG-06). A multi-day
   * (swing/positional) trade marks every day it was held; a still-open trade
   * marks every day from open through today. P&L still lands only on the close
   * day (it comes from `dailyPnl`), so the span is purely a hold indicator and
   * is never double-counted.
   */
  trades?: HorizonTradeLike[];
  selected?: string | null;
  onSelect?: (dateKey: string) => void;
  compact?: boolean;
}

/** Month grid heatmap — cell intensity scales with |day P&L|; hold spans overlaid. */
export function MonthHeatmap({
  year,
  month,
  dailyPnl,
  journaledDates,
  trades,
  selected,
  onSelect,
  compact,
}: MonthHeatmapProps) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday-start
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayK = toDateKey(new Date());
  const maxAbs = Math.max(1, ...[...dailyPnl.values()].map((v) => Math.abs(v)));

  // Position-hold spans (memoised — derives over the whole trade list).
  const coverage = React.useMemo(
    () => (trades && trades.length ? spanCoverage(trades) : new Map()),
    [trades]
  );
  const hasSpans = coverage.size > 0;

  const cells: (string | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => toDateKey(new Date(year, month, i + 1))),
  ];

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_HEADERS.map((d, i) => (
          <div key={i} className="micro-label py-1">
            {d}
          </div>
        ))}
        {cells.map((key, i) => {
          if (!key) return <div key={`empty-${i}`} />;
          const pnl = dailyPnl.get(key);
          const cov = coverage.get(key);
          const intensity = pnl != null ? Math.max(0.18, Math.abs(pnl) / maxAbs) : 0;
          const bg =
            pnl == null
              ? undefined
              : pnl >= 0
                ? `color-mix(in srgb, var(--profit) ${Math.round(intensity * 45)}%, transparent)`
                : `color-mix(in srgb, var(--loss) ${Math.round(intensity * 45)}%, transparent)`;
          const titleBits = [pnl != null ? `${key}: ${formatINR(pnl, { signed: true })}` : key];
          if (cov?.held) titleBits.push(`held: ${cov.held}`);
          if (cov?.open) titleBits.push(`open: ${cov.open}`);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect?.(key)}
              title={titleBits.join(" · ")}
              aria-label={
                journaledDates?.has(key)
                  ? `${calendarCellAriaLabel(key, pnl)} — journalled`
                  : calendarCellAriaLabel(key, pnl)
              }
              data-held={cov?.held ? "true" : undefined}
              data-open-span={cov?.open ? "true" : undefined}
              className={cn(
                "relative rounded-md border text-xs transition-colors",
                compact ? "h-9" : "h-12 md:h-16",
                key === todayK && "ring-1 ring-accent",
                selected === key && "ring-2 ring-accent",
                pnl == null && "text-muted hover:bg-surface-2"
              )}
              style={{ backgroundColor: bg }}
            >
              <span className="absolute left-1 top-0.5 opacity-70">{Number(key.slice(8))}</span>
              {!compact && pnl != null && (
                <span
                  className={cn(
                    "absolute inset-x-0 bottom-1 font-money text-[10px] md:text-[11px]",
                    pnl >= 0 ? "text-profit" : "text-loss"
                  )}
                >
                  {formatINR(pnl)}
                </span>
              )}
              {journaledDates?.has(key) && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />
              )}
              {/* Hold-span underline: a closed multi-day position (muted) or a
                  still-open one (accent, pulsing) was live this day. */}
              {(cov?.held || cov?.open) && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-x-1 bottom-0.5 h-1 rounded-full",
                    cov?.open ? "bg-accent" : "bg-muted/60"
                  )}
                />
              )}
            </button>
          );
        })}
      </div>
      {hasSpans && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
          <span className="flex items-center gap-1">
            <span className="h-1 w-3 rounded-full bg-muted/60" aria-hidden /> held (multi-day)
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1 w-3 rounded-full bg-accent" aria-hidden /> open position
          </span>
        </div>
      )}
    </div>
  );
}
