"use client";

import * as React from "react";
import { ArrowUpDown, ChevronDown, ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { PnlText } from "@/components/shared/pnl-text";
import { formatHoldTime } from "@/lib/utils";
import { describeInstrument, type TradeWithMeta } from "../types";
import { groupTrades, type GroupBy, type TradeGroup } from "../grouping";
import { TradeQuickView } from "./trade-quick-view";
import { TradeMetaBadges } from "./trade-meta-badges";

type SortKey = "opened_at" | "net_pnl" | "r_multiple" | "symbol";

/** Multi-select wiring lifted from the page (so the bulk-action bar can act). */
export interface SelectionProps {
  selected: Set<string>;
  onToggle: (id: string) => void;
  /** Header checkbox toggles every visible trade. */
  onToggleAll: (ids: string[], on: boolean) => void;
  allState: "none" | "some" | "all";
}

const COLSPAN = 12; // total columns (incl. the optional select col when present)

function sortTrades(trades: TradeWithMeta[], sortKey: SortKey, asc: boolean): TradeWithMeta[] {
  const copy = [...trades];
  copy.sort((a, b) => {
    const av = a[sortKey] ?? 0;
    const bv = b[sortKey] ?? 0;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return asc ? cmp : -cmp;
  });
  return copy;
}

/** One trade row — reused inside every group so sorting + selection are uniform. */
function TradeRowCells({
  t,
  selection,
  onOpen,
}: {
  t: TradeWithMeta;
  selection?: SelectionProps;
  onOpen: (t: TradeWithMeta) => void;
}) {
  const checked = selection?.selected.has(t.id) ?? false;
  return (
    <TableRow
      className="cursor-pointer"
      data-state={checked ? "selected" : undefined}
      data-trade-row=""
      onClick={() => onOpen(t)}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onOpen(t)}
      aria-label={`Quick view ${describeInstrument(t)}`}
    >
      {selection && (
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={checked}
            aria-label={`Select ${describeInstrument(t)}`}
            onCheckedChange={() => selection.onToggle(t.id)}
          />
        </TableCell>
      )}
      <TableCell className="text-muted text-xs">
        {new Date(t.opened_at).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
        })}
        <span className="ml-1 opacity-60">
          {new Date(t.opened_at).toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })}
        </span>
      </TableCell>
      <TableCell className="font-medium">{describeInstrument(t)}</TableCell>
      <TableCell>
        <TradeMetaBadges trade={t} compact />
      </TableCell>
      <TableCell>
        <Badge variant={t.direction === "long" ? "profit" : "loss"}>{t.direction}</Badge>
      </TableCell>
      <TableCell className="text-right font-money">{t.qty}</TableCell>
      <TableCell className="text-right font-money">{t.avg_entry.toFixed(2)}</TableCell>
      <TableCell className="text-right font-money">
        {t.avg_exit != null ? t.avg_exit.toFixed(2) : <Badge variant="warning">open</Badge>}
      </TableCell>
      <TableCell className="text-right">
        {t.status === "closed" ? <PnlText value={t.net_pnl} /> : "—"}
      </TableCell>
      <TableCell className="text-right font-money text-muted">
        {t.r_multiple != null ? `${t.r_multiple}R` : "—"}
      </TableCell>
      <TableCell className="text-xs text-muted max-w-[120px] truncate">
        {t.playbook_name ?? "—"}
      </TableCell>
      <TableCell className="text-xs text-muted">
        {formatHoldTime(t.opened_at, t.closed_at)}
      </TableCell>
    </TableRow>
  );
}

/** A collapsible group header carrying the per-group subtotals. */
function GroupHeaderRow({
  group,
  open,
  onToggle,
  hasSelectCol,
}: {
  group: TradeGroup;
  open: boolean;
  onToggle: () => void;
  hasSelectCol: boolean;
}) {
  const { subtotal } = group;
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <TableRow className="bg-surface-2/60 hover:bg-surface-2" data-group-header={group.key}>
      <TableCell colSpan={hasSelectCol ? COLSPAN : COLSPAN - 1} className="py-2">
        <button
          type="button"
          aria-expanded={open}
          className="flex w-full items-center gap-2 text-left text-sm font-semibold"
          onClick={onToggle}
        >
          <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          <span className="truncate">{group.label}</span>
          <span className="text-xs font-normal text-muted">
            {subtotal.trades} trade{subtotal.trades === 1 ? "" : "s"}
          </span>
          <span className="ml-auto flex items-center gap-3 text-xs font-normal">
            {subtotal.closed > 0 ? (
              <>
                <span className="text-muted" data-group-winrate={group.key}>
                  {Math.round(subtotal.winRate * 100)}% win
                </span>
                <span className="text-muted">Net</span>
                <span data-group-net={group.key}>
                  <PnlText value={subtotal.netPnl} className="text-xs font-semibold" />
                </span>
              </>
            ) : (
              <span className="text-muted">no closed trades</span>
            )}
          </span>
        </button>
      </TableCell>
    </TableRow>
  );
}

/** Desktop dense table; rows open a quick-view modal. Mobile uses TradeCards. */
export function TradesTable({
  trades,
  selection,
  groupBy = "none",
}: {
  trades: TradeWithMeta[];
  selection?: SelectionProps;
  groupBy?: GroupBy;
}) {
  const [sortKey, setSortKey] = React.useState<SortKey>("opened_at");
  const [asc, setAsc] = React.useState(false);
  const [quickView, setQuickView] = React.useState<TradeWithMeta | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());

  // Sorting applies within each group (and to the whole list when ungrouped).
  const groups = React.useMemo(() => {
    const gs = groupTrades(trades, groupBy);
    return gs.map((g) => ({ ...g, trades: sortTrades(g.trades, sortKey, asc) }));
  }, [trades, groupBy, sortKey, asc]);

  const allVisibleIds = React.useMemo(
    () => groups.flatMap((g) => g.trades.map((t) => t.id)),
    [groups]
  );

  const header = (label: string, key: SortKey) => (
    <button
      className="inline-flex items-center gap-1 hover:text-foreground"
      onClick={() => {
        if (sortKey === key) setAsc(!asc);
        else {
          setSortKey(key);
          setAsc(false);
        }
      }}
    >
      {label}
      <ArrowUpDown className="h-3 w-3 opacity-50" />
    </button>
  );

  const toggleGroup = (key: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const grouped = groupBy !== "none";

  return (
    <div className="rounded-lg border bg-surface overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {selection && (
              <TableHead className="w-9">
                <Checkbox
                  aria-label="Select all trades"
                  checked={
                    selection.allState === "all"
                      ? true
                      : selection.allState === "some"
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={(c) => selection.onToggleAll(allVisibleIds, c === true)}
                />
              </TableHead>
            )}
            <TableHead>{header("Date", "opened_at")}</TableHead>
            <TableHead>{header("Instrument", "symbol")}</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Side</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Entry</TableHead>
            <TableHead className="text-right">Exit</TableHead>
            <TableHead className="text-right">{header("Net P&L", "net_pnl")}</TableHead>
            <TableHead className="text-right">{header("R", "r_multiple")}</TableHead>
            <TableHead>Setup</TableHead>
            <TableHead>Hold</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => {
            const open = !collapsed.has(g.key);
            return (
              <React.Fragment key={g.key}>
                {grouped && (
                  <GroupHeaderRow
                    group={g}
                    open={open}
                    onToggle={() => toggleGroup(g.key)}
                    hasSelectCol={Boolean(selection)}
                  />
                )}
                {open &&
                  g.trades.map((t) => (
                    <TradeRowCells key={t.id} t={t} selection={selection} onOpen={setQuickView} />
                  ))}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
      <TradeQuickView trade={quickView} onOpenChange={(open) => !open && setQuickView(null)} />
    </div>
  );
}
