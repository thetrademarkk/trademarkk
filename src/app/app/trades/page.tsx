"use client";

import * as React from "react";
import { BookOpenText, ClipboardList, ListChecks, ListFilter } from "lucide-react";
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
  type GroupBy,
} from "@/features/trades";
import { useRuleDays } from "@/features/rules";
import { RiskGuardrailBanner } from "@/features/goals";
import { BulkActionBar, PlanTradeDialog } from "@/features/workflow";
import { selectionReducer, selectAllState } from "@/features/workflow/bulk-actions";
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
  const [groupBy, setGroupBy] = React.useState<GroupBy>("none");
  const hydrated = React.useRef(false);

  // Hydrate from the URL once (shareable filter links), then mirror filter +
  // grouping state back into the query string so reloads and copied links
  // restore the exact view.
  React.useEffect(() => {
    setFilters(decodeFiltersFromSearch(window.location.search));
    const g = new URLSearchParams(window.location.search).get("group");
    if (g === "segment" || g === "product" || g === "horizon") setGroupBy(g);
    hydrated.current = true;
  }, []);
  React.useEffect(() => {
    if (!hydrated.current) return;
    const params = new URLSearchParams(encodeFiltersToSearch(filters));
    if (groupBy !== "none") params.set("group", groupBy);
    const qs = params.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    window.history.replaceState(window.history.state, "", url);
  }, [filters, groupBy]);

  const { data: trades, isLoading } = useTrades({ from, to });
  const { data: ruleDays } = useRuleDays();
  const filtered = React.useMemo(
    () => (trades ? filterTrades(trades, filters, ruleDays) : undefined),
    [trades, filters, ruleDays]
  );
  const { setQuickAddOpen } = useUiStore();
  const isDesktop = useIsDesktop();

  // --- multi-select (bulk edit) ---
  const [selectMode, setSelectMode] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [planOpen, setPlanOpen] = React.useState(false);
  const toggle = (id: string) => setSelected((s) => selectionReducer(s, { type: "toggle", id }));
  const toggleAll = (ids: string[], on: boolean) =>
    setSelected((s) =>
      on ? selectionReducer(s, { type: "selectAll", ids }) : selectionReducer(s, { type: "clear" })
    );
  const clearSelection = () => setSelected(new Set());
  // Drop ids that fall out of the current filter so the bar count stays honest.
  const visibleIds = React.useMemo(() => (filtered ?? []).map((t) => t.id), [filtered]);
  const selectedVisible = React.useMemo(
    () => visibleIds.filter((id) => selected.has(id)),
    [visibleIds, selected]
  );
  const exitSelectMode = () => {
    setSelectMode(false);
    clearSelection();
  };

  const nActive = countActiveFilters(filters);
  // The rule-adherence criterion needs the day sets before it can filter.
  const pending = isLoading || !trades || !filtered || (filters.ruleCheck != null && !ruleDays);
  const hasTrades = Boolean(trades && trades.length > 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Trades"
        description={
          trades && trades.length > 0 && filtered ? (
            <span className="inline-flex flex-wrap items-center gap-x-2">
              <span>
                {nActive > 0
                  ? `${filtered.length} of ${trades.length} trades`
                  : `${trades.length} trades`}
              </span>
              {filtered.length > 0 && (
                <span>
                  · Net <PnlText value={netPnl(closedOnly(filtered))} className="font-semibold" />
                </span>
              )}
            </span>
          ) : (
            "Every trade, marked."
          )
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPlanOpen(true)}
              aria-label="Plan a trade"
            >
              <ClipboardList className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Plan a trade</span>
            </Button>
            {hasTrades && (
              <Button
                variant={selectMode ? "default" : "outline"}
                size="sm"
                onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                aria-label={selectMode ? "Done selecting" : "Select trades"}
              >
                <ListChecks className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{selectMode ? "Done" : "Select"}</span>
              </Button>
            )}
            <CsvImport />
          </>
        }
      />
      <RiskGuardrailBanner />

      <TradeFiltersBar
        filters={filters}
        onChange={setFilters}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
      />

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
        <TradesTable
          trades={filtered}
          groupBy={groupBy}
          selection={
            selectMode
              ? {
                  selected,
                  onToggle: toggle,
                  onToggleAll: toggleAll,
                  allState: selectAllState(selected, visibleIds),
                }
              : undefined
          }
        />
      ) : (
        <TradeCards
          trades={filtered}
          groupBy={groupBy}
          selection={selectMode ? { active: true, selected, onToggle: toggle } : undefined}
        />
      )}

      {selectMode && <BulkActionBar selectedIds={selectedVisible} onClear={exitSelectMode} />}
      <PlanTradeDialog open={planOpen} onOpenChange={setPlanOpen} />
    </div>
  );
}
