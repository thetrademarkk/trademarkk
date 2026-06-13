# Data Layer — HuggingFace + DuckDB

> **Scope.** The complete data substrate beneath both the no-code strategy builder and the bring-your-own-code (BYOC) editor. This document is the contract that the backtest engine, the builder wizard, the BYOC API, and the results UI all build on. It covers (1) the HuggingFace dataset contract, (2) the parquet schema + partitioning, (3) DuckDB integration server-side (`httpfs`/`hf://`) and in-browser (`duckdb-wasm`), (4) efficient query patterns with predicate/projection pushdown, (5) browser caching (OPFS/IndexedDB) plus a hard byte budget, (6) ATM computation from spot, and (7) the patchy-coverage problem and its concrete mitigations — nearest-available-strike resolution, gap detection, and a coverage/confidence score the UI consumes.
>
> Three existing TypeScript modules in particular consume this layer and must be handed shapes they already understand:
>
> - `src/lib/options/payoff.ts` — `PayoffLeg` (qty already lot-scaled), `intrinsicValue`, `classifyStrategy`, the live right-rail payoff + breakevens.
> - `src/lib/montecarlo/simulate.ts` — the R-multiple equity cone / percentile fan, reused for the Monte-Carlo drawdown headliner.
> - `src/lib/charges/charges.ts` — per-broker STT / GST / stamp / brokerage for net-of-cost P&L.
>
> This spec is meant to be built from **verbatim** by an implementation workflow.

---

## 0. Design theses (opinionated — read these first)

1. **The browser is the database.** The default execution path is 100% client-side: `duckdb-wasm` range-reads parquet from HuggingFace over HTTPS; Pyodide (BYOC) and a TypeScript engine (no-code) consume the resulting Arrow tables. The Next.js server touches options data **only** for the optional paid server-run tier and for one cheap, server-cached endpoint: the **coverage manifest** (§7). Anonymous runs cost **$0** and are never gated. This mirrors the existing local-DB philosophy in `src/lib/db/adapters/local.ts` (sql.js in IndexedDB) — we already ship a WASM database to the browser; this is the same move with DuckDB + remote parquet.

2. **Missing data is a named, first-class value — never a silent empty.** Every strike resolution returns `{ requested, served, coveragePct, distancePts }`. Borrowing Pine Script's `na`/`fixnan` honesty: the API tells you what it actually gave you. A query that finds nothing returns a **typed empty result with a reason**, not a bare `[]`.

3. **One canonical data API, six functions, identical semantics in TS and Python.** `loadIndex`, `loadOption`, `resolveStrike`, `atmStrike`, `optionChainAt`, `coverageFor`. The BYOC Pyodide stub and the no-code TS engine call the same logical operations against the same SQL, so a strategy behaves **identically** whether built in the wizard or written in Python.

4. **Push work into DuckDB SQL, never into pandas/JS loops.** Pyodide has no PyArrow and `arrow → list[dict] → DataFrame` copies are slow; the WASM↔JS boundary is also a copy. So: filter, aggregate, resample, and join **inside** DuckDB and cross the boundary once with the narrowest possible result.

5. **Pull the narrowest slice that can possibly answer the question.** Predicate pushdown on `trading_day`/`timestamp` plus projection of only the needed columns is the difference between a 200 KB range-read and a 40 MB download. The query builder is responsible for **always** emitting both.

---

## 1. The HuggingFace dataset contract

**Dataset:** `thetrademarkk/india-index-options-1m` (public). Two logical tables, partitioned by file path.

```
hf://datasets/thetrademarkk/india-index-options-1m/
├── index/
│   ├── NIFTY.parquet        # spot 1m OHLC, 2021–2026, COMPLETE
│   ├── BANKNIFTY.parquet    # spot 1m OHLC, 2021–2026, COMPLETE
│   └── SENSEX.parquet       # spot 1m OHLC, 2022–2026, COMPLETE
└── options/
    ├── NIFTY/
    │   ├── 2026-06-12.parquet   # one file per EXPIRY date
    │   ├── 2026-06-19.parquet
    │   └── …
    ├── BANKNIFTY/
    │   └── {EXPIRY}.parquet
    └── SENSEX/
        └── {EXPIRY}.parquet     # worst coverage
```

### Why partition by expiry, not by trading_day

A backtest of a weekly-expiry strategy over a date range touches _all trading days that traded a given expiry_ — which is exactly one file. ATM-anchored intraday strategies (the 90% case) read **one expiry file** and filter rows by `trading_day` + `strike` range inside it. Partitioning by `trading_day` would force a multi-file scan per backtest day. Expiry-partitioning keeps the common case to a **single-file range read**.

### Resolved URL forms (both must work)

- **DuckDB native** (`httpfs` / `hf://`, used server-side):
  `hf://datasets/thetrademarkk/india-index-options-1m/options/NIFTY/2026-06-19.parquet`
- **Plain HTTPS** (`duckdb-wasm` reads this directly, and it is CDN-cacheable, used in the browser):
  `https://huggingface.co/datasets/thetrademarkk/india-index-options-1m/resolve/main/options/NIFTY/2026-06-19.parquet`

We use the **HTTPS `resolve/main` form in the browser** (`duckdb-wasm`'s `httpfs` honors HTTP range requests against it and it sits behind HF's CDN), and the **`hf://` form server-side** (cleaner, supports an auth header if the dataset ever goes gated).

### Schemas (frozen contract)

```
index/{SYMBOL}.parquet
  timestamp      TIMESTAMP   -- IST, 1-minute bars, 09:15–15:30
  open           DOUBLE
  high           DOUBLE
  low            DOUBLE
  close          DOUBLE
  volume         BIGINT      -- may be 0 for spot index
  trading_day    DATE        -- == date(timestamp), explicit for cheap pushdown
  symbol         VARCHAR     -- 'NIFTY' | 'BANKNIFTY' | 'SENSEX'

options/{SYMBOL}/{EXPIRY}.parquet
  timestamp      TIMESTAMP   -- IST 1-minute
  open           DOUBLE
  high           DOUBLE
  low            DOUBLE
  close          DOUBLE
  volume         BIGINT
  open_interest  BIGINT
  trading_day    DATE
  symbol         VARCHAR
  strike         INTEGER     -- e.g. 24500
  option_type    VARCHAR     -- 'CE' | 'PE'
  expiry         DATE        -- == file's expiry, redundant but enables UNION-by-glob
```

### Required parquet write conventions

We own the ETL, so we **mandate** these — they make every query below fast:

- **Row-group sorting:** `index` sorted by `timestamp`; `options` sorted by `(trading_day, strike, option_type, timestamp)`. This co-locates a strike's rows for a day in one or two row groups, so a strike+day predicate skips ~99% of row groups.
- **Row-group size:** ~100k rows — small enough that a single strike-day range read pulls one or two groups, large enough to keep footer overhead low.
- **Column statistics enabled** (min/max per row group) on `trading_day`, `strike`, `timestamp`. This is what powers predicate pushdown / row-group pruning. **Non-negotiable.**
- **Compression:** ZSTD (better ratio than snappy for these columns; DuckDB reads both).
- **No dictionary bloat:** keep `option_type` / `symbol` dictionary-encoded.

---

## 2. The canonical data API (TS + Python parity)

Six functions. This is the **only** surface builders / BYOC users touch. Implemented once as SQL templates (§4), then bound to a TS class (`OptionsDataClient`) and a Python module (`tmk_data`, shipped as a Pyodide stub + thin wrapper).

```ts
// src/lib/backtest/data/client.ts  (TS engine + no-code wizard)
type Sym = "NIFTY" | "BANKNIFTY" | "SENSEX";
type Interval = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "1d";

interface IndexBar {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
interface OptionBar extends IndexBar {
  strike: number;
  optionType: "CE" | "PE";
  oi: number;
}

interface StrikeResolution {
  requested: number; // what the strategy asked for (e.g. ATM+2 → 24600)
  served: number | null; // nearest strike that actually has data, or null
  distancePts: number; // |served - requested|; 0 = exact
  coveragePct: number; // 0–1, share of expected 1m bars present for served strike over the window
  illiquid: boolean; // coverage < 0.6 OR median 1m volume below threshold
  reason: "exact" | "nearest" | "none";
}

interface CoverageReport {
  // §7 — the per-(symbol,expiry) manifest, narrowed to a window
  symbol: Sym;
  expiry: string;
  datasetVersion: number;
  tradingDays: string[];
  expectedBarsPerDay: number; // 375 for 09:15–15:30 inclusive at 1m
  strikeStep: number;
  overallCoverage: number; // 0–1 over the used ±N band
  strikes: Record<string, { CE: StrikeCov | null; PE: StrikeCov | null }>;
}
interface StrikeCov {
  coverage: number;
  medVol: number;
  days: number;
}

interface DataClient {
  loadIndex(sym: Sym, from: string, to: string, interval?: Interval): Promise<IndexBar[]>;
  loadOption(
    sym: Sym,
    expiry: string,
    strike: number,
    ot: "CE" | "PE",
    from: string,
    to: string,
    interval?: Interval
  ): Promise<OptionBar[]>;
  resolveStrike(
    sym: Sym,
    expiry: string,
    target: number,
    ot: "CE" | "PE",
    from: string,
    to: string
  ): Promise<StrikeResolution>;
  atmStrike(sym: Sym, expiry: string, at: string /* timestamp */): Promise<number>;
  optionChainAt(sym: Sym, expiry: string, at: string): Promise<OptionBar[]>; // one snapshot row per strike/type
  coverageFor(sym: Sym, expiry: string, from: string, to: string): Promise<CoverageReport>; // §7
}
```

Python parity (`tmk_data`), one-to-one, returning DuckDB relations the user can `.df()` or iterate:

```python
import tmk_data as tmk            # injected into Pyodide global scope
spot = tmk.load_index("NIFTY", "2026-01-01", "2026-03-31")           # DuckDB relation
res  = tmk.resolve_strike("NIFTY", "2026-01-29", 21500, "CE",
                          "2026-01-01", "2026-01-29")                # StrikeResolution dataclass
ce   = tmk.load_option("NIFTY", "2026-01-29", res.served, "CE",
                       "2026-01-01", "2026-01-29")
atm  = tmk.atm_strike("NIFTY", "2026-01-29", "2026-01-15 09:20:00")
```

The data-catalog **"insert snippet"** feature (BYOC right-rail) generates exactly these calls with the chosen symbol / expiry / strike pre-filled, so a BYOC user never has to guess a path or symbol string — the single biggest BYOC failure mode ("what do I even type").

---

## 3. DuckDB integration

### 3a. In-browser (`duckdb-wasm`) — the default path

**Bundle & init.** Lazy-load `@duckdb/duckdb-wasm` (chunked; ships its own worker). **Never** block the builder UI on DuckDB or Pyodide init — instantiate on the first data call and show intentional progress ("preparing data engine…"). Use the `mvp` bundle unless we measure a need for the `eh` (exception-handling) build.

```ts
// src/lib/backtest/data/duck-browser.ts
import * as duckdb from "@duckdb/duckdb-wasm";

let _db: duckdb.AsyncDuckDB | null = null;

export async function getDuck(): Promise<duckdb.AsyncDuckDB> {
  if (_db) return _db;
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const worker = new Worker(bundle.mainWorker!);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

  const conn = await db.connect();
  await conn.query(`INSTALL httpfs; LOAD httpfs;`);
  await conn.query(`SET enable_http_metadata_cache=true;`); // cache parquet footers across queries
  await conn.query(`SET http_keep_alive=true;`); // reuse the HTTPS connection for range reads
  await conn.query(`SET memory_limit='512MB';`); // soft working-set cap (§6)
  await conn.close();

  _db = db;
  return db;
}
```

**Key constraints we design around (verified WASM realities):**

- `duckdb-wasm` bundles `parquet` / `json` / `icu`; **`httpfs` supports HTTP range reads**, so it pulls only the row groups a predicate needs — no full-file download.
- **No PyArrow in Pyodide** and DataFrames are not natively registered into DuckDB. We therefore keep DuckDB as the single query engine and hand Pyodide the result as **Arrow IPC bytes → a lightweight pandas constructor**, _not_ via PyArrow (see §4d).
- **The WASM blob hurts first paint** → lazy-load, cache the WASM via the service worker, and keep the builder fully interactive (the persistent live payoff in the right rail is pure `payoff.ts` math and needs zero remote data).

### 3b. Server-side (`httpfs` / `hf://`) — paid tier + manifest only

Used in exactly two places:

1. The **coverage manifest** generator (a scheduled / cached job, §7) — runs DuckDB in a Node context to precompute per-expiry coverage so the browser never re-derives it.
2. The **optional paid server-run tier** (Vercel Sandbox microVM, deny-all egress except HF) for heavy / long BYOC runs.

```ts
// src/lib/backtest/data/duck-server.ts  (server-only; @duckdb/node-api)
const HF = "hf://datasets/thetrademarkk/india-index-options-1m";

await db.run(`INSTALL httpfs; LOAD httpfs;`);
// Optional, only if the dataset ever gates:
// await db.run(`CREATE SECRET hf (TYPE huggingface, TOKEN '${env.HF_TOKEN}');`);
```

Server runs honor the existing `src/server/rate-limit.ts` (Upstash → platform-DB fixed window → in-memory) keyed by user / IP, and the existing SSRF allowlist (only `huggingface.co` egress). Inline budget ≤ 300s with Next.js `after()`; if a run could exceed 300s, enqueue via **Upstash QStash**; on completion write a `notifications` row (the table already exists — `src/server/db/platform-schema.ts:216`) + a Resend email — reusing the exact pattern the community feature uses.

---

## 4. Efficient query patterns (with example SQL)

Two universal rules **enforced by the query builder**: **(a)** always project only the needed columns; **(b)** always push `trading_day` (and `timestamp` when intraday-bounded) and `strike` / `option_type` predicates into the scan.

### 4a. Load an index slice

```sql
-- loadIndex('NIFTY', '2026-01-01', '2026-03-31')
SELECT timestamp, open, high, low, close, volume
FROM read_parquet('https://huggingface.co/datasets/thetrademarkk/india-index-options-1m/resolve/main/index/NIFTY.parquet')
WHERE trading_day BETWEEN DATE '2026-01-01' AND DATE '2026-03-31'
ORDER BY timestamp;
```

Row-group stats on `trading_day` prune everything outside Q1. Only the OHLCV columns are read.

**Resample to a coarser interval IN SQL** (never in JS / pandas):

```sql
-- 5-minute candles from 1m, via IST bucketing
SELECT
  time_bucket(INTERVAL '5 minutes', timestamp) AS ts,
  first(open  ORDER BY timestamp) AS open,
  max(high)                       AS high,
  min(low)                        AS low,
  last(close  ORDER BY timestamp) AS close,
  sum(volume)                     AS volume
FROM read_parquet($url)
WHERE trading_day BETWEEN $from AND $to
GROUP BY 1
ORDER BY 1;
```

### 4b. Load one option leg for an expiry / date / strike (predicate pushdown)

```sql
-- loadOption('NIFTY','2026-01-29', strike=21500, 'CE', '2026-01-15','2026-01-29')
SELECT timestamp, open, high, low, close, volume, open_interest
FROM read_parquet('…/options/NIFTY/2026-01-29.parquet')
WHERE trading_day BETWEEN DATE '2026-01-15' AND DATE '2026-01-29'
  AND strike = 21500
  AND option_type = 'CE'
ORDER BY timestamp;
```

Because the file is row-group-sorted by `(trading_day, strike, option_type, timestamp)` with stats, DuckDB reads only the row groups whose min/max bracket strike 21500 — a few hundred KB even though the file holds the whole chain for that expiry.

### 4c. Strike-range scan (for resolve / chain / ATM and "by premium" / "by delta" selection)

```sql
-- All CE strikes within ±300 pts of an estimated ATM, one expiry, one day window
SELECT strike, option_type, timestamp, close, volume, open_interest
FROM read_parquet('…/options/NIFTY/2026-01-29.parquet')
WHERE trading_day BETWEEN $from AND $to
  AND option_type = $ot
  AND strike BETWEEN $atm - 300 AND $atm + 300
ORDER BY strike, timestamp;
```

### 4d. Crossing into Pyodide without PyArrow

Run the query in DuckDB-wasm, export **Arrow IPC**, hand the bytes to Python, and build a pandas DataFrame via a `read_feather`-equivalent over a `BytesIO` (or, if even that is heavy, fall back to the columnar-dict path). **Aggregate first** so the payload is small.

```ts
// TS side: result is Arrow; transfer the IPC buffer (zero-copy transferable)
const reader = await conn.query(sql); // arrow.Table
const ipc = arrow.tableToIPC(reader, "stream"); // Uint8Array
postToPyodide(ipc.buffer); // transferable
```

```python
# Python side (tmk_data): bytes -> DataFrame, no pyarrow
import io, pandas as pd
df = pd.read_feather(io.BytesIO(ipc_bytes))        # Arrow IPC stream
```

**Rule:** the largest object ever crossing the boundary is a per-minute OHLC slice for the **resolved** legs only — typically a few thousand rows. All chain-wide scans (ATM search, premium / delta matching, coverage) resolve to a single strike **in SQL**, and only that strike's series crosses.

---

## 5. ATM computation from spot

ATM is computed from the **index spot close at the entry timestamp**, snapped to the instrument's strike step. Strike steps and lot sizes (frozen):

| Symbol    | Strike step | Lot size (`payoff.ts` convention — qty already lot-scaled) |
| --------- | ----------- | ---------------------------------------------------------- |
| NIFTY     | 50          | 75                                                         |
| BANKNIFTY | 100         | 35                                                         |
| SENSEX    | 100         | 20                                                         |

```ts
// src/lib/backtest/data/resolve.ts
const STRIKE_STEP: Record<Sym, number> = { NIFTY: 50, BANKNIFTY: 100, SENSEX: 100 };
const LOT_SIZE: Record<Sym, number> = { NIFTY: 75, BANKNIFTY: 35, SENSEX: 20 };

function snapToStrike(spot: number, step: number): number {
  return Math.round(spot / step) * step;
}
```

**ATM in SQL** (single round-trip; reads one spot bar):

```sql
-- atmStrike('NIFTY', …, '2026-01-15 09:20:00') ; step = 50
SELECT CAST(round(close / 50) * 50 AS INTEGER) AS atm_strike
FROM read_parquet('…/index/NIFTY.parquet')
WHERE timestamp = TIMESTAMP '2026-01-15 09:20:00';
```

If the exact minute is missing (holiday minute / halt), fall back to the **last available bar at or before** the timestamp:

```sql
SELECT CAST(round(close / 50) * 50 AS INTEGER) AS atm_strike
FROM read_parquet('…/index/NIFTY.parquet')
WHERE timestamp <= TIMESTAMP '2026-01-15 09:20:00'
ORDER BY timestamp DESC LIMIT 1;
```

**Strike-selection methods** (AlgoTest-parity; all resolve to a target integer strike, then go through `resolveStrike`):

- **ATM ± N steps:** `atm + offset * step`.
- **% offset:** `snapToStrike(atm * (1 ± pct), step)`.
- **By premium** (closest to ₹X): scan the chain at the entry minute, pick `argmin(|close − X|)` over the strike-range query in §4c.
- **By delta** (closest to D): we have no IV feed, so delta is **approximated** from the option's own price curve — opinionated stance: compute a finite-difference delta (Δprice / Δspot) over the strike-range snapshot, or fall back to a Black-76 delta from a realized-vol estimate on the index slice. **Surface "approx delta" honestly in the UI** — never present it as exchange Greeks. (A deliberate honesty call; AlgoTest has a vendor IV feed we don't.)
- **Exact:** user-typed strike → straight to `resolveStrike`.

Every method's output strike is **never used directly** — it is passed through `resolveStrike` (§7) so the missing-strike machinery always runs.

---

## 6. Browser caching + byte budget

Two-layer cache, both keyed by `(symbol, expiry|index, columns, granularity)` — never by raw byte ranges (those are `duckdb-wasm`'s internal concern):

**Layer 1 — `duckdb-wasm` HTTP metadata cache + the HF CDN.** `enable_http_metadata_cache=true` caches parquet footers so repeated queries against the same file skip re-reading schema / stats; the HF CDN caches the byte ranges themselves across the session and across users.

**Layer 2 — our own resolved-slice cache in OPFS (preferred) with IndexedDB fallback.** We cache the **narrow, resolved** result of expensive operations — coverage reports, resolved option series for a leg, ATM lookups — as Arrow IPC blobs. OPFS is preferred because it stores large binary blobs efficiently and is reachable from a worker; IndexedDB is the fallback (and is what the app already uses for the local sql.js DB, `src/lib/db/adapters/local.ts`).

```
OPFS layout:
/tmk-bt-cache/
  manifest.json                         # index of cached slices + total bytes + LRU timestamps
  cov/NIFTY/2026-01-29.arrow            # coverage report (tiny, pinned)
  opt/NIFTY/2026-01-29/21500-CE/1m.arrow
  idx/NIFTY/2026-01-01_2026-03-31/1m.arrow
```

**Byte budget (hard caps, enforced by an LRU evictor in the cache manager):**

| Tier                                                                      | Cap                                      | Eviction                                                                                                  |
| ------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Per resolved slice                                                        | 8 MB                                     | reject + stream directly if a single slice exceeds (shouldn't happen for a resolved single-strike series) |
| Total OPFS backtest cache                                                 | **250 MB**                               | LRU by `manifest.json` last-access; evict oldest until under cap before each write                        |
| In-memory (DuckDB) working set                                            | 512 MB soft (`SET memory_limit='512MB'`) | DuckDB spills/streams; we keep result sets small by aggregating in SQL                                    |
| First-load network (cold backtest: one expiry, one strike, one month, 1m) | target **< 2 MB** transferred            | predicate + projection pushdown; verified per query in dev                                                |

**Eviction algorithm:** before any cache write, sum slice sizes from `manifest.json`; if `total + incoming > 250 MB`, delete least-recently-accessed slices until it fits. **Coverage reports are pinned** (never evicted — tiny and frequently re-read). On quota errors (OPFS full / IndexedDB blocked in private mode), degrade gracefully to **no cache** (every query goes to the network) and show a one-time, non-blocking toast.

**Cache invalidation:** the dataset is append-mostly and we control the ETL; bump a global `DATASET_VERSION` constant when a parquet file is rewritten (e.g. a backfill of missing strikes). The version is part of every cache key, so a backfill silently invalidates stale slices.

---

## 7. The patchy-coverage problem — the differentiator

Coverage is **40–68% of strikes missing** (worst: SENSEX), and some captured strikes are sparse / illiquid. None of the competitors handle this honestly. This is where we win. Three mechanisms: **coverage scoring**, **nearest-available-strike resolution**, and **gap detection** — all surfaced to the UI.

### 7a. The coverage manifest (precomputed, server-cached)

A scheduled job (server-side DuckDB over `hf://`) precomputes, per `(symbol, expiry)`, a compact JSON manifest so the browser never re-derives coverage from scratch. Cached in the platform DB / Vercel cache (`src/server/cache.ts`), served by a cheap `GET` endpoint, then mirrored to the OPFS layer-2 store per session.

```jsonc
// coverage manifest for NIFTY/2026-01-29.parquet
{
  "symbol": "NIFTY",
  "expiry": "2026-01-29",
  "datasetVersion": 7,
  "tradingDays": ["2026-01-15", "...", "2026-01-29"],
  "expectedBarsPerDay": 375, // 09:15–15:30 inclusive at 1m
  "strikes": {
    "21500": {
      "CE": { "coverage": 0.98, "medVol": 4200, "days": 11 },
      "PE": { "coverage": 0.95, "medVol": 3900, "days": 11 },
    },
    "21450": { "CE": { "coverage": 0.61, "medVol": 120, "days": 9 } }, // illiquid
    "21400": { "CE": null }, // strike entirely absent
  },
  "strikeStep": 50,
  "overallCoverage": 0.57, // share of expected strike×type×bars present in ±N band
}
```

The SQL that derives it (per expiry file), pushing **all** aggregation into DuckDB:

```sql
WITH expected AS (
  SELECT count(DISTINCT trading_day) * 375 AS bars_per_strike
  FROM read_parquet('…/options/NIFTY/2026-01-29.parquet')
)
SELECT
  strike,
  option_type,
  count(*)                                                AS present_bars,
  count(*) * 1.0 / (SELECT bars_per_strike FROM expected) AS coverage,
  median(volume)                                          AS med_vol,
  count(DISTINCT trading_day)                             AS days
FROM read_parquet('…/options/NIFTY/2026-01-29.parquet')
GROUP BY strike, option_type
ORDER BY strike, option_type;
```

### 7b. `resolveStrike` — nearest-available-strike resolution

Every requested strike (from any selection method in §5) is resolved against the manifest. Algorithm:

1. Look up `requested` in the manifest for the window.
2. If present **and** `coverage ≥ 0.6` **and** `medVol ≥ liquidityFloor[sym]` → `{ served: requested, distancePts: 0, reason: "exact" }`.
3. Else search outward by strike step (±1, ±2, …) up to a **maxDistance** (default: 5 steps for NIFTY = 250 pts; 3 steps for BANKNIFTY / SENSEX = 300 pts). Pick the nearest strike clearing the coverage + liquidity bars; ties → the **closer to ATM** wins (cheaper to fill in reality).
4. If none clears within `maxDistance` → `{ served: null, reason: "none" }`, and the leg is flagged in the UI as **unfillable** (the strategy can still run on the legs that resolved, with a prominent banner).

```ts
// src/lib/backtest/data/resolve.ts
function resolveStrike(
  target: number,
  side: "CE" | "PE",
  cov: CoverageReport,
  sym: Sym
): StrikeResolution {
  const step = STRIKE_STEP[sym];
  const floor = LIQUIDITY_FLOOR[sym]; // median 1m volume threshold
  const maxSteps = sym === "NIFTY" ? 5 : 3;
  const ok = (s: number) => {
    const e = cov.strikes[String(s)]?.[side];
    return !!e && e.coverage >= 0.6 && e.medVol >= floor;
  };
  if (ok(target)) {
    const e = cov.strikes[String(target)]![side]!;
    return {
      requested: target,
      served: target,
      distancePts: 0,
      coveragePct: e.coverage,
      illiquid: false,
      reason: "exact",
    };
  }
  for (let d = 1; d <= maxSteps; d++) {
    for (const cand of [target + d * step, target - d * step]) {
      // outward; ATM-side tie via order
      if (ok(cand)) {
        const e = cov.strikes[String(cand)]![side]!;
        return {
          requested: target,
          served: cand,
          distancePts: Math.abs(cand - target),
          coveragePct: e.coverage,
          illiquid: e.coverage < 0.8,
          reason: "nearest",
        };
      }
    }
  }
  return {
    requested: target,
    served: null,
    distancePts: Infinity,
    coveragePct: 0,
    illiquid: true,
    reason: "none",
  };
}
```

### 7c. Gap detection (intra-series holes)

Even a "covered" strike can have intraday gaps (halts, illiquid minutes). On every loaded option series we detect gaps in SQL and decide a fill policy:

```sql
-- Flag minutes with no bar inside the trading window for a resolved leg
WITH grid AS (
  SELECT ts FROM range(TIMESTAMP '2026-01-15 09:15:00',
                       TIMESTAMP '2026-01-15 15:30:00',
                       INTERVAL '1 minute') t(ts)
),
bars AS (
  SELECT timestamp, close FROM read_parquet('…/options/NIFTY/2026-01-29.parquet')
  WHERE trading_day = DATE '2026-01-15' AND strike = 21500 AND option_type = 'CE'
)
SELECT g.ts, b.close,
       (b.close IS NULL) AS is_gap
FROM grid g LEFT JOIN bars b ON g.ts = b.timestamp
ORDER BY g.ts;
```

**Fill policy (opinionated, Pine `fixnan`-style and honest):**

- **Short gaps (≤ N = 3 consecutive minutes):** forward-fill the last close (LOCF). Mark filled bars so the equity curve can render them faintly.
- **Long gaps (> 3 min):** **do not fabricate trades.** If an entry / exit instant lands in a long gap, snap to the **last real bar ≤ the target time** and record a `gapFilled` flag on that trade — never invent a price.
- **Whole-day missing for a resolved leg:** that trading day is **excluded** from the backtest for that leg and counted against coverage; the day is listed in an "excluded days" drill-down.

### 7d. The coverage / confidence score surfaced to the UI

A single 0–100 **Confidence** score per backtest, plus a coverage band, computed from: overall strike coverage in the used band, the worst served-leg coverage, the total filled-bar fraction, and the excluded-day count. This drives the honesty chips at the top of the results screen (the QuantConnect red/green-test pattern adapted for our data reality).

```ts
confidence = round(
  100 *
    (0.45 * avgServedLegCoverage + // how complete the legs we actually traded were
      0.25 * (1 - filledBarFraction) + // penalize forward-filled minutes
      0.2 * (1 - excludedDayFraction) + // penalize dropped days
      0.1 * exactStrikeFraction) // reward hitting requested strikes, not substitutes
);
band = confidence >= 80 ? "High" : confidence >= 55 ? "Medium" : "Low";
```

---

## 8. UI surfaces (ASCII wireframes)

### 8a. Builder Step-1 "Market" — coverage badge for the chosen index + range

```
┌──────────────────────────────────────────────────────────────────┐
│  Step 1 of 4 — Market                                    [1│2│3│4] │
├──────────────────────────────────────────────────────────────────┤
│  Index     [ NIFTY ▾ ]   Candle  [ 1m ▾ ]                          │
│  Range     [ 01 Jan 2026 ]  →  [ 31 Mar 2026 ]   ( 58 trading days)│
│                                                                    │
│  ┌── Data coverage for this selection ───────────────────────────┐│
│  │  ● High confidence · 84% strike coverage in ±300pt band        ││
│  │  ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇░░░░  NIFTY weeklies well-covered         ││
│  │  ⚠ 3 expiries below 60% — flagged when you pick a strike there  ││
│  │                                          [ see coverage map → ] ││
│  └────────────────────────────────────────────────────────────────┘│
│                                              [ Back ]   [ Next → ] │
└──────────────────────────────────────────────────────────────────┘
```

### 8b. Builder Step-2 "Legs" — nearest-strike chip on a leg

```
┌── Leg 1 ───────────────────────────────────────────────────────────┐
│  ◉ Sell   ○ Buy      CE / [PE]      Lots [ 1 ]  (= 75 qty)          │
│  Strike   [ ATM±  ‹ % offset › Premium  Delta  Exact ]   ATM  [-2▾] │
│           → requested 21400 PE                                      │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ ⚠ 21400 PE not in dataset — using 21450 PE (50pt away · 71%)   │ │
│  │   [ keep nearest ]   [ pick another ]   [ why? ]               │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 8c. Coverage map modal (strike-availability heatmap — the BYOC catalog reuses this)

```
┌── NIFTY · 29 Jan 2026 expiry · 01–29 Jan ─────────────────────────────┐
│        CE                                  PE                          │
│ 21600 ▓▓▓▓▓▓▓▓▓░  92%      21600 ▓▓▓▓▓▓▓▓░░  78%                       │
│ 21550 ▓▓▓▓▓▓▓▓▓▓  98%      21550 ▓▓▓▓▓▓▓▓▓░  90%                       │
│ 21500 ▓▓▓▓▓▓▓▓▓▓  98% ATM  21500 ▓▓▓▓▓▓▓▓▓▓  95%  ← ATM               │
│ 21450 ▓▓▓▓▓▓░░░░  61%      21450 ▓▓▓▓▓▓▓░░░  71%                       │
│ 21400 ░░░░░░░░░░   —       21400 ▓▓▓▓░░░░░░  41% illiquid              │
│  legend: ▓ present · ░ missing/illiquid · — strike absent             │
│  [ click any cell → insert query snippet ]            [ close ]       │
└───────────────────────────────────────────────────────────────────────┘
```

### 8d. Results header — confidence / honesty chips (consumes §7d)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Short Straddle · NIFTY · 01 Jan–31 Mar 2026                           │
│  [ ● Confidence 78 · Medium ] [ 84% coverage ] [ 56 trade-days ]       │
│  [ 2 days excluded (no data) ] [ 1 leg used nearest strike ]           │
│  ────────────────────────────────────────────────────────────────────│
│   ₹ +42,310   ·   Return/MaxDD 3.1   ·   Win% 61   ·   Sharpe 1.4      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 9. Module layout (where this lives)

```
src/lib/backtest/data/
  schema.ts            # Sym, Interval, IndexBar, OptionBar, StrikeResolution, CoverageReport types
  urls.ts              # HF path builders (hf:// for server, resolve/main for browser) + DATASET_VERSION
  sql.ts               # parameterized SQL templates (index slice, option leg, chain scan, atm, coverage, gaps)
  duck-browser.ts      # getDuck(), query→Arrow helpers, lazy init
  duck-server.ts       # server-only httpfs/hf:// client (manifest job + paid tier)
  client.ts            # OptionsDataClient implementing the 6-fn API (browser)
  resolve.ts           # resolveStrike, atm/snapToStrike, liquidity floors, STRIKE_STEP/LOT_SIZE
  coverage.ts          # manifest fetch/derive, confidence score, gap detection + fill policy
  cache/
    opfs.ts            # OPFS arrow-blob store + LRU evictor + 250MB budget
    idb.ts             # IndexedDB fallback (mirrors local.ts pattern)
pyodide/tmk_data/      # Python parity module + Monaco type stub for the BYOC editor
src/server/backtest/
  coverage-manifest.ts # scheduled/cached manifest generator (Node DuckDB)
  run-server.ts        # paid-tier orchestration: rate-limit → ssrf allowlist → after()/QStash → notifications + Resend
```

**Reuse, not reinvent:** resolved legs feed `src/lib/options/payoff.ts` (`PayoffLeg`, qty already lot-scaled) for the live right-rail payoff and breakevens; per-trade R-multiples from the run feed `src/lib/montecarlo/simulate.ts` for the MC-drawdown headliner; realized fills feed `src/lib/charges/charges.ts` for net-of-cost P&L. The data layer's only job is to deliver **honest, narrow, typed slices** to those existing engines.

---

## 10. Acceptance criteria (what "done" means for this layer)

1. A cold backtest (one index, one expiry, one resolved leg, one month, 1m) transfers **< 2 MB** and renders first results in a single round trip — verified in the dev network panel.
2. Every strike request returns a `StrikeResolution`; a missing strike **never** yields a bare `[]` — it yields `reason: "nearest"` or `reason: "none"` with a UI chip.
3. The coverage manifest for any `(symbol, expiry)` resolves from cache in **< 50 ms** after first fetch; it is pinned and never evicted.
4. The OPFS cache never exceeds **250 MB**; LRU eviction is verified; a private-mode / quota failure degrades to no-cache without a crash.
5. The same strategy (e.g. a 9:20 short straddle, ATM, fixed SL / TGT) produces **identical** trade lists and P&L whether run via the no-code TS engine or the BYOC Pyodide path — because both call the same 6-function API over the same SQL.
6. All filtering / aggregation / resampling happens in DuckDB SQL; the only data crossing the WASM ↔ JS ↔ Pyodide boundary is resolved single-strike series (a few thousand rows), verified by inspecting boundary payload sizes.
7. Gap-fill policy holds: ≤ 3-min gaps are LOCF-filled and marked; > 3-min gaps snap-to-last-real with a `gapFilled` flag; whole-day-missing legs are excluded and listed — **no fabricated prices anywhere.**

---

## Appendix A — Files referenced / inspected while writing this spec

- `src/lib/options/payoff.ts` — `PayoffLeg`, `intrinsicValue`, `classifyStrategy`; lot-scaled qty convention (one NIFTY lot stored as qty 75). Reuse target for the live payoff + breakevens.
- `src/lib/montecarlo/simulate.ts` — R-multiple cone / percentile fan. Reused for the MC-drawdown headliner.
- `src/lib/charges/charges.ts` — per-broker STT / GST / stamp / brokerage. Net-of-cost P&L.
- `src/lib/db/adapters/local.ts` — existing WASM-DB-in-IndexedDB pattern the OPFS / IDB cache mirrors.
- `src/server/rate-limit.ts` — three-tier limiter (Upstash → platform-DB fixed window → in-memory) the paid server-run tier reuses.
- `src/server/env.ts` — server-only env convention (add an HF auth token here only if the dataset ever gates).
- `src/server/db/platform-schema.ts:216` — existing `notifications` table for long-run completion (in-app notification → Resend email).
- `src/app/app/backtesting/page.tsx` — placeholder to be removed / redirected (this is the in-app journal stub; the new universe is standalone, not here).

## Appendix B — Stack alignment notes

New dependencies required: `@duckdb/duckdb-wasm` (browser) and `@duckdb/node-api` (server manifest + paid tier). Pyodide is loaded only in the BYOC lane. Everything else reuses current dependencies: TanStack Query for the manifest fetch, Tailwind v4 semantic tokens (`bg`, `surface`, `surface-2`, `accent`, `profit`, `loss`, `muted`, `border`) for the coverage chips, Radix Dialog for the coverage-map modal, and recharts (already present) for the results charts.
