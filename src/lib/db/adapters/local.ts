import type { DbClient, DbResult, DbStatement, DbValue } from "../types";

/**
 * Local/demo mode: SQLite compiled to WASM (sql.js), persisted to IndexedDB.
 * Implements the same DbClient interface as the Turso adapters, so the entire
 * app works fully offline with zero accounts.
 */
const IDB_NAME = "trademarkk-local";
const IDB_STORE = "files";
const IDB_KEY = "journal.db";

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbLoad(): Promise<Uint8Array | null> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(req.result ? new Uint8Array(req.result) : null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSave(bytes: Uint8Array): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteLocalDb(): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// sql.js Database type (loaded dynamically to keep it out of the main bundle)
type SqlJsDatabase = {
  run(sql: string, params?: unknown[]): void;
  prepare(sql: string): {
    bind(params?: unknown[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): boolean;
  };
  getRowsModified(): number;
  export(): Uint8Array;
};

const isReadSql = (sql: string) => /^\s*(select|pragma|with|explain)/i.test(sql);

/** How long to wait after a write before exporting, so a burst coalesces into one export. */
const PERSIST_DEBOUNCE_MS = 50;

/** Injectable persistence sink — defaults to IndexedDB; overridden in unit tests. */
export interface LocalDbClientOptions {
  /** Persists a serialized DB snapshot. Defaults to the IndexedDB writer. */
  save?: (bytes: Uint8Array) => Promise<void>;
  /** Debounce window before a write burst is exported. Defaults to PERSIST_DEBOUNCE_MS. */
  debounceMs?: number;
}

export class LocalDbClient implements DbClient {
  private saving: Promise<void> | null = null;
  private dirty = false;
  // The flush that will cover writes accumulated since the last export started.
  // Every awaiting writer shares this promise, so a burst resolves off ONE export.
  private pending: Promise<void> | null = null;
  private resolvePending: (() => void) | null = null;
  private rejectPending: ((e: unknown) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  // Lifecycle listeners are torn down in dispose(); keep refs for removeEventListener.
  private readonly onLifecycle = () => {
    void this.flush();
  };
  private readonly onVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      void this.flush();
    }
  };

  private readonly save: (bytes: Uint8Array) => Promise<void>;
  private readonly debounceMs: number;

  constructor(
    private db: SqlJsDatabase,
    options: LocalDbClientOptions = {}
  ) {
    this.save = options.save ?? idbSave;
    this.debounceMs = options.debounceMs ?? PERSIST_DEBOUNCE_MS;
    // Backstop durability: never lose a debounced write when the tab is
    // backgrounded or closed. visibilitychange→hidden + pagehide are the
    // reliable mobile/desktop signals; beforeunload is a legacy backstop.
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this.onLifecycle);
      window.addEventListener("beforeunload", this.onLifecycle);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
  }

  /**
   * Marks the DB dirty and schedules a SINGLE coalesced export+IDB-write a short
   * debounce after the last write, instead of one export per execute()/batch().
   * Returns a promise that resolves once an export covering this write has
   * completed — callers that need durability-on-resolve can await it (so does
   * flush()), while execute()/batch() leave it unawaited so a burst collapses
   * into one export. Durability for the unawaited path is guaranteed by the
   * debounce timer firing and by the lifecycle flush handlers.
   */
  private schedulePersist(): Promise<void> {
    this.dirty = true;
    if (!this.pending) {
      this.pending = new Promise<void>((resolve, reject) => {
        this.resolvePending = resolve;
        this.rejectPending = reject;
      });
      // execute()/batch() drop the returned promise, so a rejected pending would
      // surface as an unhandled rejection. flush() already logs the error; this
      // no-op keeps the dropped promise from being "unhandled". Explicit awaiters
      // (flush/dispose) re-await `saving`, which still rejects for them.
      this.pending.catch(() => {});
    }
    if (this.timer) clearTimeout(this.timer);
    // Coalesce a burst; flush immediately once the page is being torn down.
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
    return this.pending;
  }

  /**
   * Forces any pending debounced write to disk now and resolves when it lands.
   * Idempotent and safe to call when nothing is dirty. Coalesces concurrent
   * callers onto one in-flight export, re-exporting if a write arrived mid-save
   * so the resolved state is always the latest before resolving.
   */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // An in-flight save already re-exports while `dirty` is set, so the latest
    // state is covered; any writer that arrived mid-save shares the same in-flight
    // promise and is resolved when it settles.
    if (this.saving) return this.saving;
    if (!this.dirty) return Promise.resolve();
    this.saving = (async () => {
      try {
        // Re-export until no write is outstanding, so the final IDB blob and the
        // resolved waiter reflect the newest state — never an under-write.
        while (this.dirty) {
          this.dirty = false;
          await this.save(this.db.export());
        }
        // Resolve every writer whose data this export covered.
        this.resolvePending?.();
        this.pending = null;
        this.resolvePending = null;
        this.rejectPending = null;
      } catch (e) {
        console.error("[local-db] persist failed", e);
        // Surface the failure to awaiting writers so it isn't silently dropped.
        this.rejectPending?.(e);
        this.pending = null;
        this.resolvePending = null;
        this.rejectPending = null;
        throw e;
      } finally {
        this.saving = null;
      }
    })();
    // Don't leak an unhandled rejection from the in-flight promise itself; real
    // awaiters (flush callers / the pending waiter) still observe the error.
    this.saving.catch(() => {});
    return this.saving;
  }

  /** Flushes any pending write and removes lifecycle listeners. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.onLifecycle);
      window.removeEventListener("beforeunload", this.onLifecycle);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    await this.flush();
  }

  private read(sql: string, args: DbValue[]): DbResult {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(args as unknown[]);
      const rows: DbResult["rows"] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as DbResult["rows"][number]);
      return { rows, rowsAffected: 0 };
    } finally {
      stmt.free();
    }
  }

  async execute(sql: string, args: DbValue[] = []): Promise<DbResult> {
    if (isReadSql(sql)) return this.read(sql, args);
    this.db.run(sql, args as unknown[]);
    const affected = this.db.getRowsModified();
    // The write is already applied in memory, so reads are immediately
    // consistent. Schedule a coalesced export (don't block per-call) — a burst
    // of writes thus collapses into ONE serialization instead of one each.
    // Durability is guaranteed by the debounce timer + lifecycle flush handlers.
    this.schedulePersist();
    return { rows: [], rowsAffected: affected };
  }

  async batch(statements: DbStatement[]): Promise<DbResult[]> {
    const results: DbResult[] = [];
    let mutated = false;
    this.db.run("BEGIN");
    try {
      for (const s of statements) {
        if (isReadSql(s.sql)) {
          results.push(this.read(s.sql, s.args ?? []));
        } else {
          this.db.run(s.sql, (s.args ?? []) as unknown[]);
          mutated = true;
          results.push({ rows: [], rowsAffected: this.db.getRowsModified() });
        }
      }
      this.db.run("COMMIT");
    } catch (e) {
      this.db.run("ROLLBACK");
      throw e;
    }
    // See execute(): schedule a single coalesced export rather than one per
    // batch, so bulk imports (ceil(M/100) batches) serialize the DB once.
    if (mutated) this.schedulePersist();
    return results;
  }
}

let localDbPromise: Promise<DbClient> | null = null;

/** Wipes the local DB (IndexedDB + in-memory cache) so the next open starts fresh. */
export async function resetLocalDb(): Promise<void> {
  localDbPromise = null;
  await deleteLocalDb();
}

export function createLocalDb(): Promise<DbClient> {
  if (!localDbPromise) {
    localDbPromise = (async () => {
      const initSqlJs = (await import("sql.js")).default;
      const SQL = await initSqlJs({ locateFile: (f: string) => `/sqljs/${f}` });
      const existing = await idbLoad();
      const db = (existing
        ? new SQL.Database(existing)
        : new SQL.Database()) as unknown as SqlJsDatabase;
      return new LocalDbClient(db);
    })();
  }
  return localDbPromise;
}
