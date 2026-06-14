import { beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import initSqlJs from "sql.js";
import { runMigrations } from "./migrations";
import { seedDefaults, seedSampleData } from "./seed";
import {
  sanitizeTraderProfile,
  TRADER_PROFILE_KEY,
  type TraderType,
} from "@/features/onboarding/trader-profile";
import { classifyHorizon, horizonMix, type HorizonTradeLike } from "@/lib/stats/horizon";
import type { DbClient, DbResult, DbStatement, DbValue } from "./types";

/**
 * SEG-08 — exercises seeding over the REAL migration SQL on an in-memory sql.js
 * DB (the same engine the local/BYOD/hosted modes use). Verifies the
 * trader_profile round-trip and that "Explore with sample data" produces trades
 * MATCHING the chosen trader type.
 */
type SqlJsStatic = Awaited<ReturnType<typeof initSqlJs>>;
let SQL: SqlJsStatic;

beforeAll(async () => {
  const buf = fs.readFileSync(
    path.resolve(__dirname, "../../../node_modules/sql.js/dist/sql-wasm.wasm")
  );
  const wasmBinary = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  SQL = await initSqlJs({ wasmBinary });
});

function makeClient(): DbClient {
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
  return client;
}

async function freshDb(): Promise<DbClient> {
  const client = makeClient();
  await runMigrations(client);
  return client;
}

async function readSetting(db: DbClient, key: string): Promise<string | null> {
  const res = await db.execute(`SELECT value FROM settings WHERE key = ?`, [key]);
  const v = res.rows[0]?.value;
  return v == null ? null : String(v);
}

type SeededTrade = HorizonTradeLike & {
  segment: string;
  product: string | null;
  exchange: string;
  opened_at: string;
  closed_at: string;
  net_pnl: number;
};

async function readTrades(db: DbClient): Promise<SeededTrade[]> {
  const res = await db.execute(`SELECT * FROM trades`);
  return res.rows as unknown as SeededTrade[];
}

describe("seedDefaults — persists trader_profile (SEG-08)", () => {
  it("writes a valid trader_profile.v1 row for each trader type (round-trip)", async () => {
    for (const t of [
      "intraday-equity",
      "swing",
      "fno",
      "commodity",
      "currency",
      "mixed",
    ] as TraderType[]) {
      const db = await freshDb();
      await seedDefaults(db, {
        accountName: "T",
        broker: "zerodha",
        startingCapital: 100000,
        defaultRiskPct: 1,
        traderType: t,
      });
      const raw = await readSetting(db, TRADER_PROFILE_KEY);
      expect(raw).not.toBeNull();
      expect(sanitizeTraderProfile(JSON.parse(raw!))).toEqual({ traderType: t });
    }
  });

  it("defaults to the mixed profile when no trader type is supplied (back-compat)", async () => {
    const db = await freshDb();
    await seedDefaults(db, {
      accountName: "T",
      broker: "zerodha",
      startingCapital: 100000,
      defaultRiskPct: 1,
    });
    const raw = await readSetting(db, TRADER_PROFILE_KEY);
    expect(sanitizeTraderProfile(JSON.parse(raw!))).toEqual({ traderType: "mixed" });
  });

  it("clamps a garbage trader type to mixed before persisting", async () => {
    const db = await freshDb();
    await seedDefaults(db, {
      accountName: "T",
      broker: "zerodha",
      startingCapital: 100000,
      defaultRiskPct: 1,
      traderType: "scalper" as TraderType,
    });
    const raw = await readSetting(db, TRADER_PROFILE_KEY);
    expect(sanitizeTraderProfile(JSON.parse(raw!))).toEqual({ traderType: "mixed" });
  });

  it("still marks the journal onboarded", async () => {
    const db = await freshDb();
    await seedDefaults(db, {
      accountName: "T",
      broker: "zerodha",
      startingCapital: 100000,
      defaultRiskPct: 1,
      traderType: "swing",
    });
    expect(await readSetting(db, "onboarded")).toBe("1");
  });
});

describe("seedSampleData — trades match the trader type (SEG-08)", () => {
  it("intraday-equity seeds same-day EQ MIS trades", async () => {
    const db = await freshDb();
    await seedSampleData(db, "intraday-equity");
    const trades = await readTrades(db);
    expect(trades.length).toBeGreaterThan(20);
    expect(trades.every((t) => t.segment === "EQ" && t.product === "MIS")).toBe(true);
    // Every trade classifies as intraday and the persisted profile matches.
    expect(trades.every((t) => classifyHorizon(t) === "intraday")).toBe(true);
    const raw = await readSetting(db, TRADER_PROFILE_KEY);
    expect(sanitizeTraderProfile(JSON.parse(raw!))).toEqual({ traderType: "intraday-equity" });
  });

  it("swing seeds multi-day CNC equity (positional emphasis)", async () => {
    const db = await freshDb();
    await seedSampleData(db, "swing");
    const trades = await readTrades(db);
    expect(trades.every((t) => t.segment === "EQ" && t.product === "CNC")).toBe(true);
    // No CNC trade should be intraday; the mix should read predominantly multi-day.
    expect(trades.some((t) => classifyHorizon(t) !== "intraday")).toBe(true);
    expect(trades.every((t) => classifyHorizon(t) !== "intraday")).toBe(true);
    expect(horizonMix(trades).multiDayPct).toBeGreaterThanOrEqual(0.7);
  });

  it("F&O seeds OPT trades and multi-leg strategies (trade_legs present)", async () => {
    const db = await freshDb();
    await seedSampleData(db, "fno");
    const trades = await readTrades(db);
    expect(trades.every((t) => t.segment === "OPT")).toBe(true);
    const legs = await db.execute(`SELECT COUNT(*) AS n FROM trade_legs`);
    expect(Number(legs.rows[0]!.n)).toBeGreaterThan(0);
  });

  it("commodity seeds MCX COMM trades on the MCX exchange", async () => {
    const db = await freshDb();
    await seedSampleData(db, "commodity");
    const trades = await readTrades(db);
    expect(trades.length).toBeGreaterThan(0);
    expect(trades.every((t) => t.segment === "COMM" && t.exchange === "MCX")).toBe(true);
    // No commodity option spreads were seeded — only single-instrument futures.
    const legs = await db.execute(`SELECT COUNT(*) AS n FROM trade_legs`);
    expect(Number(legs.rows[0]!.n)).toBe(0);
  });

  it("currency seeds CDS trades", async () => {
    const db = await freshDb();
    await seedSampleData(db, "currency");
    const trades = await readTrades(db);
    expect(trades.length).toBeGreaterThan(0);
    expect(trades.every((t) => t.segment === "CDS")).toBe(true);
  });

  it("mixed (the default) blends segments and includes multi-leg options", async () => {
    const db = await freshDb();
    await seedSampleData(db); // default = mixed
    const trades = await readTrades(db);
    const segments = new Set(trades.map((t) => t.segment));
    // A mixed book spans several segments.
    expect(segments.size).toBeGreaterThanOrEqual(3);
    expect(segments.has("OPT")).toBe(true);
    const legs = await db.execute(`SELECT COUNT(*) AS n FROM trade_legs`);
    expect(Number(legs.rows[0]!.n)).toBeGreaterThan(0);
  });

  it("seeds are deterministic — same type seeds the same trade count", async () => {
    const dbA = await freshDb();
    const dbB = await freshDb();
    await seedSampleData(dbA, "swing");
    await seedSampleData(dbB, "swing");
    const a = await readTrades(dbA);
    const b = await readTrades(dbB);
    expect(a.length).toBe(b.length);
  });
});
