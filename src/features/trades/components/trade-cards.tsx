"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { PnlText } from "@/components/shared/pnl-text";
import { TagChip } from "@/components/shared/tag-chip";
import { formatHoldTime } from "@/lib/utils";
import { describeInstrument, type TradeWithMeta } from "../types";
import { groupTrades, type GroupBy, type TradeGroup } from "../grouping";
import { TradeMetaBadges } from "./trade-meta-badges";

interface CardSelection {
  /** When true, tapping a card toggles selection instead of navigating. */
  active: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
}

function TradeCard({ t, selection }: { t: TradeWithMeta; selection?: CardSelection }) {
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
  const meta = <TradeMetaBadges trade={t} className="mt-2" />;
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
        role="button"
        tabIndex={0}
        aria-pressed={checked}
        data-trade-card=""
        onClick={() => selection.onToggle(t.id)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && selection.onToggle(t.id)}
        className={"p-3 transition-colors " + (checked ? "border-accent bg-accent/5" : "")}
      >
        {body}
        {meta}
        {tagRow}
      </Card>
    );
  }

  return (
    <Link href={`/app/trades/${t.id}`} className="block" data-trade-card="">
      <Card className="p-3 active:scale-[0.99] transition-transform">
        {body}
        {meta}
        {tagRow}
      </Card>
    </Link>
  );
}

/** Collapsible group header for the mobile card list, with subtotals. */
function GroupHeader({
  group,
  open,
  onToggle,
}: {
  group: TradeGroup;
  open: boolean;
  onToggle: () => void;
}) {
  const Icon = open ? ChevronDown : ChevronRight;
  const { subtotal } = group;
  return (
    <button
      type="button"
      aria-expanded={open}
      data-group-header={group.key}
      onClick={onToggle}
      className="flex w-full items-center gap-2 rounded-lg bg-surface-2/60 px-3 py-2 text-left"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
      <span className="truncate text-sm font-semibold">{group.label}</span>
      <span className="text-xs text-muted">{subtotal.trades}</span>
      <span className="ml-auto flex items-center gap-2 text-xs">
        {subtotal.closed > 0 ? (
          <>
            <span className="text-muted" data-group-winrate={group.key}>
              {Math.round(subtotal.winRate * 100)}%
            </span>
            <span data-group-net={group.key}>
              <PnlText value={subtotal.netPnl} className="text-xs font-semibold" />
            </span>
          </>
        ) : (
          <span className="text-muted">open only</span>
        )}
      </span>
    </button>
  );
}

/** Mobile card list — instrument + P&L prominent, meta + tags as chips. */
export function TradeCards({
  trades,
  selection,
  groupBy = "none",
}: {
  trades: TradeWithMeta[];
  selection?: CardSelection;
  groupBy?: GroupBy;
}) {
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const groups = React.useMemo(() => groupTrades(trades, groupBy), [trades, groupBy]);
  const grouped = groupBy !== "none";

  const toggle = (key: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (!grouped) {
    return (
      <div className="space-y-2">
        {trades.map((t) => (
          <TradeCard key={t.id} t={t} selection={selection} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const open = !collapsed.has(g.key);
        return (
          <div key={g.key} className="space-y-2">
            <GroupHeader group={g} open={open} onToggle={() => toggle(g.key)} />
            {open && g.trades.map((t) => <TradeCard key={t.id} t={t} selection={selection} />)}
          </div>
        );
      })}
    </div>
  );
}
