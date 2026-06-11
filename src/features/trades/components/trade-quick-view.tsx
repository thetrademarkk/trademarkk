"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PnlText } from "@/components/shared/pnl-text";
import { TagChip } from "@/components/shared/tag-chip";
import { formatHoldTime, formatINR } from "@/lib/utils";
import { describeInstrument, type TradeWithMeta } from "../types";

/**
 * Quick glance at a trade from the list — the essentials in one screen,
 * with a single jump to the full page for journaling depth.
 */
export function TradeQuickView({
  trade,
  onOpenChange,
}: {
  trade: TradeWithMeta | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(trade)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {trade && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {describeInstrument(trade)}
                <Badge variant={trade.direction === "long" ? "profit" : "loss"}>
                  {trade.direction}
                </Badge>
                {trade.status === "open" && <Badge variant="warning">open</Badge>}
              </DialogTitle>
            </DialogHeader>

            <div className="flex items-end justify-between rounded-lg bg-surface-2/60 px-4 py-3">
              <div>
                <p className="micro-label">Net P&L</p>
                {trade.status === "closed" ? (
                  <PnlText value={trade.net_pnl} className="text-2xl font-bold" />
                ) : (
                  <p className="text-2xl font-bold text-muted">—</p>
                )}
              </div>
              <div className="text-right text-xs text-muted">
                {trade.status === "closed" && (
                  <>
                    <p>
                      Gross <PnlText value={trade.gross_pnl} /> · Charges{" "}
                      <span className="font-money">
                        {formatINR(trade.charges, { decimals: true })}
                      </span>
                    </p>
                    {trade.r_multiple != null && <p className="font-money">{trade.r_multiple}R</p>}
                  </>
                )}
              </div>
            </div>

            <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
              <div>
                <dt className="micro-label">Qty</dt>
                <dd className="font-money">{trade.qty}</dd>
              </div>
              <div>
                <dt className="micro-label">Entry</dt>
                <dd className="font-money">{trade.avg_entry.toFixed(2)}</dd>
              </div>
              <div>
                <dt className="micro-label">Exit</dt>
                <dd className="font-money">
                  {trade.avg_exit != null ? trade.avg_exit.toFixed(2) : "—"}
                </dd>
              </div>
              <div>
                <dt className="micro-label">Opened</dt>
                <dd className="text-xs">
                  {new Date(trade.opened_at).toLocaleString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </dd>
              </div>
              <div>
                <dt className="micro-label">Hold</dt>
                <dd className="text-xs">{formatHoldTime(trade.opened_at, trade.closed_at)}</dd>
              </div>
              <div>
                <dt className="micro-label">Setup</dt>
                <dd className="truncate text-xs">{trade.playbook_name ?? "—"}</dd>
              </div>
            </dl>

            {trade.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {trade.tags.map((t) => (
                  <TagChip key={t.id} name={t.name} color={t.color} />
                ))}
              </div>
            )}

            {trade.notes && (
              <p className="line-clamp-3 rounded-lg bg-surface-2/40 px-3 py-2 text-xs leading-5 text-muted">
                {trade.notes}
              </p>
            )}

            <Button asChild className="w-full">
              <Link href={`/app/trades/${trade.id}`}>
                Open full view <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
