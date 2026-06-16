/**
 * duck-browser.ts — the lazy duckdb-wasm bootstrap + query helper for the BROWSER
 * data path (07-data-layer.md §3a). This is the ONLY module that imports
 * `@duckdb/duckdb-wasm`; everything else stays node/vitest-safe.
 *
 * Hard rules (all verified against the real package API for the pinned version):
 *   - LAZY: importing this module instantiates NOTHING. The WASM blob, worker,
 *     and httpfs install happen on the FIRST getDuck()/query() call only, so the
 *     builder UI is never blocked on the data engine (the live right-rail payoff
 *     is pure payoff.ts math and needs zero remote data).
 *   - COALESCED: concurrent first-callers share ONE in-flight init promise; we
 *     never spin up two databases or two httpfs installs.
 *   - DIRECT HF READS: the dataset is public + ungated and HF's CDN
 *     (cas-bridge.xethub.hf.co) returns 206 + CORS and passes the OPTIONS
 *     preflight, so duckdb-wasm's httpfs range-reads
 *     `https://huggingface.co/datasets/.../resolve/main/<path>` DIRECTLY — no
 *     proxy. The signed CDN target carries an ~1h `Expires`, so we NEVER cache a
 *     resolved redirect URL; we always read through the stable `resolve/main` URL
 *     and let httpfs follow the 302 per query.
 *
 * NO secrets here — the dataset is public; there is no token in client code.
 *
 * This module is browser-only (it constructs a Worker and loads WASM). It must
 * never be imported from node/server code or from a vitest unit test; the pure,
 * testable surface is sql.ts. Tests that exercise the CLIENT inject a fake
 * `QueryFn` (see runQuery's signature) instead of importing this.
 */

import type * as duckdb from "@duckdb/duckdb-wasm";

/* ───────────────────────────── tuning knobs ──────────────────────────────── */

/** Soft working-set cap; DuckDB spills/streams beyond it (07-data-layer §6). */
const MEMORY_LIMIT = "512MB";

/**
 * One known-good HF parquet used by the capability probe — the NIFTY spot file
 * is the smallest always-present file in the dataset. We only HEAD/range-poke it.
 */
const PROBE_URL =
  "https://huggingface.co/datasets/thetrademarkk/india-index-options-1m/resolve/main/index/NIFTY.parquet";

/* ─────────────────────────────── lazy init ───────────────────────────────── */

let _dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

/**
 * Get the singleton AsyncDuckDB, instantiating it on the first call only.
 * Concurrent callers share the same in-flight promise. On failure the cached
 * promise is cleared so a later call can retry (a transient WASM/network blip
 * should not permanently poison the engine).
 */
export async function getDuck(): Promise<duckdb.AsyncDuckDB> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = instantiate().catch((err) => {
    _dbPromise = null; // allow retry after a transient failure
    throw err;
  });
  return _dbPromise;
}

async function instantiate(): Promise<duckdb.AsyncDuckDB> {
  // Dynamic import keeps the WASM bundle out of the initial chunk — the module
  // graph only pulls duckdb-wasm in when a data call actually fires.
  const duckdb = await import("@duckdb/duckdb-wasm");

  // SAME-ORIGIN bundle. The app CSP is `worker-src 'self' blob:` (no CDN), so the
  // default jsDelivr bundle's cross-origin worker is BLOCKED. We self-host the
  // pinned wasm + worker under /duckdb/ (scripts/copy-duckdb-assets.mjs, run as a
  // `prebuild` step) and let selectBundle pick `eh` vs `mvp` from the SAME-ORIGIN
  // manifest — so `new Worker(...)` is same-origin and CSP-clean, and the SW can
  // precache the blobs for offline LOCAL mode.
  const bundle = await duckdb.selectBundle({
    mvp: {
      mainModule: "/duckdb/duckdb-mvp.wasm",
      mainWorker: "/duckdb/duckdb-browser-mvp.worker.js",
    },
    eh: {
      mainModule: "/duckdb/duckdb-eh.wasm",
      mainWorker: "/duckdb/duckdb-browser-eh.worker.js",
    },
  });
  if (!bundle.mainWorker) {
    throw new Error("duckdb-wasm: selected bundle has no mainWorker");
  }
  const worker = new Worker(bundle.mainWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

  // One-time session setup on a throwaway connection.
  const conn = await db.connect();
  try {
    await conn.query(`INSTALL httpfs; LOAD httpfs;`);
    // Cache parquet FOOTERS (schema + row-group stats) across queries so repeated
    // reads of the same file skip re-fetching metadata. We do NOT cache byte
    // ranges or redirect targets — the HF CDN handles range caching and the
    // signed URL expires.
    await conn.query(`SET enable_http_metadata_cache=true;`);
    await conn.query(`SET http_keep_alive=true;`);
    await conn.query(`SET memory_limit='${MEMORY_LIMIT}';`);
  } finally {
    await conn.close();
  }

  return db;
}

/**
 * A minimal Arrow-table shape the rest of the data layer consumes. We deliberately
 * do NOT re-export apache-arrow types across module boundaries — callers iterate
 * rows via `toArray()` and read the numeric/string columns by name. This is also
 * the seam the tests mock: a fake `QueryFn` returns an object of this shape.
 */
export interface QueryResult<Row = Record<string, unknown>> {
  /** Materialize all rows as plain objects (Arrow `Table.toArray()`). */
  toArray(): Row[];
  /** Row count (Arrow `Table.numRows`). */
  readonly numRows: number;
}

/** The injectable query seam — exactly what duckdb-wasm's `conn.query` exposes. */
export type QueryFn = <Row = Record<string, unknown>>(sql: string) => Promise<QueryResult<Row>>;

/**
 * Run finished SQL against duckdb-wasm and return an Arrow-table-shaped result.
 * The SQL is already complete (sql.ts inlines validated literals), so this opens
 * a connection, runs, and closes. For hot paths the client may hold a connection
 * open via `withConnection`; this is the simple one-shot helper.
 */
export async function query<Row = Record<string, unknown>>(sql: string): Promise<QueryResult<Row>> {
  const db = await getDuck();
  const conn = await db.connect();
  try {
    const table = await conn.query<never>(sql);
    return table as unknown as QueryResult<Row>;
  } finally {
    await conn.close();
  }
}

/**
 * Run a callback with a single open connection — for a burst of queries (a leg +
 * its gap grid + coverage) that should reuse one connection / keep-alive socket.
 * The connection is always closed, even on throw.
 */
export async function withConnection<T>(fn: (run: QueryFn) => Promise<T>): Promise<T> {
  const db = await getDuck();
  const conn = await db.connect();
  const run: QueryFn = async <Row = Record<string, unknown>>(sql: string) => {
    const table = await conn.query<never>(sql);
    return table as unknown as QueryResult<Row>;
  };
  try {
    return await fn(run);
  } finally {
    await conn.close();
  }
}

/* ─────────────────────────── capability probe ────────────────────────────── */

/** What the probe reports back to the UI's "preparing data engine" gate. */
export interface DuckCapability {
  /** True when duckdb-wasm range-read one HF parquet footer successfully. */
  directReads: boolean;
  /** Milliseconds the probe took (engine init + one tiny metadata read). */
  elapsedMs: number;
  /** Set when directReads is false — a human-readable reason for the UI. */
  reason?: string;
}

/**
 * Probe whether direct browser → HF parquet range reads work in THIS environment
 * (CORS / preflight / network policy can vary). We run the cheapest possible
 * query — read only the parquet FOOTER schema, not any row groups — against the
 * always-present NIFTY spot file. A success proves httpfs can follow the
 * `resolve/main` 302 to the CDN and honor range requests here.
 *
 * Never throws: a failure resolves to `{ directReads: false, reason }` so the UI
 * can show a graceful busy/unavailable state rather than crashing the builder.
 */
export async function probeDirectReads(url: string = PROBE_URL): Promise<DuckCapability> {
  const started = nowMs();
  try {
    // `DESCRIBE SELECT ... LIMIT 0` reads only the parquet footer (schema + stats)
    // and zero row groups — the smallest possible proof that range reads work.
    const sql = `DESCRIBE SELECT * FROM read_parquet('${url}') LIMIT 0`;
    const res = await query(sql);
    const ok = res.numRows > 0;
    return ok
      ? { directReads: true, elapsedMs: nowMs() - started }
      : {
          directReads: false,
          elapsedMs: nowMs() - started,
          reason: "Probe query returned no schema rows.",
        };
  } catch (err) {
    return {
      directReads: false,
      elapsedMs: nowMs() - started,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/** High-resolution clock when available, wall-clock otherwise (test-safe). */
function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/**
 * TEST/HMR hook: drop the cached database so a later getDuck() rebuilds it. Not
 * used in normal app flow (the singleton lives for the page session).
 */
export function __resetDuckForTest(): void {
  _dbPromise = null;
}
