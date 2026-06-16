/**
 * client.ts — the browser OptionsDataClient implementing the §2 SIX-FUNCTION
 * data API (07-data-layer.md §2 / §5 / §7) over duck-browser.query + the pure
 * sql.ts templates. This is the async, per-WINDOW wire surface the no-code TS
 * engine and the BYOC Pyodide stub both bind to (DataClient in schema.ts) — it is
 * DISTINCT from the synchronous, per-DAY engine DataSource (engine/data-source.ts):
 * the engine consumes a fully-materialized DayData per day, while THIS client
 * answers async questions about a window straight off parquet.
 *
 * Reuse, not reinvent (the committed, golden-tested foundation):
 *   - SQL is built ONLY in sql.ts (buildIndexSlice/Resample, buildOptionLeg/Resample,
 *     buildCoverageAgg, buildAtmFromSpot/AsOf, buildChainSnapshot). Every filter /
 *     aggregate / resample is pushed into DuckDB SQL — never a JS/pandas loop.
 *   - Strike resolution goes THROUGH the engine resolver (engine/resolve-strike.ts):
 *     resolveStrike / resolvePremiumStrike / atmStrike. The D2 hard-fail ceiling
 *     (a too-far OR too-illiquid substitute → null → MISSING_LEG) is honored by
 *     simply mapping the engine's `null` to the wire shape `reason: "none"`,
 *     `served: null` — we NEVER fabricate a fill.
 *   - resample interval semantics come from interval.ts (parseInterval) and the
 *     session-aligned SQL in sql.ts (which mirrors resample.ts byte-for-byte).
 *
 * Test seam (the WHOLE reason duckdb-wasm never appears here): the client takes an
 * INJECTED QueryFn (default = duck-browser's real `query`). Unit tests pass a fake
 * QueryFn returning canned Arrow-like rows ({ toArray, numRows }) so loadIndex /
 * loadOption / atmStrike / resolveStrike / coverageFor — including the missing-
 * strike (MISSING_LEG) path — are verifiable in node/vitest with NO browser, NO
 * network. duckdb-wasm + live HF range reads are covered by the playwright lane.
 *
 * Honest missing data (07-data-layer §0.2): a query that finds nothing returns a
 * TYPED empty result (an empty IndexBar[]/OptionBar[], or a StrikeResolution with
 * reason "none") — never a bare untyped `[]` with a hidden reason.
 */

import { STRIKE_STEP, type IndexSymbol } from "../../../features/backtest/shared/instruments";
import {
  ILLIQUID_COVERAGE,
  type ContractMeta,
  type StrikeIntent,
  type StrikeResolution as EngineStrikeResolution,
} from "../engine/types";
import {
  atmStrike as engineAtmStrike,
  resolvePremiumStrike,
  resolveStrike as engineResolveStrike,
} from "../engine/resolve-strike";
import { EXPECTED_BARS_PER_DAY } from "./coverage";
import { query as defaultQuery, type QueryFn } from "./duck-browser";
import { parseInterval } from "./interval";
import {
  buildAtmAsOf,
  buildAtmFromSpot,
  buildChainSnapshot,
  buildCoverageAgg,
  buildIndexResample,
  buildIndexSlice,
  buildOptionLeg,
  buildOptionLegResample,
} from "./sql";
import type {
  CoverageReport,
  DataClient,
  IndexBar,
  Interval,
  OptionBar,
  OptionType,
  StrikeResolution,
  StrikeCov,
  Sym,
} from "./schema";
import { DATASET_VERSION, indexUrl, optionUrl } from "./urls";

/* ─────────────────────────── raw parquet row shapes ──────────────────────── */

/**
 * An index/spot bar exactly as it comes off DuckDB. `timestamp` is whatever
 * `read_parquet` projects for the TIMESTAMP column — DuckDB-wasm materializes it
 * as a JS value via `toArray()`; we normalize it to the §2 ISO-ish IST string at
 * the boundary (toTsString). Resampled queries alias the bucket as `ts`, so we
 * accept either column name.
 */
interface RawIndexRow {
  timestamp?: unknown;
  ts?: unknown;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** A raw option bar — RawIndexRow + open_interest. */
interface RawOptionRow extends RawIndexRow {
  open_interest: number;
}

/** A raw coverage-aggregation row (buildCoverageAgg projection). */
interface RawCoverageRow {
  strike: number;
  option_type: string;
  present_bars: number;
  days: number;
  coverage: number;
  med_vol: number;
}

/** A raw chain-snapshot row (buildChainSnapshot projection). */
interface RawChainRow {
  strike: number;
  option_type: string;
  close: number;
  volume: number;
  open_interest: number;
}

/** A raw single-cell ATM row (buildAtmFromSpot / buildAtmAsOf projection). */
interface RawAtmRow {
  atm_strike: number;
}

/* ───────────────────────────── boundary helpers ──────────────────────────── */

/**
 * Normalize a parquet TIMESTAMP cell to the §2 "YYYY-MM-DD HH:MM:SS" IST string.
 * DuckDB-wasm may hand back a string already, a JS Date, or epoch-ms (number) for
 * a TIMESTAMP column depending on the build; we canonicalize all three. The stored
 * data is IST wall-clock, so a Date/number is rendered in UTC terms WITHOUT a
 * timezone shift (the epoch we get already encodes the IST wall-clock instant).
 */
export function toTsString(cell: unknown): string {
  if (typeof cell === "string") {
    // DuckDB string form may use a "T" separator or carry sub-second / "Z" — trim
    // to "YYYY-MM-DD HH:MM:SS".
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(cell);
    return m ? `${m[1]} ${m[2]}` : cell;
  }
  if (typeof cell === "number") {
    return new Date(cell).toISOString().slice(0, 19).replace("T", " ");
  }
  if (cell instanceof Date) {
    return cell.toISOString().slice(0, 19).replace("T", " ");
  }
  return String(cell);
}

/** Pull the timestamp column under either alias (`timestamp` raw / `ts` resampled). */
function rowTs(row: RawIndexRow): unknown {
  return row.timestamp ?? row.ts;
}

/** Coerce a possibly-bigint numeric cell (DuckDB BIGINT → JS bigint) to a number. */
function num(cell: unknown): number {
  if (typeof cell === "bigint") return Number(cell);
  if (typeof cell === "number") return cell;
  return Number(cell);
}

/* ───────────────────────────── interval helper ───────────────────────────── */

/**
 * Resolve an Interval token to its minute count, or `null` for a raw 1m pass.
 * "1m" (and any token parsing to 1 minute) returns null → the caller uses the
 * non-resampling slice builder (the resampler identity). A coarser token returns
 * its minute count for the session-aligned SQL `time_bucket`. An unparseable
 * token throws (programmer error — the builder gates on parseInterval first).
 */
function intervalMinutes(interval: Interval | undefined): number | null {
  if (interval === undefined || interval === "1m") return null;
  const parsed = parseInterval(interval);
  if (!parsed.valid || parsed.minutes === null) {
    throw new Error(`OptionsDataClient: unsupported interval ${JSON.stringify(interval)}`);
  }
  return parsed.minutes === 1 ? null : parsed.minutes;
}

/* ─────────────────────────── coverage → engine chain ─────────────────────── */

/**
 * Lower a data-layer CoverageReport to the engine resolver's ContractMeta[] — the
 * exact shape engine/resolve-strike.ts consumes. A `null` side (strike absent for
 * that side) is dropped; present sides become a ContractMeta carrying coverage +
 * medVol, so the resolver's coverage/liquidity ladder runs over REAL availability.
 */
export function chainFromCoverage(report: CoverageReport): ContractMeta[] {
  const chain: ContractMeta[] = [];
  for (const [strikeStr, sides] of Object.entries(report.strikes)) {
    const strike = Number(strikeStr);
    if (!Number.isFinite(strike)) continue;
    const ce = sides.CE;
    if (ce) chain.push({ strike, optionType: "CE", coverage: ce.coverage, medVol: ce.medVol });
    const pe = sides.PE;
    if (pe) chain.push({ strike, optionType: "PE", coverage: pe.coverage, medVol: pe.medVol });
  }
  return chain;
}

/**
 * Map the engine StrikeResolution (served:number, confidence) onto the §2 wire
 * StrikeResolution (served:number|null, reason discriminant). The engine has
 * already enforced the D2 hard-fail ceiling — a `null` engine result becomes the
 * honest `reason: "none"` wire value (never a fabricated fill).
 */
function toWireResolution(
  engine: EngineStrikeResolution | null,
  requested: number
): StrikeResolution {
  if (engine === null) {
    return {
      requested,
      served: null,
      distancePts: Infinity,
      coveragePct: 0,
      illiquid: true,
      reason: "none",
    };
  }
  const distancePts = Math.abs(engine.served - engine.requested);
  return {
    requested: engine.requested,
    served: engine.served,
    distancePts,
    coveragePct: engine.coverage,
    illiquid: engine.coverage < ILLIQUID_COVERAGE,
    // engine confidence "high" === exact (served===requested, fallbackSteps 0);
    // anything else that resolved is a "nearest" substitute.
    reason: engine.fallbackSteps === 0 && distancePts === 0 ? "exact" : "nearest",
  };
}

/* ─────────────────────────────── the client ──────────────────────────────── */

/** Construction options — the test seam is the injectable QueryFn. */
export interface OptionsDataClientOptions {
  /**
   * The query executor. Defaults to duck-browser's real `query` (one-shot
   * connection per call). Tests inject a fake returning canned Arrow-like rows so
   * the client is exercised with NO browser / NO network.
   */
  query?: QueryFn;
}

/**
 * The browser data client. Implements the §2 six-function DataClient over SQL +
 * the engine resolver. Holds NO duckdb-wasm reference — only the injected QueryFn
 * — so it is fully unit-testable.
 */
export class OptionsDataClient implements DataClient {
  private readonly query: QueryFn;

  /**
   * Snapshot id stamped through to consumers for reproducibility: the dataset
   * repo at its current cache version. (resolve/main always points at the latest
   * commit; DATASET_VERSION is bumped on a parquet rewrite — 07-data-layer §6.)
   */
  readonly snapshotId = `hf:thetrademarkk/india-index-options-1m@v${DATASET_VERSION}`;

  constructor(options: OptionsDataClientOptions = {}) {
    this.query = options.query ?? defaultQuery;
  }

  /** (1) Index spot slice for a window, optionally resampled in SQL. */
  async loadIndex(sym: Sym, from: string, to: string, interval?: Interval): Promise<IndexBar[]> {
    const url = indexUrl(sym, "https");
    const mins = intervalMinutes(interval);
    const sql =
      mins === null
        ? buildIndexSlice({ url, from, to })
        : buildIndexResample({ url, from, to, intervalMinutes: mins });
    const res = await this.query<RawIndexRow>(sql);
    return res.toArray().map(toIndexBar);
  }

  /** (2) One resolved option leg for a window, optionally resampled in SQL. */
  async loadOption(
    sym: Sym,
    expiry: string,
    strike: number,
    ot: OptionType,
    from: string,
    to: string,
    interval?: Interval
  ): Promise<OptionBar[]> {
    const url = optionUrl(sym, expiry, "https");
    const mins = intervalMinutes(interval);
    const sql =
      mins === null
        ? buildOptionLeg({ url, strike, optionType: ot, from, to })
        : buildOptionLegResample({ url, strike, optionType: ot, from, to, intervalMinutes: mins });
    const res = await this.query<RawOptionRow>(sql);
    return res.toArray().map((row) => toOptionBar(row, strike, ot));
  }

  /**
   * (3) Resolve a requested strike against the AVAILABLE chain over the window,
   * THROUGH the engine resolver. `target` is the already-computed integer strike
   * the strategy asked for (ATM±N / %offset / exact are pre-resolved upstream); we
   * treat it as an `exact` intent so the resolver's fallback ladder + D2 hard-fail
   * run, then map back to the §2 wire shape. A missing strike is `reason: "none"`,
   * `served: null` — the MISSING_LEG path — NEVER a bare `[]`.
   */
  async resolveStrike(
    sym: Sym,
    expiry: string,
    target: number,
    ot: OptionType,
    from: string,
    to: string
  ): Promise<StrikeResolution> {
    const report = await this.coverageFor(sym, expiry, from, to);
    const chain = chainFromCoverage(report);
    const intent: StrikeIntent = { kind: "exact", strike: target };
    // `spot` is unused for an exact intent (idealStrike returns the strike
    // directly); pass the target as a harmless placeholder so the engine signature
    // is satisfied.
    const engine = engineResolveStrike(sym as IndexSymbol, chain, ot, intent, target);
    return toWireResolution(engine, target);
  }

  /**
   * (4) ATM strike from the spot CLOSE at a timestamp (07-data-layer §5), snapped
   * to the symbol's strike step IN SQL. Falls back to the last bar AT OR BEFORE
   * `at` when the exact minute is missing (holiday minute / halt). Returns a
   * finite strike; throws only if the spot file has no bar at or before `at`
   * (a window with no data at all — a programmer/config error, not a missing
   * strike).
   */
  async atmStrike(sym: Sym, expiry: string, at: string): Promise<number> {
    void expiry; // ATM is computed from the index spot, independent of the chain.
    const url = indexUrl(sym, "https");
    const step = STRIKE_STEP[sym as IndexSymbol];
    // Exact-minute read first (single bar); fall back to as-of if empty.
    const exact = await this.query<RawAtmRow>(buildAtmFromSpot({ url, at, step }));
    const exactRows = exact.toArray();
    const exactRow = exactRows[0];
    if (exactRow) return num(exactRow.atm_strike);
    const asOf = await this.query<RawAtmRow>(buildAtmAsOf({ url, at, step }));
    const asOfRow = asOf.toArray()[0];
    if (asOfRow) return num(asOfRow.atm_strike);
    throw new Error(`atmStrike: no spot bar at or before ${at} for ${sym}`);
  }

  /**
   * (5) The option chain at a single timestamp — one snapshot row per (strike,
   * side). Returns OptionBar[] (close as o/h/l/c since a snapshot is one print).
   */
  async optionChainAt(sym: Sym, expiry: string, at: string): Promise<OptionBar[]> {
    const url = optionUrl(sym, expiry, "https");
    const res = await this.query<RawChainRow>(buildChainSnapshot({ url, at }));
    return res.toArray().map((row) => chainRowToOptionBar(row, at));
  }

  /**
   * (6) The coverage report for a (symbol, expiry) over a window (07-data-layer
   * §7a). Pushes ALL aggregation into DuckDB (buildCoverageAgg); the browser only
   * shapes the rows into the §2 manifest. `overallCoverage` is the mean served
   * coverage across present (strike, side) cells.
   */
  async coverageFor(sym: Sym, expiry: string, from: string, to: string): Promise<CoverageReport> {
    const url = optionUrl(sym, expiry, "https");
    const sql = buildCoverageAgg({ url, from, to, expectedBarsPerDay: EXPECTED_BARS_PER_DAY });
    const res = await this.query<RawCoverageRow>(sql);
    return buildCoverageReport(sym, expiry, res.toArray());
  }
}

/* ──────────────────────────── pure row mappers ───────────────────────────── */

/** Raw parquet row → §2 IndexBar (ISO-string ts, numeric OHLCV). Pure. */
export function toIndexBar(row: RawIndexRow): IndexBar {
  return {
    ts: toTsString(rowTs(row)),
    open: num(row.open),
    high: num(row.high),
    low: num(row.low),
    close: num(row.close),
    volume: num(row.volume),
  };
}

/** Raw parquet row → §2 OptionBar (adds strike / side / oi). Pure. */
export function toOptionBar(row: RawOptionRow, strike: number, ot: OptionType): OptionBar {
  return {
    ...toIndexBar(row),
    strike,
    optionType: ot,
    oi: num(row.open_interest),
  };
}

/**
 * A one-minute chain-snapshot row → OptionBar. A snapshot is a single print, so
 * o/h/l/c all carry the snapshot close; volume + oi come straight through.
 */
function chainRowToOptionBar(row: RawChainRow, at: string): OptionBar {
  const close = num(row.close);
  const ot: OptionType = row.option_type === "PE" ? "PE" : "CE";
  return {
    ts: toTsString(at),
    open: close,
    high: close,
    low: close,
    close,
    volume: num(row.volume),
    strike: num(row.strike),
    optionType: ot,
    oi: num(row.open_interest),
  };
}

/**
 * Assemble the §2 CoverageReport from the aggregation rows. Strikes are keyed by
 * the stringified strike; each side is StrikeCov or null (absent). overallCoverage
 * = mean of the present-cell coverages (0 when the window is empty). tradingDays
 * is left empty here — the per-day list is a manifest concern derived from the
 * window bounds upstream; the §7a aggregation only yields per-strike DAY COUNTS.
 */
export function buildCoverageReport(
  sym: Sym,
  expiry: string,
  rows: RawCoverageRow[]
): CoverageReport {
  const strikes: CoverageReport["strikes"] = {};
  let covSum = 0;
  let covCount = 0;

  for (const row of rows) {
    const strike = num(row.strike);
    const key = String(strike);
    const side: OptionType = row.option_type === "PE" ? "PE" : "CE";
    const coverage = clampCoverage(num(row.coverage));
    const entry: StrikeCov = {
      coverage,
      medVol: num(row.med_vol),
      days: num(row.days),
    };
    const slot = strikes[key] ?? { CE: null, PE: null };
    slot[side] = entry;
    strikes[key] = slot;
    covSum += coverage;
    covCount += 1;
  }

  return {
    symbol: sym,
    expiry,
    datasetVersion: DATASET_VERSION,
    tradingDays: [],
    expectedBarsPerDay: EXPECTED_BARS_PER_DAY,
    strikeStep: STRIKE_STEP[sym as IndexSymbol],
    overallCoverage: covCount === 0 ? 0 : covSum / covCount,
    strikes,
  };
}

/** Clamp a coverage fraction to [0,1] (a sparse window can over-count rarely). */
function clampCoverage(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Convenience: the ATM-derived helpers re-exported for callers that already have
 * a chain in hand and want the engine's nearest-available ATM (07-data-layer §5).
 * Thin pass-through to the engine resolver — kept here so client consumers import
 * one module.
 */
export function atmFromChain(sym: Sym, chain: ContractMeta[], spot: number): number | null {
  void sym;
  return engineAtmStrike(chain, spot);
}

/**
 * Convenience: premium-based resolution against a window's chain + a strike→price
 * map (the entry-bar option opens). Wraps the engine resolvePremiumStrike and maps
 * to the §2 wire shape, so a "by premium" selector shares the client's honest
 * missing-data contract. The `target` premium is the requested premium; the served
 * strike is what the resolver chose (or `reason: "none"` if nothing is close
 * enough — the D2 premium-deviation ceiling).
 */
export function resolvePremiumWire(
  sym: Sym,
  report: CoverageReport,
  ot: OptionType,
  target: number,
  band: { min: number; max: number } | undefined,
  prices: Map<number, number>,
  spot: number
): StrikeResolution {
  const chain = chainFromCoverage(report);
  const engine = resolvePremiumStrike(sym as IndexSymbol, chain, ot, target, band, prices, spot);
  return toWireResolution(engine, target);
}
