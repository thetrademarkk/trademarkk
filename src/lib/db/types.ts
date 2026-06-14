/**
 * Minimal database client interface satisfied by all three storage modes:
 * hosted (Turso, token-vended), BYOD (user's Turso), local (sql.js + IndexedDB).
 * Features only ever see this interface — they never know which mode is active.
 */
export type DbValue = string | number | null | Uint8Array;

export type DbRow = Record<string, DbValue>;

export interface DbResult {
  rows: DbRow[];
  rowsAffected: number;
}

export interface DbStatement {
  sql: string;
  args?: DbValue[];
}

export interface DbClient {
  execute(sql: string, args?: DbValue[]): Promise<DbResult>;
  batch(statements: DbStatement[]): Promise<DbResult[]>;
  /**
   * Force any debounced/coalesced persistence to complete and resolve only when
   * it has landed. Implemented by the local (sql.js → IndexedDB) adapter, where
   * writes are debounced; remote adapters (hosted/BYOD Turso) write synchronously
   * over the wire so they omit it. Callers that need durability-on-resolve after
   * a bulk write (backup restore, mode-switch copy) should `await db.flush?.()`.
   */
  flush?(): Promise<void>;
}

export type StorageMode = "hosted" | "byod" | "local";

export interface ByodCredentials {
  url: string;
  token: string;
}
