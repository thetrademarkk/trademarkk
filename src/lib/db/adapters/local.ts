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

class LocalDbClient implements DbClient {
  private saving: Promise<void> | null = null;
  private dirty = false;

  constructor(private db: SqlJsDatabase) {}

  /**
   * Persists the DB to IndexedDB. Coalesces concurrent callers into one
   * in-flight export, but always re-exports if a write landed mid-save — so
   * the resolved promise reflects the latest state. Writes await this, making
   * data durable before a mutation resolves (no debounce race on navigation).
   */
  private persist(): Promise<void> {
    this.dirty = true;
    if (this.saving) return this.saving;
    this.saving = (async () => {
      try {
        while (this.dirty) {
          this.dirty = false;
          await idbSave(this.db.export());
        }
      } catch (e) {
        console.error("[local-db] persist failed", e);
      } finally {
        this.saving = null;
      }
    })();
    return this.saving;
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
    await this.persist();
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
    if (mutated) await this.persist();
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
