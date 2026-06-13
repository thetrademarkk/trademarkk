"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { PnlText } from "@/components/shared/pnl-text";
import { TagChip } from "@/components/shared/tag-chip";
import { formatHoldTime } from "@/lib/utils";
import { describeInstrument, type TradeWithMeta } from "../types";

interface CardSelection {
  /** When true, tapping a card toggles selection instead of navigating. */
  active: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
}

/** Mobile card list — instrument + P&L prominent, tags as chips. */
export function TradeCards({
  trades,
  selection,
}: {
  trades: TradeWithMeta[];
  selection?: CardSelection;
}) {
  return (
    <div className="space-y-2">
      {trades.map((t) => {
        const checked = selection?.selected.has(t.id) ?? false;
        const body = (
          <div className="flex items-center justify-between gap-2">
            {selection?.active && (
              <Checkbox
                checked={checked}
                aria-label={`Select ${describeInstrument(t)}`}
                className="shrink-0"
                onClick={(e) => e.stopPropagation()}
                onCheckedChange={() => selection.onToggle(t.id)}
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">{describeInstrument(t)}</span>
                <Badge variant={t.direction === "long" ? "profit" : "loss"}>{t.direction}</Badge>
              </div>
              <div className="mt-0.5 text-xs text-muted">
                {new Date(t.opened_at).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                })}{" "}
                · {t.qty} qty · {formatHoldTime(t.opened_at, t.closed_at)}
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
        );
        const tagRow = t.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {t.tags.map((tag) => (
              <TagChip key={tag.id} name={tag.name} color={tag.color} />
            ))}
          </div>
        );

        if (selection?.active) {
          return (
            <Card
              key={t.id}
              role="button"
              tabIndex={0}
              aria-pressed={checked}
              onClick={() => selection.onToggle(t.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && selection.onToggle(t.id)}
              className={"p-3 transition-colors " + (checked ? "border-accent bg-accent/5" : "")}
            >
              {body}
              {tagRow}
            </Card>
          );
        }

        return (
          <Link key={t.id} href={`/app/trades/${t.id}`} className="block">
            <Card className="p-3 active:scale-[0.99] transition-transform">
              {body}
              {tagRow}
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
