/**
 * resample.ts — the pure 1m→Nm time-bucketing resampler that lets the builder
 * offer ARBITRARY timeframes (06-engine-semantics §1.4, 07-data-layer §4a, and
 * docs/backtesting/13-strike-and-timeframe-ux.md §"Timeframe" step 1).
 *
 * Contract (matches the DuckDB `time_bucket` semantics in 07-data-layer §4a):
 *   bucket.open   = first(open  ORDER BY ts)
 *   bucket.high   = max(high)
 *   bucket.low    = min(low)
 *   bucket.close  = last(close ORDER BY ts)
 *   bucket.volume = sum(volume)
 *
 * IST session-aware bucketing:
 *   - Buckets are aligned to the 09:15 session open (minute-of-day 555), NOT to
 *     the wall-clock hour. So a 5m grid is 09:15–09:19, 09:20–09:24, … This is
 *     exactly DuckDB `time_bucket(INTERVAL '5 minutes', ts, ORIGIN '…09:15')`.
 *   - Buckets NEVER cross a trading-day boundary: each day restarts the grid at
 *     its own 09:15. (Day-segmented replay, §1.3.) A non-divisor interval (7m)
 *     therefore yields a shorter trailing candle on every day — never a candle
 *     that straddles two sessions.
 *   - 1d collapses a whole session into one bar; 1w rolls up by ISO week.
 *
 * No look-ahead: a bucket's bar is emitted with the LEFT-edge timestamp (the
 * first member minute) and is only "complete" once every member minute has been
 * seen — the engine consumes a fully-materialized day, so all buckets here are
 * complete; the streaming notes below cover the incremental case.
 *
 * Pure & deterministic: no Date.now, no Math.random, no I/O. Operates on the
 * engine `Bar` ({ts,o,h,l,c,v,oi?}) so the output drops straight into the
 * replay loop's entry/exit-condition grid (risk still scans native 1m).
 */

import type { Bar, Series } from "../engine/types";
import { parseInterval, SESSION_MINUTES, type ParsedInterval } from "./interval";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
/** Session open minute-of-day (09:15 IST). Buckets align to this. */
const SESSION_OPEN_MIN = 555;

/** IST minute-of-day (0..1439) from an epoch-ms bar timestamp. Mirrors engine.ts. */
export function minuteOfDayIST(ts: number): number {
  const istMs = ts + IST_OFFSET_MS;
  const dayMs = ((istMs % DAY_MS) + DAY_MS) % DAY_MS;
  return Math.floor(dayMs / MIN_MS);
}

/** IST midnight epoch-ms for the day containing `ts` (the day's 00:00 IST). */
function istDayStartMs(ts: number): number {
  const istMs = ts + IST_OFFSET_MS;
  const dayIndex = Math.floor(istMs / DAY_MS);
  return dayIndex * DAY_MS - IST_OFFSET_MS;
}

/** "YYYY-MM-DD" IST trading-day key for a bar timestamp. */
export function tradingDayIST(ts: number): string {
  return new Date(ts + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * ISO-week key ("YYYY-Www") of the IST day containing `ts`. Used by the 1w
 * roll-up so a holiday-shortened week still groups into one candle.
 */
export function isoWeekKeyIST(ts: number): string {
  const d = new Date(ts + IST_OFFSET_MS);
  // ISO week: Thursday-anchored. Work in UTC on the shifted date.
  const day = d.getUTCDay() || 7; // Mon=1..Sun=7
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * The integer bucket key for a minute bar under a minute-interval grid aligned
 * to the session open. Within a single day this is monotonic, starting at 0 for
 * the 09:15 bucket. Bars before the session open (shouldn't happen in the
 * dataset) clamp to bucket 0.
 */
function minuteBucketIndex(ts: number, intervalMin: number): number {
  const mod = minuteOfDayIST(ts);
  const offset = mod - SESSION_OPEN_MIN;
  if (offset <= 0) return 0;
  return Math.floor(offset / intervalMin);
}

/**
 * Fold a non-empty run of 1m bars (ascending by ts) into one OHLCV bar. The
 * bar's ts is the LEFT edge = the first present member's ts. Pass the head bar
 * separately so the open/first values are statically known to exist (the repo
 * runs `noUncheckedIndexedAccess`).
 */
function foldBucket(head: Bar, rest: Bar[]): Bar {
  let high = head.h;
  let low = head.l;
  let volume = head.v;
  let close = head.c;
  let oiLast: number | undefined = head.oi;
  for (const b of rest) {
    if (b.h > high) high = b.h;
    if (b.l < low) low = b.l;
    volume += b.v;
    close = b.c; // ascending → last assignment is the bucket close
    if (b.oi !== undefined) oiLast = b.oi;
  }
  const out: Bar = { ts: head.ts, o: head.o, h: high, l: low, c: close, v: volume };
  if (oiLast !== undefined) out.oi = oiLast; // open interest = last print in bucket
  return out;
}

/**
 * Resample a 1-minute series to `interval` (any minute token, Nh, 1d, or 1w).
 *
 * `interval` may be a raw token string ("7m", "1h", "1d", "1w") or an already
 * parsed `ParsedInterval`. An invalid token throws — the caller (builder) must
 * gate on `parseInterval(token).valid` first; this is a programming error, not
 * a user-facing path.
 *
 * Returns a new ascending `Series`. Passing a 1m interval returns a shallow
 * copy sorted by ts (identity transform). The input is never mutated.
 *
 * Partial trailing bucket: a non-divisor interval (e.g. 7m over a 375-min
 * session) leaves a final bucket of fewer than `interval` minutes on each day.
 * That bucket is still EMITTED — it is a real, if short, candle (OHLC over the
 * minutes that exist). The same holds for any intraday gap: a bucket is built
 * from whatever member minutes are present and never fabricates missing minutes.
 */
export function resample(bars: Series, interval: string | ParsedInterval): Series {
  const parsed = typeof interval === "string" ? parseInterval(interval) : interval;
  if (!parsed.valid) {
    throw new Error(
      `resample: invalid interval ${JSON.stringify(interval)} — ${parsed.reason ?? "unparseable"}`
    );
  }
  if (bars.length === 0) return [];

  // One canonical sort up front; every grouping path relies on ascending ts.
  const sorted = [...bars].sort((a, b) => a.ts - b.ts);

  // 1m minute interval → identity (sorted copy).
  if (parsed.unit === "minute" && parsed.minutes === 1) return sorted;

  if (parsed.unit === "week") return groupBy(sorted, isoWeekKeyIST);
  if (parsed.unit === "day" || parsed.minutes === SESSION_MINUTES) {
    // Whole-session bucket: group by trading day. (1d, and any minute interval
    // exactly equal to the session length, collapse to one bar per day.)
    return groupBy(sorted, tradingDayIST);
  }

  // Sub-session minute interval: group by (trading day, session-aligned bucket).
  const intervalMin = parsed.minutes!;
  return groupBy(sorted, (ts) => {
    const dayKey = istDayStartMs(ts); // numeric day anchor — no string churn
    const bk = minuteBucketIndex(ts, intervalMin);
    return `${dayKey}:${bk}`;
  });
}

/**
 * Group a pre-sorted (ascending) series by a key derived from each bar's ts,
 * folding each group into one OHLCV bar. The bar's ts is the LEFT edge (first
 * member's ts). Groups are emitted in first-seen order, which — because the
 * input is ascending and every key function is monotonic in ts within the
 * relevant span — yields an ascending output.
 */
function groupBy(sorted: Series, keyOf: (ts: number) => string): Series {
  const groups = new Map<string, Bar[]>();
  const order: string[] = [];
  for (const b of sorted) {
    const k = keyOf(b.ts);
    let g = groups.get(k);
    if (g === undefined) {
      g = [];
      groups.set(k, g);
      order.push(k);
    }
    g.push(b);
  }
  const out: Series = [];
  for (const k of order) {
    const members = groups.get(k);
    const head = members?.[0];
    if (members === undefined || head === undefined) continue; // unreachable
    out.push(foldBucket(head, members.slice(1)));
  }
  return out;
}

/**
 * Streaming notes (for the future worker/duckdb-wasm incremental path).
 * ─────────────────────────────────────────────────────────────────────────
 * The batch `resample` above materializes the whole series, which is the right
 * call for the day-segmented engine (it already holds one full day in memory,
 * §1.3). For a live/streaming feed the same semantics hold incrementally:
 *
 *  1. Maintain an OPEN bucket keyed by (tradingDay, bucketIndex) for the active
 *     minute. On each incoming 1m bar, compute its key with `minuteBucketIndex`.
 *  2. If the key matches the open bucket → fold the bar in (max/min/sum, update
 *     close). If it is a NEW key → EMIT the open bucket as complete, then start
 *     a fresh open bucket. This guarantees no look-ahead: a bucket is only
 *     emitted once a bar from the NEXT bucket (or end-of-day) arrives.
 *  3. End-of-day (or end-of-stream) flushes the open bucket, which is how the
 *     ragged trailing candle of a non-divisor interval gets emitted.
 *
 * A `StreamingResampler` wrapping (1)–(3) would expose `push(bar): Bar | null`
 * (returns a completed bucket when one closes) and `flush(): Bar | null`. It is
 * intentionally NOT built here — the engine consumes whole days — but the batch
 * path and any future streaming path MUST produce byte-identical buckets, which
 * the golden tests pin.
 */
