"use client";

import * as React from "react";
import { BookOpenText, ListFilter } from "lucide-react";
import { useFilterStore, periodToRange } from "@/stores/filter-store";
import { useUiStore } from "@/stores/ui-store";
import { useIsDesktop } from "@/hooks/use-media-query";
import {
  countActiveFilters,
  CsvImport,
  decodeFiltersFromSearch,
  encodeFiltersToSearch,
  filterTrades,
  TradeCards,
  TradeFiltersBar,
  TradesTable,
  useTrades,
  type AdvancedTradeFilters,
} from "@/features/trades";
import { useRuleDays } from "@/features/rules";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { PnlText } from "@/components/shared/pnl-text";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { closedOnly, netPnl } from "@/lib/stats/stats";

export default function TradesPage() {
  const { period } = useFilterStore();
  const { from, to } = periodToRange(period);
  // The period (persisted store) scopes the fetch; every other criterion is
  // applied client-side on the fetched list, so filters work identically in
  // hosted, BYOD and local modes.
  const [filters, setFilters] = React.useState<AdvancedTradeFilters>({});
  const hydrated = React.useRef(false);

  // Hydrate from the URL once (shareable filter links), then mirror filter
  // state back into the query string so reloads and copied links restore it.
  React.useEffect(() => {
    setFilters(decodeFiltersFromSearch(window.location.search));
    hydrated.current = true;
  }, []);
  React.useEffect(() => {
    if (!hydrated.current) return;
    const qs = encodeFiltersToSearch(filters);
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    window.history.replaceState(window.history.state, "", url);
  }, [filters]);

  const { data: trades, isLoading } = useTrades({ from, to });
  const { data: ruleDays } = useRuleDays();
  const filtered = React.useMemo(
    () => (trades ? filterTrades(trades, filters, ruleDays) : undefined),
    [trades, filters, ruleDays]
  );
  const { setQuickAddOpen } = useUiStore();
  const isDesktop = useIsDesktop();

  const nActive = countActiveFilters(filters);
  // The rule-adherence criterion needs the day sets before it can filter.
  const pending = isLoading || !trades || !filtered || (filters.ruleCheck != null && !ruleDays);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Trades"
        description={
          trades && trades.length > 0 && filtered
            ? nActive > 0
              ? `${filtered.length} of ${trades.length} trades`
              : `${trades.length} trades`
            : "Every trade, marked."
        }
        actions={<CsvImport />}
      />
      {filtered && filtered.length > 0 && (
        <div className="-mt-3 text-sm text-muted">
          Net: <PnlText value={netPnl(closedOnly(filtered))} className="font-semibold" />
        </div>
      )}

      <TradeFiltersBar filters={filters} onChange={setFilters} />

      {pending ? (
        <Skeleton className="h-64" />
      ) : trades.length === 0 ? (
        <EmptyState
          icon={BookOpenText}
          title="No trades found"
          description="Log your first trade or import your broker tradebook CSV."
          action={<Button onClick={() => setQuickAddOpen(true)}>Add trade</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ListFilter}
          title="No trades match these filters"
          description="Loosen or clear the filters to see more trades."
          action={
            <Button variant="outline" onClick={() => setFilters({})}>
              Clear filters
            </Button>
          }
        />
      ) : isDesktop ? (
        <TradesTable trades={filtered} />
      ) : (
        <TradeCards trades={filtered} />
      )}
    </div>
  );
}
