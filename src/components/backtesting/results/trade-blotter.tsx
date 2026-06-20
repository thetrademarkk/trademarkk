"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatINR } from "@/lib/utils";
import { blotterToCsv, blotterCsvFilename } from "@/features/backtest/results/blotter-csv";
import { BacktestTradeQuickView } from "./trade-quick-view";
import type { BlotterRow, RunResult } from "@/features/backtest/shared/run-result";

/**
 * Tier 3 — the VIRTUALIZED trade-by-trade blotter (one row per trading-day
 * cycle). Uses @tanstack/react-virtual (already a dep — no new heavy dependency)
 * so a multi-year run with thousands of rows scrolls smoothly. Substitute /
 * illiquid days are marked with an amber asterisk + a legend (coverage honesty at
 * the row level). Each row opens the SAME quick-view modal idiom as the journal.
 * CSV export gives AlgoTest parity.
 */
const ROW_H = 44;

export function TradeBlotter({ run }: { run: RunResult }) {
  const rows = run.blotter;
  const parentRef = React.useRef<HTMLDivElement>(null);
  const [selected, setSelected] = React.useState<BlotterRow | null>(null);

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  const hasSubstitute = rows.some((r) => r.substituted || r.flags.length > 0);

  const onExport = () => {
    const csv = blotterToCsv(run);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = blotterCsvFilename(run);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div data-testid="bt-blotter" className="bt-boot bt-boot-1">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs text-muted">
          <span className="font-money tabular-nums">{rows.length}</span> trading-day
          {rows.length === 1 ? "" : "s"}
          {hasSubstitute && (
            <span className="ml-2 text-warning">* nearest/illiquid strike used</span>
          )}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onExport}
          data-testid="bt-csv-export"
          className="font-mono uppercase tracking-wide"
        >
          <Download className="h-3.5 w-3.5" aria-hidden /> CSV
        </Button>
      </div>

      {/* Sticky header */}
      <div className="bt-label grid grid-cols-[1.6fr_1fr_1fr_1.1fr] gap-2 border-b px-2 py-1.5">
        <span>Day</span>
        <span className="text-right">Gross</span>
        <span className="text-right">Charges</span>
        <span className="text-right">Net</span>
      </div>

      <div
        ref={parentRef}
        className="max-h-[420px] overflow-y-auto"
        data-testid="bt-blotter-scroll"
      >
        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
          {virt.getVirtualItems().map((vi) => {
            const row = rows[vi.index]!;
            const flagged = row.substituted || row.flags.length > 0;
            return (
              <button
                key={vi.key}
                type="button"
                onClick={() => setSelected(row)}
                className={cn(
                  "absolute left-0 top-0 grid w-full grid-cols-[1.6fr_1fr_1fr_1.1fr] items-center gap-2 border-b px-2 text-sm hover:bg-surface-2/60 focus:outline-none focus-visible:bg-surface-2",
                  flagged && "bg-warning/5"
                )}
                style={{ height: ROW_H, transform: `translateY(${vi.start}px)` }}
                data-row-day={row.day}
                data-substituted={row.substituted ? "true" : "false"}
              >
                <span className="flex items-center gap-1 text-left font-money tabular-nums">
                  {row.day}
                  {flagged && (
                    <span className="text-warning" aria-label="substituted or illiquid">
                      *
                    </span>
                  )}
                </span>
                <span className="text-right font-money tabular-nums text-muted">
                  {row.legs.length ? formatINR(row.gross, { signed: true }) : "—"}
                </span>
                <span className="text-right font-money tabular-nums text-muted">
                  {row.legs.length ? formatINR(row.charges) : "—"}
                </span>
                <span
                  className={cn(
                    "text-right font-money tabular-nums",
                    row.net > 0 ? "text-profit" : row.net < 0 ? "text-loss" : "text-muted"
                  )}
                >
                  {row.legs.length ? formatINR(row.net, { signed: true }) : "skipped"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <BacktestTradeQuickView
        row={selected}
        symbol={run.config.market.symbol}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}
