/**
 * The canonical backtest DATA-SOURCE interface — the single seam the engine
 * depends on, and the one BT-08 (duckdb-wasm over the HF range-proxy) swaps a
 * concrete implementation into later. The engine NEVER imports a concrete data
 * source; it is handed one. Today two implementations exist:
 *   - FixtureDataSource  (in-memory, deterministic; unit tests + golden runs)
 *   - LocalArchiveDataSource (reads JSON slices pre-extracted from the local
 *     market_archive_1m parquet by scripts/gen-backtest-fixtures — no node
 *     parquet/duckdb dep needed).
 *
 * Spec: 06-engine-semantics §0/§8/§14, 07-data-layer. The 6-fn shape is fixed so
 * the HF adapter is a drop-in replacement.
 *
 * Date keys are "YYYY-MM-DD" IST trading days. Expiry keys are likewise. All
 * functions are SYNCHRONOUS here (fixtures + pre-extracted slices are in memory);
 * the HF adapter will return Promises behind an async-wrapping shim so the
 * engine's pure core stays sync. To keep the engine source-agnostic AND testable
 * synchronously, the engine takes a fully-materialized per-day "DayData" bundle
 * (see DataSource.dayData) rather than awaiting inside the replay loop.
 */

import type { IndexSymbol } from "../../../features/backtest/shared/instruments";
import type {
  Bar,
  ContractMeta,
  OptionType,
  Series,
  StrikeIntent,
  StrikeResolution,
} from "./types";

/** Everything the engine needs to replay ONE trading day, fully materialized. */
export interface DayData {
  day: string; // "YYYY-MM-DD"
  expiry: string; // resolved contract expiry for this day
  /** Index spot 1-min series for the day (master grid source), ascending. */
  index: Series;
  /** The available option contracts for (index, expiry) on this day. */
  chain: ContractMeta[];
  /** Per-contract 1-min series, keyed by `${strike}-${optionType}`. */
  option: (strike: number, type: OptionType) => Series;
}

/**
 * The canonical 6-function data API. A concrete source resolves the local
 * archive (or HF) and answers these; the engine asks only through this shape.
 */
export interface DataSource {
  /** Stable id of the underlying snapshot — rides on RunResult.dataSnapshotId. */
  snapshotId: string;

  /** (1) Load the index spot series for a trading day. */
  loadIndex(index: IndexSymbol, day: string): Series;

  /** (2) Load one option contract's series for a (day, expiry, strike, type). */
  loadOption(
    index: IndexSymbol,
    expiry: string,
    day: string,
    strike: number,
    type: OptionType
  ): Series;

  /** (3) Resolve a strike intent against the AVAILABLE chain (graceful fallback). */
  resolveStrike(
    index: IndexSymbol,
    expiry: string,
    day: string,
    type: OptionType,
    intent: StrikeIntent,
    spot: number
  ): StrikeResolution | null;

  /** (4) Nearest available strike to spot (ties → higher), or null if no chain. */
  atmStrike(index: IndexSymbol, expiry: string, day: string, spot: number): number | null;

  /** (5) The available option chain (strikes + coverage + medVol) for the day. */
  optionChainAt(index: IndexSymbol, expiry: string, day: string): ContractMeta[];

  /** (6) Coverage 0..1 for a specific contract on the day (barsPresent / 375). */
  coverageFor(
    index: IndexSymbol,
    expiry: string,
    day: string,
    strike: number,
    type: OptionType
  ): number;

  /** Convenience: bundle a whole day for the replay loop (uses 1–6 above). */
  dayData(index: IndexSymbol, expiry: string, day: string): DayData;
}

/** Re-export for adapter authors. */
export type { Bar, ContractMeta, Series, StrikeIntent, StrikeResolution };
