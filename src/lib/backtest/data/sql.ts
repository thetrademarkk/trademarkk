/**
 * SQL TEMPLATE BUILDERS — the pure, unit-testable string layer the duckdb-wasm
 * client runs (07-data-layer.md §4 / §5 / §7). NOTHING here touches DuckDB or the
 * network: every function takes plain inputs and returns a SQL string. That is
 * exactly what makes the query layer testable in node/vitest without a browser.
 *
 * Two universal rules, ENFORCED by every builder here (07-data-layer §4):
 *   (a) project ONLY the needed columns — never `SELECT *`;
 *   (b) push `trading_day` (and `timestamp` when intraday-bounded) + `strike` /
 *       `option_type` predicates into the `read_parquet(...)` scan so DuckDB's
 *       row-group stats prune ~99% of the file.
 *
 * Parameterization model: DuckDB-wasm's `query()` takes a finished SQL string, so
 * these builders emit COMPLETE SQL with values inlined through the strict literal
 * quoters below (`sqlDate`, `sqlTimestamp`, `sqlInt`, `sqlStr`, `sqlIdent`). The
 * quoters validate-or-throw — a malformed date / non-integer strike / unknown
 * option side can NEVER reach the SQL string, so there is no injection surface
 * even though we inline (the only free-form input — the parquet URL — is built by
 * urls.ts from a frozen repo id + a validated symbol/expiry, never user text).
 *
 * Resample semantics MIRROR resample.ts EXACTLY (07-data-layer §4a): buckets are
 * aligned to the 09:15 IST session open via `time_bucket(INTERVAL, ts, ORIGIN)`,
 * OHLC = first(open)/max(high)/min(low)/last(close), volume = sum, and a bucket
 * never crosses a trading-day boundary (we bucket per day by also grouping on
 * `trading_day`). The TS `resample()` and this SQL MUST produce byte-identical
 * candles — the contract the golden tests pin.
 */

import { SESSION_MINUTES } from "./interval";
import type { OptionType } from "./schema";

/* ───────────────────────────── literal quoters ───────────────────────────── */

/** "YYYY-MM-DD". Strict — a malformed date throws (never reaches SQL). */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DDTHH:MM:SS" (T or space). Strict. */
const TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/;

/** A bare SQL string literal with `'` escaped by doubling. */
export function sqlStr(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** A `DATE '...'` literal; throws on a non `YYYY-MM-DD` input. */
export function sqlDate(day: string): string {
  if (!DATE_RE.test(day)) {
    throw new Error(`sqlDate: expected YYYY-MM-DD, got ${JSON.stringify(day)}`);
  }
  return `DATE '${day}'`;
}

/**
 * A `TIMESTAMP '...'` literal; accepts "YYYY-MM-DD HH:MM:SS" or the ISO "T"
 * separator and normalizes to a space (DuckDB accepts both, we canonicalize).
 * Throws on anything else.
 */
export function sqlTimestamp(ts: string): string {
  const m = TIMESTAMP_RE.exec(ts);
  if (!m) {
    throw new Error(`sqlTimestamp: expected 'YYYY-MM-DD HH:MM:SS', got ${JSON.stringify(ts)}`);
  }
  return `TIMESTAMP '${m[1]} ${m[2]}'`;
}

/** An integer literal; throws on a non-integer (strike, offset, etc.). */
export function sqlInt(n: number): string {
  if (!Number.isInteger(n)) {
    throw new Error(`sqlInt: expected an integer, got ${JSON.stringify(n)}`);
  }
  return String(n);
}

/** A CE/PE side literal; throws on anything else. */
export function sqlOptionType(ot: OptionType): string {
  if (ot !== "CE" && ot !== "PE") {
    throw new Error(`sqlOptionType: expected 'CE' | 'PE', got ${JSON.stringify(ot)}`);
  }
  return `'${ot}'`;
}

/**
 * Quote a parquet source for `read_parquet(...)`. The URL is always built by
 * urls.ts from a frozen repo id; we still single-quote-escape defensively and
 * reject embedded quotes/whitespace so a malformed URL can't break out.
 */
export function sqlSource(url: string): string {
  if (/['\s]/.test(url)) {
    throw new Error(`sqlSource: refusing suspicious parquet URL ${JSON.stringify(url)}`);
  }
  return sqlStr(url);
}

/* ───────────────────────────── resample ORIGIN ───────────────────────────── */

/**
 * The session-open ORIGIN for `time_bucket`. resample.ts aligns minute buckets to
 * 09:15 IST (minute-of-day 555). DuckDB's `time_bucket(INTERVAL, ts, ORIGIN)`
 * snaps buckets to `ORIGIN + k*INTERVAL`; any timestamp on the same wall-clock
 * 09:15 boundary works as the origin because the data is stored in IST. We use a
 * fixed, dataset-era origin date — the bucket index only depends on the
 * time-of-day offset, not the origin's calendar date.
 */
export const SESSION_ORIGIN = "1970-01-01 09:15:00" as const;

/** Standard projected columns for an index/spot bar (no `SELECT *`, §4). */
const INDEX_COLS = "timestamp, open, high, low, close, volume";
/** Standard projected columns for an option bar (adds open_interest, §4b). */
const OPTION_COLS = "timestamp, open, high, low, close, volume, open_interest";

/** Map a parsed minute count to a DuckDB INTERVAL literal. */
function minutesInterval(minutes: number): string {
  return `INTERVAL '${sqlInt(minutes)} minutes'`;
}

/* ─────────────────────────────── 4a · index ─────────────────────────────── */

/** Inputs shared by the index-slice builders. */
export interface IndexSliceArgs {
  /** The resolved parquet URL (browser HTTPS resolve/main form). */
  url: string;
  /** "YYYY-MM-DD" inclusive window start. */
  from: string;
  /** "YYYY-MM-DD" inclusive window end. */
  to: string;
}

/**
 * 07-data-layer §4a — raw 1m index slice with `trading_day` pushdown + column
 * projection. ORDER BY timestamp ascending (the engine assumes ascending series).
 */
export function buildIndexSlice({ url, from, to }: IndexSliceArgs): string {
  return [
    `SELECT ${INDEX_COLS}`,
    `FROM read_parquet(${sqlSource(url)})`,
    `WHERE trading_day BETWEEN ${sqlDate(from)} AND ${sqlDate(to)}`,
    `ORDER BY timestamp`,
  ].join("\n");
}

/**
 * 07-data-layer §4a — index slice RESAMPLED to `intervalMinutes` IN SQL via
 * session-aligned `time_bucket`. Buckets never cross a day (we also group on
 * `trading_day`), exactly mirroring resample.ts. OHLC/volume aggregation matches
 * resample.ts: first(open)/max/min/last(close)/sum(volume), left-edge ts.
 *
 * Pass `intervalMinutes === 1` and you should instead use buildIndexSlice (the
 * resampler identity); a 1m bucket here would still be correct but pointless.
 * For a whole-session (1d) roll-up pass `intervalMinutes === SESSION_MINUTES`,
 * which buckets exactly one bar per trading day.
 */
export function buildIndexResample(args: IndexSliceArgs & { intervalMinutes: number }): string {
  const { url, from, to, intervalMinutes } = args;
  const bucket = `time_bucket(${minutesInterval(intervalMinutes)}, timestamp, TIMESTAMP ${sqlStr(SESSION_ORIGIN)})`;
  return [
    `SELECT`,
    `  ${bucket} AS ts,`,
    `  first(open ORDER BY timestamp) AS open,`,
    `  max(high) AS high,`,
    `  min(low) AS low,`,
    `  last(close ORDER BY timestamp) AS close,`,
    `  sum(volume) AS volume`,
    `FROM read_parquet(${sqlSource(url)})`,
    `WHERE trading_day BETWEEN ${sqlDate(from)} AND ${sqlDate(to)}`,
    `GROUP BY trading_day, ts`,
    `ORDER BY ts`,
  ].join("\n");
}

/* ──────────────────────────── 4b · option leg ───────────────────────────── */

/** Inputs for a single resolved option-leg query. */
export interface OptionLegArgs {
  /** The resolved options-expiry parquet URL. */
  url: string;
  /** Integer strike (e.g. 21500). */
  strike: number;
  /** CE / PE. */
  optionType: OptionType;
  from: string;
  to: string;
}

/**
 * 07-data-layer §4b — one option leg with FULL predicate pushdown
 * (`trading_day` + `strike` + `option_type`) so DuckDB reads only the row groups
 * bracketing this strike. Projects OHLCV + open_interest only.
 */
export function buildOptionLeg({ url, strike, optionType, from, to }: OptionLegArgs): string {
  return [
    `SELECT ${OPTION_COLS}`,
    `FROM read_parquet(${sqlSource(url)})`,
    `WHERE trading_day BETWEEN ${sqlDate(from)} AND ${sqlDate(to)}`,
    `  AND strike = ${sqlInt(strike)}`,
    `  AND option_type = ${sqlOptionType(optionType)}`,
    `ORDER BY timestamp`,
  ].join("\n");
}

/**
 * Same leg, resampled to `intervalMinutes` IN SQL (session-aligned, per-day),
 * for coarser-timeframe option series. Mirrors buildIndexResample + the leg
 * predicate pushdown. open_interest = last print in the bucket (matches
 * resample.ts which carries oi forward as the last value).
 */
export function buildOptionLegResample(args: OptionLegArgs & { intervalMinutes: number }): string {
  const { url, strike, optionType, from, to, intervalMinutes } = args;
  const bucket = `time_bucket(${minutesInterval(intervalMinutes)}, timestamp, TIMESTAMP ${sqlStr(SESSION_ORIGIN)})`;
  return [
    `SELECT`,
    `  ${bucket} AS ts,`,
    `  first(open ORDER BY timestamp) AS open,`,
    `  max(high) AS high,`,
    `  min(low) AS low,`,
    `  last(close ORDER BY timestamp) AS close,`,
    `  sum(volume) AS volume,`,
    `  last(open_interest ORDER BY timestamp) AS open_interest`,
    `FROM read_parquet(${sqlSource(url)})`,
    `WHERE trading_day BETWEEN ${sqlDate(from)} AND ${sqlDate(to)}`,
    `  AND strike = ${sqlInt(strike)}`,
    `  AND option_type = ${sqlOptionType(optionType)}`,
    `GROUP BY trading_day, ts`,
    `ORDER BY ts`,
  ].join("\n");
}

/* ───────────────────────── 4c · strike-range / chain ──────────────────────── */

/** Inputs for a ±band chain scan around an estimated ATM. */
export interface StrikeRangeArgs {
  url: string;
  optionType: OptionType;
  /** Estimated ATM strike (integer) the band centers on. */
  atm: number;
  /** Band half-width in POINTS (e.g. 300 → atm ± 300). */
  bandPts: number;
  from: string;
  to: string;
}

/**
 * 07-data-layer §4c — all strikes within ±`bandPts` of `atm` for one side over a
 * day window. Used by resolve / chain / "by premium" / "by delta" selection. The
 * strike predicate is range-pushed; only the columns those selectors need are
 * projected.
 */
export function buildStrikeRange({
  url,
  optionType,
  atm,
  bandPts,
  from,
  to,
}: StrikeRangeArgs): string {
  if (!Number.isInteger(bandPts) || bandPts < 0) {
    throw new Error(`buildStrikeRange: bandPts must be a non-negative integer, got ${bandPts}`);
  }
  const lo = sqlInt(atm - bandPts);
  const hi = sqlInt(atm + bandPts);
  return [
    `SELECT strike, option_type, timestamp, close, volume, open_interest`,
    `FROM read_parquet(${sqlSource(url)})`,
    `WHERE trading_day BETWEEN ${sqlDate(from)} AND ${sqlDate(to)}`,
    `  AND option_type = ${sqlOptionType(optionType)}`,
    `  AND strike BETWEEN ${lo} AND ${hi}`,
    `ORDER BY strike, timestamp`,
  ].join("\n");
}

/**
 * Full-OHLCV CHAIN SLICE: every bar for every strike of one side within
 * ±`bandPts` of `atm`, over a day window (07-data-layer §4c, OHLC variant). Where
 * buildStrikeRange projects only close/volume/oi (enough for availability +
 * coverage + premium-at-entry), THIS projects the full OHLCV+oi the ENGINE needs
 * to fill/mark a resolved leg — so a whole day's tradeable chain loads in ONE read
 * per side (the prefetch path of the HF data source). Same strike + day + side
 * pushdown so DuckDB prunes to just the band's row groups.
 */
export function buildChainSlice({
  url,
  optionType,
  atm,
  bandPts,
  from,
  to,
}: StrikeRangeArgs): string {
  if (!Number.isInteger(bandPts) || bandPts < 0) {
    throw new Error(`buildChainSlice: bandPts must be a non-negative integer, got ${bandPts}`);
  }
  const lo = sqlInt(atm - bandPts);
  const hi = sqlInt(atm + bandPts);
  return [
    `SELECT strike, option_type, ${OPTION_COLS}`,
    `FROM read_parquet(${sqlSource(url)})`,
    `WHERE trading_day BETWEEN ${sqlDate(from)} AND ${sqlDate(to)}`,
    `  AND option_type = ${sqlOptionType(optionType)}`,
    `  AND strike BETWEEN ${lo} AND ${hi}`,
    `ORDER BY strike, timestamp`,
  ].join("\n");
}

/**
 * A one-minute CHAIN SNAPSHOT: one close+volume+oi row per (strike, side) at a
 * single timestamp `at` (07-data-layer §2 `optionChainAt`). The timestamp
 * predicate makes this a tiny read. If the exact minute is missing the caller
 * falls back to the as-of variant below.
 */
export function buildChainSnapshot(args: { url: string; at: string }): string {
  const { url, at } = args;
  return [
    `SELECT strike, option_type, close, volume, open_interest`,
    `FROM read_parquet(${sqlSource(url)})`,
    `WHERE timestamp = ${sqlTimestamp(at)}`,
    `ORDER BY strike, option_type`,
  ].join("\n");
}

/* ─────────────────────────────── 5 · ATM ────────────────────────────────── */

/**
 * 07-data-layer §5 — ATM strike from the spot CLOSE at an exact minute, snapped
 * to `step`. Reads one spot bar.
 */
export function buildAtmFromSpot(args: { url: string; at: string; step: number }): string {
  const { url, at, step } = args;
  const s = sqlInt(step);
  return [
    `SELECT CAST(round(close / ${s}) * ${s} AS INTEGER) AS atm_strike`,
    `FROM read_parquet(${sqlSource(url)})`,
    `WHERE timestamp = ${sqlTimestamp(at)}`,
  ].join("\n");
}

/**
 * 07-data-layer §5 — ATM fallback: snap the LAST spot bar AT OR BEFORE `at` when
 * the exact minute is missing (holiday minute / halt).
 */
export function buildAtmAsOf(args: { url: string; at: string; step: number }): string {
  const { url, at, step } = args;
  const s = sqlInt(step);
  return [
    `SELECT CAST(round(close / ${s}) * ${s} AS INTEGER) AS atm_strike`,
    `FROM read_parquet(${sqlSource(url)})`,
    `WHERE timestamp <= ${sqlTimestamp(at)}`,
    `ORDER BY timestamp DESC`,
    `LIMIT 1`,
  ].join("\n");
}

/* ──────────────────────────── 7a · coverage agg ──────────────────────────── */

/**
 * 07-data-layer §7a — per-(strike, side) coverage aggregation for one expiry
 * file over a window. `present_bars / (distinct_days * expectedBarsPerDay)` =
 * coverage; median(volume) = the liquidity signal; distinct days printed. ALL
 * aggregation in DuckDB — the browser never re-derives coverage row-by-row.
 *
 * `expectedBarsPerDay` defaults to the §7a constant 375; it is inlined (not a
 * subquery on the file) so the denominator is the SESSION expectation, matching
 * coverage.ts EXPECTED_BARS_PER_DAY.
 */
export function buildCoverageAgg(args: {
  url: string;
  from: string;
  to: string;
  expectedBarsPerDay?: number;
}): string {
  const { url, from, to, expectedBarsPerDay = SESSION_MINUTES } = args;
  const expected = sqlInt(expectedBarsPerDay);
  return [
    `WITH win AS (`,
    `  SELECT strike, option_type, volume, trading_day`,
    `  FROM read_parquet(${sqlSource(url)})`,
    `  WHERE trading_day BETWEEN ${sqlDate(from)} AND ${sqlDate(to)}`,
    `)`,
    `SELECT`,
    `  strike,`,
    `  option_type,`,
    `  count(*) AS present_bars,`,
    `  count(DISTINCT trading_day) AS days,`,
    `  count(*) * 1.0 / (count(DISTINCT trading_day) * ${expected}) AS coverage,`,
    `  median(volume) AS med_vol`,
    `FROM win`,
    `GROUP BY strike, option_type`,
    `ORDER BY strike, option_type`,
  ].join("\n");
}

/* ─────────────────────────── 7c · gap detection ──────────────────────────── */

/**
 * 07-data-layer §7c — gap detection for one resolved leg on one day: a minute
 * grid 09:15–15:30 LEFT JOINed to the leg's real bars, flagging `is_gap` where no
 * bar printed. The caller classifies run-lengths via coverage.ts classifyGap
 * (≤3 → LOCF, >3 → snap, whole-day → excluded). The grid bound end is EXCLUSIVE
 * of 15:30 (the engine never trades the 15:30 bar), giving exactly 375 slots.
 */
export function buildGapGrid(args: {
  url: string;
  day: string;
  strike: number;
  optionType: OptionType;
}): string {
  const { url, day, strike, optionType } = args;
  const open = sqlTimestamp(`${day} 09:15:00`);
  const close = sqlTimestamp(`${day} 15:30:00`);
  return [
    `WITH grid AS (`,
    `  SELECT ts`,
    `  FROM range(${open}, ${close}, INTERVAL '1 minute') t(ts)`,
    `),`,
    `bars AS (`,
    `  SELECT timestamp, close`,
    `  FROM read_parquet(${sqlSource(url)})`,
    `  WHERE trading_day = ${sqlDate(day)}`,
    `    AND strike = ${sqlInt(strike)}`,
    `    AND option_type = ${sqlOptionType(optionType)}`,
    `)`,
    `SELECT g.ts, b.close, (b.close IS NULL) AS is_gap`,
    `FROM grid g LEFT JOIN bars b ON g.ts = b.timestamp`,
    `ORDER BY g.ts`,
  ].join("\n");
}
