"use client";

import * as React from "react";
import { BookOpenText } from "lucide-react";
import { useFilterStore, periodToRange } from "@/stores/filter-store";
import { useUiStore } from "@/stores/ui-store";
import { useIsDesktop } from "@/hooks/use-media-query";
import {
  CsvImport,
  TradeCards,
  TradeFiltersBar,
  TradesTable,
  useTrades,
  type TradeFilters,
} from "@/features/trades";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { PnlText } from "@/components/shared/pnl-text";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { closedOnly, netPnl } from "@/lib/stats/stats";

export default function TradesPage() {
  const { period } = useFilterStore();
  const { from, to } = periodToRange(period);
  const [filters, setFilters] = React.useState<TradeFilters>({});
  const merged = { ...filters, from, to };
  const { data: trades, isLoading } = useTrades(merged);
  const { setQuickAddOpen } = useUiStore();
  const isDesktop = useIsDesktop();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Trades"
        description={
          trades && trades.length > 0
            ? `${trades.length} trades · net `
            : "Every trade, marked."
        }
        actions={<CsvImport />}
      />
      {trades && trades.length > 0 && (
        <div className="-mt-3 text-sm text-muted">
          Net: <PnlText value={netPnl(closedOnly(trades))} className="font-semibold" />
        </div>
      )}

      <TradeFiltersBar filters={filters} onChange={setFilters} />

      {isLoading || !trades ? (
        <Skeleton className="h-64" />
      ) : trades.length === 0 ? (
        <EmptyState
          icon={BookOpenText}
          title="No trades found"
          description="Log your first trade or import your broker tradebook CSV."
          action={<Button onClick={() => setQuickAddOpen(true)}>Add trade</Button>}
        />
      ) : isDesktop ? (
        <TradesTable trades={trades} />
      ) : (
        <TradeCards trades={trades} />
      )}
    </div>
  );
}
