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
}

export type StorageMode = "hosted" | "byod" | "local";

export interface ByodCredentials {
  url: string;
  token: string;
}
