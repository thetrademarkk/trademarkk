// Public API of the trades feature — other features import only from here.
export { QuickAdd } from "./components/quick-add";
export { TradeForm } from "./components/trade-form";
export { TradesTable } from "./components/trades-table";
export { TradeCards } from "./components/trade-cards";
export { TradeFiltersBar } from "./components/trade-filters";
export { CsvImport } from "./components/csv-import";
export { TradeDetail } from "./components/trade-detail";
export {
  useTrades,
  useTrade,
  useAllLegs,
  useAccounts,
  useTags,
  usePlaybooks,
  useSaveTrade,
  useDeleteTrade,
  useAddAttachment,
  useRecomputePreview,
  useApplyRecompute,
} from "./queries";
export type { RecomputePreview, RecomputeItem } from "./recompute";
export { describeInstrument } from "./types";
export type {
  TradeRow,
  TradeWithMeta,
  TradeLegRow,
  Tag,
  TradeFilters,
  AccountRow,
  PlaybookRow,
} from "./types";
export {
  countActiveFilters,
  decodeFiltersFromSearch,
  encodeFiltersToSearch,
  filterTrades,
  hasActiveFilters,
  matchesTrade,
  sanitizeFilters,
} from "./filter-predicate";
export type { AdvancedTradeFilters, RuleDayContext } from "./filter-predicate";
