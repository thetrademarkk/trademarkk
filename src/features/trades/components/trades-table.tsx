"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpDown } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PnlText } from "@/components/shared/pnl-text";
import { TagChip } from "@/components/shared/tag-chip";
import { formatHoldTime } from "@/lib/utils";
import { describeInstrument, type TradeWithMeta } from "../types";

type SortKey = "opened_at" | "net_pnl" | "r_multiple" | "symbol";

/** Desktop dense table. Mobile uses TradeCards instead. */
export function TradesTable({ trades }: { trades: TradeWithMeta[] }) {
  const [sortKey, setSortKey] = React.useState<SortKey>("opened_at");
  const [asc, setAsc] = React.useState(false);

  const sorted = React.useMemo(() => {
    const copy = [...trades];
    copy.sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return asc ? cmp : -cmp;
    });
    return copy;
  }, [trades, sortKey, asc]);

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

  return (
    <div className="rounded-lg border bg-surface overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{header("Date", "opened_at")}</TableHead>
            <TableHead>{header("Instrument", "symbol")}</TableHead>
            <TableHead>Side</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Entry</TableHead>
            <TableHead className="text-right">Exit</TableHead>
            <TableHead className="text-right">{header("Net P&L", "net_pnl")}</TableHead>
            <TableHead className="text-right">{header("R", "r_multiple")}</TableHead>
            <TableHead>Setup</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead>Hold</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((t) => (
            <TableRow key={t.id} className="cursor-pointer">
              <TableCell className="text-muted text-xs">
                <Link href={`/app/trades/${t.id}`} className="block">
                  {new Date(t.opened_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                  <span className="ml-1 opacity-60">
                    {new Date(t.opened_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}
                  </span>
                </Link>
              </TableCell>
              <TableCell className="font-medium">
                <Link href={`/app/trades/${t.id}`} className="block">
                  {describeInstrument(t)}
                </Link>
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
              <TableCell>
                <div className="flex gap-1 max-w-[160px] overflow-hidden">
                  {t.tags.slice(0, 2).map((tag) => (
                    <TagChip key={tag.id} name={tag.name} color={tag.color} />
                  ))}
                  {t.tags.length > 2 && <span className="text-[11px] text-muted">+{t.tags.length - 2}</span>}
                </div>
              </TableCell>
              <TableCell className="text-xs text-muted">{formatHoldTime(t.opened_at, t.closed_at)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
