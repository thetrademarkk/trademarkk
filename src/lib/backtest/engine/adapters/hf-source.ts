/**
 * HF DATA SOURCE — the duckdb-wasm-over-HuggingFace implementation of the engine
 * `DataSource` interface (07-data-layer.md §2/§4/§5/§7; 06-engine-semantics §0/§8).
 * It is a DROP-IN alongside FixtureDataSource / LocalArchiveDataSource: the engine
 * never knows which one it holds.
 *
 * Why a PREFETCH-then-serve shape rather than a live async source: the engine's
 * `DataSource` is SYNCHRONOUS and per-day (it materializes a whole `DayData` and
 * replays it without awaiting inside the hot loop, see data-source.ts §0). HF
 * parquet reads are async (duckdb-wasm range reads behind a 302). So this module
 * splits in two:
 *   1. `createHfDataSource(...)` — an ASYNC factory that, given the StrategyDef's
 *      day spine + expiry rule, runs the §4/§5 SQL through an injected QueryFn,
 *      converts the parquet ISO-string rows to engine epoch-ms `Bar`s at the
 *      boundary, and materializes the canonical FixtureSnapshot shape.
 *   2. the returned source IS a `FixtureDataSource` over that snapshot — so the
 *      sync 6-fn interface, the resolve-strike ladder, ATM and coverage are all
 *      the COMMITTED, golden-tested code path. We do NOT reimplement any of it.
 *
 * BOUNDARY conversion (the one job unique to HF): parquet rows arrive as ISO IST
 * timestamp strings ("YYYY-MM-DD HH:MM:SS", schema.ts IndexBar/OptionBar); the
 * engine wants integer epoch-ms left-edge `Bar`s. IST is UTC+5:30 with no DST, so
 * the conversion mirrors resample.ts' IST_OFFSET_MS exactly.
 *
 * TESTABILITY: the factory takes an INJECTED `QueryFn` (default = the real
 * duck-browser `withConnection` runner, imported LAZILY so node/vitest never pull
 * in duckdb-wasm). Unit tests pass a fake QueryFn returning canned Arrow-like rows
 * — no browser, no network. This module itself imports NOTHING from duck-browser
 * at module scope; the real runner is `import()`-ed only when no QueryFn is given.
 *
 * HF reads are DIRECT (no proxy). The URLs are the stable urls.ts `resolve/main`
 * form; we never cache a resolved redirect target (signed ~1h Expires). Identical
 * in-flight day reads are coalesced by the caller's run (one query burst per run).
 */

import type { Sym, OptionType as DataOptionType } from "../../data/schema";
import { indexUrl, optionUrl, DATASET_VERSION } from "../../data/urls";
import { buildChainSlice, buildIndexSlice, buildOptionLeg } from "../../data/sql";
import type { QueryFn, QueryResult } from "../../data/duck-browser";
import { STRIKE_STEP, type IndexSymbol } from "../../../../features/backtest/shared/instruments";
import type { StrategyDef } from "../../../../features/backtest/shared/strategy-def";
import { expiryFor, tradingDays, type ExpiryKind } from "../../calendar/market-calendar";
import { resolveExpiryFromManifest } from "../../calendar/expiry-manifest";
import {
  FixtureDataSource,
  type FixtureContract,
  type FixtureDay,
  type FixtureSnapshot,
} from "./fixture-source";
import type { Bar, OptionType } from "../types";

/* ───────────────────────────── time boundary ─────────────────────────────── */

/** IST is UTC+5:30, no DST — mirrors resample.ts IST_OFFSET_MS. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Convert a parquet IST timestamp string ("YYYY-MM-DD HH:MM:SS", or the ISO "T"
 * separator) to the engine's integer epoch-ms left-edge. The stored time is a
 * wall-clock IST instant; epoch-ms = (that instant read as UTC) − IST offset.
 * Throws on a malformed string so a corrupt row can never silently shift a bar.
 */
export function istStringToEpochMs(ts: string): number {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(ts);
  if (!m) {
    throw new Error(`hf-source: unparseable IST timestamp ${JSON.stringify(ts)}`);
  }
  const utcAsIfIST = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.000Z`);
  return utcAsIfIST - IST_OFFSET_MS;
}

/* ───────────────────────── parquet row → engine Bar ──────────────────────── */

/**
 * A spot/index parquet row as projected by buildIndexSlice. The timestamp is the
 * §2 IST wall-clock string, aliased `ts` in SQL (sql.ts renders the stored
 * TIMESTAMPTZ to an IST string so the cell is never a Date/epoch here).
 */
interface IndexRow {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** An option-leg parquet row as projected by buildOptionLeg. */
interface OptionRow extends IndexRow {
  open_interest: number;
}

/** A chain-slice row as projected by buildChainSlice (full OHLCV + oi). */
interface ChainSliceRow extends OptionRow {
  strike: number;
  option_type: string;
}

/** Coerce a possibly-BigInt/Arrow numeric cell to a JS number. */
function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  return Number(v);
}

/** Coerce a possibly-Arrow string cell to a JS string. */
function str(v: unknown): string {
  return typeof v === "string" ? v : String(v);
}

/**
 * Note a per-day read that failed (a missing expiry file or a transient range-read
 * error). We DON'T throw — a missing slice is honest no-data for that day, and the
 * rest of the window still runs (07-data-layer §0.2). Logged at warn for
 * diagnosis; silent in node/test where `console.warn` is typically captured.
 */
function warnRead(what: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn(`[hf-source] no data for ${what}: ${msg.slice(0, 160)}`);
  }
}

/** Append `value` to the array at `key`, creating the bucket on first use. */
function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Map an index parquet row to an engine OHLCV `Bar` (no oi on spot). */
function indexRowToBar(r: IndexRow): Bar {
  return {
    ts: istStringToEpochMs(str(r.ts)),
    o: num(r.open),
    h: num(r.high),
    l: num(r.low),
    c: num(r.close),
    v: num(r.volume),
  };
}

/** Map an option parquet row to an engine `Bar` carrying open interest. */
function optionRowToBar(r: OptionRow): Bar {
  const bar = indexRowToBar(r);
  bar.oi = num(r.open_interest);
  return bar;
}

/* ──────────────────────────────── planning ───────────────────────────────── */

/**
 * The strike band (in POINTS) to scan around the spot-derived ATM for one run.
 * The chain must be wide enough to satisfy every leg's selector AND the §8.3
 * fallback ladder (±5 steps), with headroom. Computed PURELY from the StrategyDef
 * so the read stays as narrow as the strategy allows (the <2MB cold-read goal).
 *
 *   ATM_OFFSET steps   → |steps| strike-steps out.
 *   PERCENT pct        → |pct|% of a nominal spot (we use the band-from-pct at
 *                        query time against the real ATM; here we reserve a
 *                        generous absolute cushion proportional to step).
 *   PREMIUM / EXACT    → covered by the base fallback window + cushion.
 */
export const FALLBACK_STEPS = 5;
/** Extra strike-steps of headroom beyond the leg's own offset + fallback window. */
export const STRIKE_CUSHION_STEPS = 3;

export function strikeBandPts(strategy: StrategyDef): number {
  const index = strategy.market.symbol;
  const step = STRIKE_STEP[index];
  let maxStepsOut = 0;
  for (const leg of strategy.legs) {
    if (!leg.enabled) continue;
    const s = leg.strike;
    if (s.mode === "ATM_OFFSET") {
      maxStepsOut = Math.max(maxStepsOut, Math.abs(s.steps));
    } else if (s.mode === "PERCENT") {
      // |pct|% of spot ≈ that many points; convert to steps conservatively using
      // a nominal spot of 100 * step (NIFTY ~ 50*~400 ≈ 20000) — but we don't
      // have spot here, so reserve steps proportional to pct against a broad
      // 30000-point nominal so a 15% move is always inside the band.
      const nominalSpot = 30000;
      maxStepsOut = Math.max(
        maxStepsOut,
        Math.ceil(((Math.abs(s.pct) / 100) * nominalSpot) / step)
      );
    } else {
      // PREMIUM / EXACT: the base window + cushion covers a reasonable spread.
      maxStepsOut = Math.max(maxStepsOut, 0);
    }
  }
  const totalSteps = maxStepsOut + FALLBACK_STEPS + STRIKE_CUSHION_STEPS;
  return totalSteps * step;
}

/** One (trading day, resolved contract expiry) the engine will ask about. */
export interface DayExpiry {
  day: string;
  expiry: string;
}

/**
 * The exact (day, expiry) spine the engine will iterate, resolved with the SAME
 * rule the engine uses (the FIRST ENABLED leg's expiry, mirroring engine.ts), so
 * the prefetch loads precisely the (index, expiry, day) the replay loop requests.
 * `daysOfWeek` is honoured here too so we never fetch a filtered-out day.
 */
export function planDayExpiries(strategy: StrategyDef): DayExpiry[] {
  const index = strategy.market.symbol;
  const all = tradingDays(strategy.market.dateRange.start, strategy.market.dateRange.end, index);
  const dow = strategy.timing.daysOfWeek;
  const days =
    dow && dow.length > 0
      ? all.filter((d) => {
          const js = new Date(`${d}T12:00:00.000Z`).getUTCDay(); // Sun=0..Sat=6
          return dow.includes(js as 1 | 2 | 3 | 4 | 5);
        })
      : all;

  const rule = (strategy.legs.find((l) => l.enabled) ?? strategy.legs[0]!).expiry as ExpiryKind;
  // Resolve each day's contract from the DATASET MANIFEST first (the real traded
  // expiries) so we never point at a missing file when NSE/BSE shifted the
  // expiry weekday; fall back to the weekday-rule calendar only for days beyond
  // the dataset (where there is no file to read anyway).
  return days.map((day) => ({
    day,
    expiry: resolveExpiryFromManifest(index, day, rule) ?? expiryFor(index, day, rule),
  }));
}

/* ─────────────────────────── snapshot assembly ───────────────────────────── */

/** Stable snapshot id for an HF run (dataset + symbol + window). */
export function hfSnapshotId(strategy: StrategyDef): string {
  const { symbol, dateRange } = strategy.market;
  return `hf:v${DATASET_VERSION}:${symbol}:${dateRange.start}..${dateRange.end}`;
}

/** Group the (day, expiry) plan by the option file (expiry) we must read. */
function groupByExpiry(plan: DayExpiry[]): Map<string, string[]> {
  const byExpiry = new Map<string, string[]>();
  for (const { day, expiry } of plan) {
    const list = byExpiry.get(expiry);
    if (list) list.push(day);
    else byExpiry.set(expiry, [day]);
  }
  return byExpiry;
}

/** A bare-minimum ATM estimate from a day's index series open (first bar). */
function estimateAtm(index: IndexSymbol, indexBars: Bar[]): number | null {
  const first = indexBars[0];
  if (!first) return null;
  const step = STRIKE_STEP[index];
  return Math.round(first.o / step) * step;
}

/**
 * Fold the full-OHLCV chain-slice rows for one day into one `FixtureContract`
 * (with a full OHLCV+oi `bars` series) per (strike, side). The engine fills and
 * marks a resolved leg off these bars' real o/h/l/c, so we MUST carry the full
 * OHLCV here — collapsing to close would corrupt every intrabar SL/target fill.
 */
function contractsFromChain(rows: ChainSliceRow[]): FixtureContract[] {
  const byKey = new Map<string, FixtureContract>();
  for (const r of rows) {
    const strike = num(r.strike);
    const ot = str(r.option_type) as OptionType;
    if (ot !== "CE" && ot !== "PE") continue;
    const key = `${strike}-${ot}`;
    let c = byKey.get(key);
    if (!c) {
      c = { strike, optionType: ot, bars: [] };
      byKey.set(key, c);
    }
    c.bars.push(optionRowToBar(r));
  }
  for (const c of byKey.values()) c.bars.sort((a, b) => a.ts - b.ts);
  return [...byKey.values()];
}

/** Options for the HF prefetch / source factory. */
export interface HfSourceOptions {
  /**
   * Injected query runner (the TEST SEAM). Defaults to the real duck-browser
   * `withConnection` burst runner, imported lazily so node/vitest never load
   * duckdb-wasm. Tests pass a fake returning canned Arrow-like rows.
   */
  query?: QueryFn;
  /** Override the strike band (points) the chain scan covers; else derived. */
  bandPts?: number;
  /** Progress callback (0..1) as days are prefetched — drives the worker tick. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Resolve the real burst-query runner. Imported lazily — this is the ONLY place
 * the engine path can pull in duck-browser (and thus duckdb-wasm), and only at
 * call time in a browser/worker, never at module load and never in node/vitest.
 */
async function realQueryRunner(): Promise<QueryFn> {
  const mod = await import("../../data/duck-browser");
  // Hold ONE connection open for the whole prefetch burst (keep-alive socket).
  // We expose it as a QueryFn that the assembly loop calls repeatedly. Because
  // withConnection scopes the connection to its callback, we instead use the
  // one-shot `query` here; the per-day reads are already coalesced into a single
  // run and httpfs keep-alive reuses the socket across one-shot queries.
  return mod.query;
}

/**
 * ASYNC FACTORY — prefetch every (index, expiry, day) the run needs over HF via
 * the §4/§5 SQL, convert at the IST boundary, and return a sync `FixtureDataSource`
 * the engine consumes with ZERO further awaits. The heavy lifting (filter +
 * project + range pushdown) all happens in DuckDB SQL; this loop only converts
 * rows and assembles the in-memory snapshot.
 */
export async function createHfDataSource(
  strategy: StrategyDef,
  opts: HfSourceOptions = {}
): Promise<FixtureDataSource> {
  const index = strategy.market.symbol;
  const sym = index as Sym;
  const run: QueryFn = opts.query ?? (await realQueryRunner());
  const bandPts = opts.bandPts ?? strikeBandPts(strategy);

  const plan = planDayExpiries(strategy);
  const byExpiry = groupByExpiry(plan);
  const idxUrl = indexUrl(sym);

  const days: FixtureDay[] = [];
  let done = 0;
  const total = plan.length;
  const step = STRIKE_STEP[index];
  const { start, end } = strategy.market.dateRange;

  // (1) Index spot for the WHOLE window in ONE range read — DuckDB row-group
  //     stats prune to just the window's groups, so this is far cheaper than one
  //     read per day (the master grid for 60 days loads in a single request). A
  //     missing index file / transient error is HONEST no-data (07-data-layer
  //     §0.2): the affected days simply yield no bars. Split by IST trading day.
  const idxRowsByDay = new Map<string, IndexRow[]>();
  try {
    const idxRes = await run<IndexRow>(buildIndexSlice({ url: idxUrl, from: start, to: end }));
    for (const r of idxRes.toArray()) pushTo(idxRowsByDay, str(r.ts).slice(0, 10), r);
  } catch (err) {
    warnRead(`index ${sym} ${start}..${end}`, err);
  }

  // (2) Per EXPIRY FILE, read the full-OHLCV chain ONCE across that expiry's whole
  //     span of trading days (one parquet per expiry → one read covers the week of
  //     days that trade it), with a strike band wide enough to cover the ATM drift
  //     across those days. Then fold rows into per-(strike, side) contracts per
  //     day. This replaces ~N-days × 2-sides reads with ~N-expiries × 2-sides.
  for (const [expiry, expiryDays] of byExpiry) {
    const optUrl = optionUrl(sym, expiry);

    // Per-day index bars + each day's ATM estimate (drives the band center/width).
    const barsByDay = new Map<string, Bar[]>();
    const atms: number[] = [];
    for (const day of expiryDays) {
      const bars = (idxRowsByDay.get(day) ?? []).map(indexRowToBar);
      barsByDay.set(day, bars);
      const atm = estimateAtm(index, bars);
      if (atm !== null) atms.push(atm);
    }

    // One CE + one PE read covering [minATM, maxATM] ± the per-leg band over the
    // expiry's day span; grouped back to per-day rows. A missing option file is
    // honest no-data — those days contribute an empty chain, the window runs on.
    const chainRowsByDay = new Map<string, ChainSliceRow[]>();
    if (atms.length > 0) {
      const lo = Math.min(...atms);
      const hi = Math.max(...atms);
      const center = Math.round((lo + hi) / 2 / step) * step;
      const halfBand = Math.ceil((hi - lo) / 2 / step) * step + bandPts;
      const from = expiryDays[0]!;
      const to = expiryDays[expiryDays.length - 1]!;
      try {
        for (const ot of ["CE", "PE"] as const) {
          const res = await run<ChainSliceRow>(
            buildChainSlice({
              url: optUrl,
              optionType: ot,
              atm: center,
              bandPts: halfBand,
              from,
              to,
            })
          );
          for (const r of res.toArray()) pushTo(chainRowsByDay, str(r.ts).slice(0, 10), r);
        }
      } catch (err) {
        warnRead(`chain ${sym} ${expiry} ${from}..${to}`, err);
      }
    }

    for (const day of expiryDays) {
      days.push({
        day,
        expiry,
        index: barsByDay.get(day) ?? [],
        contracts: contractsFromChain(chainRowsByDay.get(day) ?? []),
      });
      done++;
      opts.onProgress?.(done, total);
    }
  }

  // The engine assumes an ascending day spine; expiry-grouped assembly is already
  // ascending, but sort defensively so an out-of-order plan can never mis-feed it.
  days.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  const snapshot: FixtureSnapshot = {
    snapshotId: hfSnapshotId(strategy),
    symbol: index,
    days,
  };
  return new FixtureDataSource(snapshot);
}

/**
 * Load ONE resolved option leg's FULL-OHLCV series for a (day, strike, side) —
 * the §4b read the engine needs once a strike is resolved. Exposed for a future
 * lazy-leg path; the prefetch above currently materializes chain CLOSE bars,
 * which the engine's mark/fill loop consumes directly. Kept here (and unit-tested)
 * so the OHLCV-leg conversion has one home. Pure aside from the injected runner.
 */
export async function loadResolvedLeg(
  sym: Sym,
  expiry: string,
  day: string,
  strike: number,
  optionType: DataOptionType,
  run: QueryFn
): Promise<Bar[]> {
  const url = optionUrl(sym, expiry);
  const res = await run<OptionRow>(buildOptionLeg({ url, strike, optionType, from: day, to: day }));
  return res.toArray().map(optionRowToBar);
}

/** Re-export the query result shape so callers/tests share one type. */
export type { QueryFn, QueryResult };
