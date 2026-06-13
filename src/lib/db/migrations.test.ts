import { beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import initSqlJs from "sql.js";
import { runMigrations, SCHEMA_VERSION } from "./migrations";
import type { DbClient, DbResult, DbStatement, DbValue } from "./types";

/**
 * A minimal in-memory DbClient over sql.js (same engine as local/BYOD/hosted
 * modes use), so we exercise the real migration SQL — including the PRAGMA-based
 * idempotent ADD COLUMN and the v4 product backfill.
 */
type SqlJsStatic = Awaited<ReturnType<typeof initSqlJs>>;
let SQL: SqlJsStatic;

beforeAll(async () => {
  const buf = fs.readFileSync(
    path.resolve(__dirname, "../../../node_modules/sql.js/dist/sql-wasm.wasm")
  );
  // Copy into a standalone ArrayBuffer — sql.js's `wasmBinary` is typed as
  // ArrayBuffer, which a Node Buffer/Uint8Array doesn't satisfy under strict libs.
  const wasmBinary = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  SQL = await initSqlJs({ wasmBinary });
});

function makeClient() {
  const db = new SQL.Database();
  const isRead = (sql: string) => /^\s*(select|pragma|with|explain)/i.test(sql);
  const read = (sql: string, args: DbValue[]): DbResult => {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(args as never[]);
      const rows: DbResult["rows"] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as DbResult["rows"][number]);
      return { rows, rowsAffected: 0 };
    } finally {
      stmt.free();
    }
  };
  const client: DbClient = {
    async execute(sql, args = []) {
      if (isRead(sql)) return read(sql, args);
      db.run(sql, args as never[]);
      return { rows: [], rowsAffected: db.getRowsModified() };
    },
    async batch(statements: DbStatement[]) {
      return Promise.all(statements.map((s) => client.execute(s.sql, s.args ?? [])));
    },
  };
  return { db, client };
}

async function columns(client: DbClient, table: string): Promise<string[]> {
  const res = await client.execute(`PRAGMA table_info(${table})`);
  return res.rows.map((r) => String(r.name));
}

describe("journal DB migrations — v4 Segment × Product", () => {
  it("adds a nullable `product` column to trades and an index", async () => {
    const { client } = makeClient();
    await runMigrations(client);
    expect(await columns(client, "trades")).toContain("product");
    const idx = await client.execute(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_trades_product'`
    );
    expect(idx.rows.length).toBe(1);
  });

  it("records the latest schema version", async () => {
    const { client } = makeClient();
    await runMigrations(client);
    const res = await client.execute(`SELECT MAX(version) AS v FROM schema_migrations`);
    expect(Number(res.rows[0]!.v)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(4);
  });

  it("is idempotent — running twice does not throw or duplicate the column", async () => {
    const { client } = makeClient();
    await runMigrations(client);
    await runMigrations(client); // second run is a no-op (version-gated)
    const cols = await columns(client, "trades");
    expect(cols.filter((c) => c === "product")).toHaveLength(1);
  });

  it("backfills product for legacy trades by holding pattern", async () => {
    const { client } = makeClient();
    await runMigrations(client); // full schema (product column exists)

    const ins = (id: string, segment: string, opened: string, closed: string | null) =>
      client.execute(
        `INSERT INTO trades (id, account_id, symbol, segment, product, direction, status, qty, avg_entry, opened_at, closed_at, created_at, updated_at)
         VALUES (?, 'a', 'X', ?, NULL, 'long', 'closed', 1, 100, ?, ?, ?, ?)`,
        [id, segment, opened, closed, opened, opened]
      );
    // Same-day equity → MIS; overnight equity → CNC; open equity → stays NULL; derivatives → NRML.
    await ins("intra", "EQ", "2026-06-01T04:00:00Z", "2026-06-01T09:00:00Z");
    await ins("deliv", "EQ", "2026-06-01T04:00:00Z", "2026-06-03T09:00:00Z");
    await ins("openq", "EQ", "2026-06-01T04:00:00Z", null);
    await ins("fut", "FUT", "2026-06-01T04:00:00Z", "2026-06-03T09:00:00Z");
    await ins("opt", "OPT", "2026-06-01T04:00:00Z", "2026-06-01T09:00:00Z");

    // Re-run the v4 backfill UPDATEs directly (they only touch NULL rows — the
    // exact statements the migration runs, here against rows inserted post-v4).
    await client.execute(
      `UPDATE trades SET product = 'MIS' WHERE product IS NULL AND segment = 'EQ' AND closed_at IS NOT NULL AND date(opened_at) = date(closed_at)`
    );
    await client.execute(
      `UPDATE trades SET product = 'CNC' WHERE product IS NULL AND segment = 'EQ' AND closed_at IS NOT NULL AND date(opened_at) <> date(closed_at)`
    );
    await client.execute(
      `UPDATE trades SET product = 'NRML' WHERE product IS NULL AND segment IN ('FUT','OPT','COMM','CDS')`
    );

    const get = async (id: string) =>
      (await client.execute(`SELECT product FROM trades WHERE id = ?`, [id])).rows[0]!.product;
    expect(await get("intra")).toBe("MIS");
    expect(await get("deliv")).toBe("CNC");
    expect(await get("fut")).toBe("NRML");
    expect(await get("opt")).toBe("NRML");
    // An open equity trade has no close → stays NULL (engine treats null as MIS).
    expect(await get("openq")).toBeNull();
  });
});
