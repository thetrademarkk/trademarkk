import { createClient } from "@libsql/client/web";
import type { DbClient, DbResult, DbRow, DbStatement, DbValue } from "../types";

type LibsqlClient = ReturnType<typeof createClient>;

function rowsToObjects(columns: string[], rows: unknown[][]): DbRow[] {
  return rows.map((row) => {
    const obj: DbRow = {};
    columns.forEach((c, i) => {
      obj[c] = row[i] as DbValue;
    });
    return obj;
  });
}

class LibsqlDbClient implements DbClient {
  constructor(private client: LibsqlClient) {}

  async execute(sql: string, args: DbValue[] = []): Promise<DbResult> {
    const rs = await this.client.execute({ sql, args });
    return {
      rows: rowsToObjects(rs.columns, rs.rows as unknown as unknown[][]),
      rowsAffected: rs.rowsAffected,
    };
  }

  async batch(statements: DbStatement[]): Promise<DbResult[]> {
    const results = await this.client.batch(
      statements.map((s) => ({ sql: s.sql, args: s.args ?? [] })),
      "write"
    );
    return results.map((rs) => ({
      rows: rowsToObjects(rs.columns, rs.rows as unknown as unknown[][]),
      rowsAffected: rs.rowsAffected,
    }));
  }
}

/** Connect to any Turso/libSQL database over HTTPS — works in the browser. */
export function createLibsqlDb(url: string, authToken: string): DbClient {
  // libsql:// URLs use websockets by default; force HTTPS for browser compatibility.
  const httpsUrl = url.replace(/^libsql:\/\//, "https://");
  return new LibsqlDbClient(createClient({ url: httpsUrl, authToken }));
}
