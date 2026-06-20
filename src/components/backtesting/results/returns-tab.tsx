"use client";

import * as React from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatINR } from "@/lib/utils";
import {
  buildMonthlyGrid,
  cellMagnitude,
  MONTH_LABELS,
  type MonthCell,
} from "@/features/backtest/results/monthly-grid";
import type { RunResult } from "@/features/backtest/shared/run-result";

/**
 * Returns tab — the MONTHLY-RETURNS HEATMAP. The honesty rule: a month with no
 * traded data is hatched + labelled "no data", NEVER a faked ₹0 (a real
 * break-even month is a distinct, painted 0-magnitude cell). Each year-row shows
 * "k/12 covered". Diverging profit/loss scale via color-mix on semantic tokens.
 */
export function ReturnsTab({ run }: { run: RunResult }) {
  const grid = React.useMemo(
    () =>
      buildMonthlyGrid(
        run.monthlyReturns,
        run.config.market.dateRange.start,
        run.config.market.dateRange.end
      ),
    [run]
  );

  return (
    <TooltipProvider delayDuration={120}>
      <div className="space-y-3 bt-boot bt-boot-1" data-testid="bt-returns-tab">
        <h3 className="bt-display text-sm font-semibold">Monthly returns</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-separate border-spacing-1 text-center text-xs">
            <thead>
              <tr>
                <th className="bt-label w-10 text-left">Yr</th>
                {MONTH_LABELS.map((m) => (
                  <th key={m} className="bt-label">
                    {m[0]}
                  </th>
                ))}
                <th className="bt-label pl-2 text-right">cov</th>
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr key={row.year}>
                  <td className="bt-num text-left text-muted">{row.year}</td>
                  {row.cells.map((cell) => (
                    <td key={cell.month} className="p-0">
                      <HeatCell cell={cell} maxAbs={grid.maxAbs} />
                    </td>
                  ))}
                  <td className="pl-2 text-right">
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <CoverageMeter covered={row.covered} total={12} />
                      <span className="font-money tabular-nums text-muted">{row.covered}/12</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="bt-label flex items-center gap-2 normal-case tracking-normal">
          <span className="inline-block h-3 w-3 rounded-sm bt-hatch" aria-hidden /> Hatched = no
          data for that month (never shown as <span className="font-money">₹0</span>).
        </p>
      </div>
    </TooltipProvider>
  );
}

/**
 * The 5-segment coverage honesty bar. Lights `on` segments proportional to the
 * covered fraction; partial coverage tints amber (warn), none tints red (bad).
 */
function CoverageMeter({ covered, total }: { covered: number; total: number }) {
  const frac = total > 0 ? covered / total : 0;
  const lit = Math.round(frac * 5);
  const tone = frac >= 0.999 ? "1" : frac > 0 ? "warn" : "bad";
  return (
    <span className="bt-meter" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className="bt-meter-seg" data-on={i < lit ? tone : undefined} />
      ))}
    </span>
  );
}

function HeatCell({ cell, maxAbs }: { cell: MonthCell; maxAbs: number }) {
  const mag = cellMagnitude(cell, maxAbs);
  if (mag === null || cell.pnl === null) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="bt-hatch h-7 w-full rounded-sm border border-border/60"
            data-no-data="true"
            aria-label="No data this month"
          />
        </TooltipTrigger>
        <TooltipContent className="text-xs">No data · {cell.month}</TooltipContent>
      </Tooltip>
    );
  }
  const token = cell.pnl >= 0 ? "var(--profit)" : "var(--loss)";
  const pctMix = Math.round(18 + mag * 62); // 18%..80% mix for visibility
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="flex h-7 w-full items-center justify-center rounded-sm font-money text-[10px] font-medium tabular-nums"
          style={{ background: `color-mix(in srgb, ${token} ${pctMix}%, var(--surface))` }}
          aria-label={`${cell.month}: ${formatINR(cell.pnl, { signed: true })}`}
        >
          {cell.pnl === 0 ? "0" : cell.pnl > 0 ? "+" : "−"}
        </div>
      </TooltipTrigger>
      <TooltipContent className="text-xs">
        {cell.month} · {formatINR(cell.pnl, { signed: true, decimals: true })}
      </TooltipContent>
    </Tooltip>
  );
}
