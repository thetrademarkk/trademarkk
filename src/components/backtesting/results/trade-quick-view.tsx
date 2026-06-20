"use client";

import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PnlText } from "@/components/shared/pnl-text";
import { formatINR } from "@/lib/utils";
import type { BlotterRow } from "@/features/backtest/shared/run-result";

/**
 * Backtest trade quick-view — the SAME modal IDIOM as the journal's
 * trade-quick-view (Dialog + PnlText + the b-surface-2 P&L hero + a dl grid),
 * adapted to a backtest BlotterRow (one trading-day cycle). It reuses the journal
 * modal's visual vocabulary verbatim but is its own component so the journal one
 * is never modified (it is owned by a different lane and is /app-coupled). Opened
 * from the blotter rows in Tier 3.
 *
 * Coverage honesty travels into the modal: a substituted day shows the
 * requested → served strike per leg with an amber flag.
 */
export function BacktestTradeQuickView({
  row,
  symbol,
  onOpenChange,
}: {
  row: BlotterRow | null;
  symbol: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(row)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="bt-trade-quick-view">
        {row && (
          <>
            <DialogHeader>
              <DialogTitle className="bt-display flex flex-wrap items-center gap-2">
                {symbol} · {row.day}
                {row.substituted && (
                  <Badge variant="warning">
                    <AlertTriangle className="h-3 w-3" aria-hidden /> substituted
                  </Badge>
                )}
                {row.flags.includes("LOW_LIQUIDITY") && (
                  <Badge variant="warning">low liquidity</Badge>
                )}
              </DialogTitle>
            </DialogHeader>

            <div className="bt-panel flex items-end justify-between px-4 py-3">
              <div>
                <p className="bt-label">Net P&L</p>
                <PnlText value={row.net} className="bt-num mt-1 block text-2xl" />
              </div>
              <div className="text-right text-xs text-muted">
                <p>
                  Gross <PnlText value={row.gross} /> · Charges{" "}
                  <span className="font-money">{formatINR(row.charges, { decimals: true })}</span>
                </p>
              </div>
            </div>

            <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
              <div>
                <dt className="bt-label">Entry</dt>
                <dd className="font-money text-xs tabular-nums">{istTime(row.entryTs)}</dd>
              </div>
              <div>
                <dt className="bt-label">Exit</dt>
                <dd className="font-money text-xs tabular-nums">{istTime(row.exitTs)}</dd>
              </div>
              <div>
                <dt className="bt-label">Legs</dt>
                <dd className="font-money tabular-nums">{row.legs.length}</dd>
              </div>
            </dl>

            <div className="space-y-1.5">
              <p className="bt-label">Per-leg</p>
              {row.legs.map((leg, i) => (
                <div
                  key={`${leg.legId}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-lg bg-surface-2/40 px-3 py-2 text-xs"
                >
                  <span className="font-money">
                    {leg.side === "sell" ? "Sell" : "Buy"} {leg.qty} {leg.optionType}{" "}
                    {Math.round(leg.resolution.served)}
                    {leg.resolution.served !== leg.resolution.requested && (
                      <span className="ml-1 text-warning" title="Requested strike was substituted">
                        * (req {Math.round(leg.resolution.requested)})
                      </span>
                    )}
                  </span>
                  <PnlText value={leg.net} />
                </div>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function istTime(ts: number): string {
  if (!ts) return "—";
  return new Date(ts + 5.5 * 3600_000).toISOString().slice(11, 16);
}
