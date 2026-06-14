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
      <div className="space-y-3" data-testid="bt-returns-tab">
        <h3 className="text-sm font-semibold">Monthly returns</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-separate border-spacing-1 text-center text-xs">
            <thead>
              <tr>
                <th className="w-10 text-left font-normal text-muted">Yr</th>
                {MONTH_LABELS.map((m) => (
                  <th key={m} className="font-normal text-muted">
                    {m[0]}
                  </th>
                ))}
                <th className="pl-2 text-right font-normal text-muted">cov</th>
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr key={row.year}>
                  <td className="text-left text-muted">{row.year}</td>
                  {row.cells.map((cell) => (
                    <td key={cell.month} className="p-0">
                      <HeatCell cell={cell} maxAbs={grid.maxAbs} />
                    </td>
                  ))}
                  <td className="pl-2 text-right tabular-nums text-muted">{row.covered}/12</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="flex items-center gap-2 text-[11px] text-muted">
          <span className="inline-block h-3 w-3 rounded-sm bt-hatch" aria-hidden /> Hatched = no
          data for that month (never shown as ₹0).
        </p>
      </div>
    </TooltipProvider>
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
          className="flex h-7 w-full items-center justify-center rounded-sm text-[10px] font-medium tabular-nums"
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
