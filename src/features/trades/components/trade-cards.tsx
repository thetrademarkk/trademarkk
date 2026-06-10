"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PnlText } from "@/components/shared/pnl-text";
import { TagChip } from "@/components/shared/tag-chip";
import { formatHoldTime } from "@/lib/utils";
import { describeInstrument, type TradeWithMeta } from "../types";

/** Mobile card list — instrument + P&L prominent, tags as chips. */
export function TradeCards({ trades }: { trades: TradeWithMeta[] }) {
  return (
    <div className="space-y-2">
      {trades.map((t) => (
        <Link key={t.id} href={`/app/trades/${t.id}`} className="block">
          <Card className="p-3 active:scale-[0.99] transition-transform">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{describeInstrument(t)}</span>
                  <Badge variant={t.direction === "long" ? "profit" : "loss"}>{t.direction}</Badge>
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {new Date(t.opened_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} ·{" "}
                  {t.qty} qty · {formatHoldTime(t.opened_at, t.closed_at)}
                  {t.r_multiple != null && <> · {t.r_multiple}R</>}
                </div>
              </div>
              <div className="text-right shrink-0">
                {t.status === "closed" ? (
                  <PnlText value={t.net_pnl} className="text-base font-semibold" />
                ) : (
                  <Badge variant="warning">open</Badge>
                )}
              </div>
            </div>
            {t.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {t.tags.map((tag) => (
                  <TagChip key={tag.id} name={tag.name} color={tag.color} />
                ))}
              </div>
            )}
          </Card>
        </Link>
      ))}
    </div>
  );
}
