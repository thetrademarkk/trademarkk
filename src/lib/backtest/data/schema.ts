/**
 * Data-layer SCHEMA — the §2 types from docs/backtesting/07-data-layer.md.
 *
 * This is the pure, dependency-free type vocabulary of the backtest DATA layer
 * (HuggingFace parquet → DuckDB → narrow typed slices). It is DISTINCT from, but
 * deliberately composes with, the engine-internal vocabulary in
 * `src/lib/backtest/engine/types.ts`:
 *
 *   - The engine speaks integer epoch-ms `Bar`s and books trades; the data layer
 *     speaks ISO-string `IndexBar`/`OptionBar` rows as they come off parquet.
 *   - The engine's `StrikeResolution` (engine/types.ts) is the per-trade primitive
 *     stamped on a RunResult: `served: number`, `confidence: "high"|"medium"|"low"`,
 *     `fallbackSteps`. The data-layer `StrikeResolution` here is the §2 wire shape
 *     the data API returns BEFORE the engine consumes it: `served: number | null`,
 *     a `reason` discriminant, an `illiquid` flag, and `coveragePct`. The two are
 *     reconciled by `engine/resolve-strike.ts` (chain-only) and the future
 *     client.ts adapter — they do not duplicate-conflict because the engine type
 *     is imported under an alias here rather than redeclared.
 *
 * Symbols / strike steps / lot sizes are NOT redeclared — they live in
 * `src/features/backtest/shared/instruments.ts` (the single source of truth) and
 * `Sym` below is structurally the same union as `IndexSymbol` there.
 */

import type {
  ContractMeta as EngineContractMeta,
  StrikeResolution as EngineStrikeResolution,
} from "../engine/types";

/** Backtestable index symbol — same union as `instruments.IndexSymbol`. */
export type Sym = "NIFTY" | "BANKNIFTY" | "SENSEX";

/** Candle interval tokens the resampler understands (07-data-layer §2). */
export type Interval = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "1d";

/** CE / PE option side. */
export type OptionType = "CE" | "PE";

/**
 * A spot index bar as it comes off parquet. `ts` is an ISO-ish IST timestamp
 * string (e.g. "2026-01-15 09:20:00"); the engine converts to epoch-ms at the
 * boundary. 1-minute bars unless resampled in SQL first.
 */
export interface IndexBar {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** An option bar — an IndexBar plus the contract identity and open interest. */
export interface OptionBar extends IndexBar {
  strike: number;
  optionType: OptionType;
  oi: number;
}

/**
 * Data-layer strike-resolution wire shape (07-data-layer §2 / §7b). This is the
 * "honest missing data" primitive the API returns: a missing strike is a TYPED
 * value with a `reason`, never a bare `[]`.
 *
 * Reconciliation with the engine's `StrikeResolution`:
 *   reason "exact"   ↔ engine confidence "high"   (served === requested)
 *   reason "nearest" ↔ engine confidence "medium" (served walked outward)
 *   reason "none"    ↔ engine returns null (MISSING_LEG)
 */
export interface StrikeResolution {
  /** What the strategy asked for (e.g. ATM+2 → 24600). */
  requested: number;
  /** Nearest strike that actually has data, or null when none clears the bars. */
  served: number | null;
  /** |served - requested|; 0 when exact, Infinity when `served` is null. */
  distancePts: number;
  /** 0–1 share of expected 1m bars present for the served strike over the window. */
  coveragePct: number;
  /** coverage < 0.6 OR median 1m volume below the per-symbol liquidity floor. */
  illiquid: boolean;
  /** Discriminant for the three resolution outcomes. */
  reason: "exact" | "nearest" | "none";
}

/** Per-strike-side coverage entry inside a CoverageReport (07-data-layer §2 / §7a). */
export interface StrikeCov {
  /** 0–1 fraction of expected bars present for this strike+side over the window. */
  coverage: number;
  /** Median per-minute volume — the liquidity signal. */
  medVol: number;
  /** Distinct trading days this strike+side actually printed on. */
  days: number;
}

/**
 * The per-(symbol, expiry) coverage manifest, narrowed to a window
 * (07-data-layer §2 / §7a). `strikes` is keyed by the stringified strike; each
 * side is `StrikeCov` or `null` (strike entirely absent for that side).
 */
export interface CoverageReport {
  symbol: Sym;
  /** Expiry date "YYYY-MM-DD" (the file's partition key). */
  expiry: string;
  /** Bumped when a parquet file is rewritten — part of every cache key. */
  datasetVersion: number;
  /** "YYYY-MM-DD" trading days in the window, ascending. */
  tradingDays: string[];
  /** 375 for 09:15–15:30 inclusive at 1m. */
  expectedBarsPerDay: number;
  /** Strike grid step for this symbol (50 NIFTY, 100 BANKNIFTY/SENSEX). */
  strikeStep: number;
  /** 0–1 coverage over the used ±N band (share of expected strike×type×bars). */
  overallCoverage: number;
  /** Per-strike CE/PE coverage; `null` side ⇒ strike absent for that side. */
  strikes: Record<string, { CE: StrikeCov | null; PE: StrikeCov | null }>;
}

/**
 * The 6-function data API surface (07-data-layer §2). Declared here so both the
 * browser `OptionsDataClient` and the Python parity stub bind to the same shape.
 * Implementations live in later steps (client.ts / duck-browser.ts); this is the
 * pure contract only.
 */
export interface DataClient {
  loadIndex(sym: Sym, from: string, to: string, interval?: Interval): Promise<IndexBar[]>;
  loadOption(
    sym: Sym,
    expiry: string,
    strike: number,
    ot: OptionType,
    from: string,
    to: string,
    interval?: Interval
  ): Promise<OptionBar[]>;
  resolveStrike(
    sym: Sym,
    expiry: string,
    target: number,
    ot: OptionType,
    from: string,
    to: string
  ): Promise<StrikeResolution>;
  atmStrike(sym: Sym, expiry: string, at: string): Promise<number>;
  optionChainAt(sym: Sym, expiry: string, at: string): Promise<OptionBar[]>;
  coverageFor(sym: Sym, expiry: string, from: string, to: string): Promise<CoverageReport>;
}

/**
 * Re-export the engine vocabulary under explicit aliases so callers that need to
 * cross the data→engine boundary can import both shapes from one place WITHOUT
 * either type being redeclared. `EngineStrikeResolution` is what rides on a
 * trade; `EngineContractMeta` is the per-contract coverage the engine resolver
 * consumes. These compose with — they do not replace — the data-layer types above.
 */
export type { EngineContractMeta, EngineStrikeResolution };
