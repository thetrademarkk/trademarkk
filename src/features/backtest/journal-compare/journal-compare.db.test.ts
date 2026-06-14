/**
 * DB-backed integration test for BT-12 journal-compare.
 *
 * Seeds REAL journal trades into an in-memory sql.js DB created by the ACTUAL
 * journal migration SQL (the same engine local/BYOD/hosted modes use), reads
 * them back through the SAME query shape the journal's `useTrades` / `useAllLegs`
 * produce, runs the comparison against a real golden backtest, and asserts the
 * descriptive output — proving the adapter consumes the journal's true on-disk
 * shape (incl. multi-leg rows) without touching the journal write paths.
 *
 * Mirrors the SEG-08-style seed test idiom (sql.js over the real migrations).
 */

import { beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import initSqlJs from "sql.js";
import { runMigrations } from "@/lib/db/migrations";
import type { DbClient, DbResult, DbStatement, DbValue } from "@/lib/db/types";
import { runBacktest } from "@/lib/backtest/engine/engine";
import { FixtureDataSource } from "@/lib/backtest/engine/adapters/fixture-source";
import { loadGoldenSnapshot } from "@/lib/backtest/__fixtures__/golden-loader";
import { makeDefaultStrategy, type StrategyDef } from "@/features/backtest/shared/strategy-def";
import type { RunResult } from "@/features/backtest/shared/run-result";
import { normalizeJournalTrades, type JournalLegInput, type JournalTradeInput } from "./adapter";
import { compareJournalToBacktest } from "./compare";

type SqlJsStatic = Awaited<ReturnType<typeof initSqlJs>>;
let SQL: SqlJsStatic;

beforeAll(async () => {
  const buf = fs.readFileSync(
    path.resolve(__dirname, "../../../../node_modules/sql.js/dist/sql-wasm.wasm")
  );
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

/** Insert one trade row (matching the real `trades` table columns post-migration). */
async function insertTrade(
  client: DbClient,
  t: {
    id: string;
    symbol: string;
    segment: string;
    product?: string | null;
    direction?: string;
    status?: string;
    qty?: number;
    opened_at: string;
    closed_at: string | null;
    gross_pnl: number;
    charges: number;
    net_pnl: number;
  }
) {
  await client.execute(
    `INSERT INTO trades
       (id, account_id, symbol, exchange, segment, product, direction, status, qty,
        avg_entry, avg_exit, opened_at, closed_at, gross_pnl, charges, net_pnl,
        created_at, updated_at)
     VALUES (?, 'acc1', ?, 'NSE', ?, ?, ?, ?, ?, 100, 120, ?, ?, ?, ?, ?, ?, ?)`,
    [
      t.id,
      t.symbol,
      t.segment,
      t.product ?? null,
      t.direction ?? "long",
      t.status ?? "closed",
      t.qty ?? 75,
      t.opened_at,
      t.closed_at,
      t.gross_pnl,
      t.charges,
      t.net_pnl,
      "2024-07-24T00:00:00.000Z",
      "2024-07-24T00:00:00.000Z",
    ]
  );
}

/** Read trades back exactly as the journal's useTrades query does. */
async function readTrades(client: DbClient): Promise<JournalTradeInput[]> {
  const res = await client.execute(`SELECT t.* FROM trades t ORDER BY t.opened_at DESC`);
  return res.rows as unknown as JournalTradeInput[];
}

/** Read all legs grouped by trade, exactly as useAllLegs does. */
async function readLegs(client: DbClient): Promise<Map<string, JournalLegInput[]>> {
  const res = await client.execute(`SELECT * FROM trade_legs ORDER BY trade_id, leg_no`);
  const map = new Map<string, JournalLegInput[]>();
  for (const r of res.rows as unknown as JournalLegInput[]) {
    const arr = map.get(r.trade_id);
    if (arr) arr.push(r);
    else map.set(r.trade_id, [r]);
  }
  return map;
}

function goldenRun(): RunResult {
  const base = makeDefaultStrategy("g", "NIFTY");
  const strat: StrategyDef = {
    ...base,
    name: "Short Straddle",
    market: {
      symbol: "NIFTY",
      interval: "1m",
      dateRange: { start: "2024-07-24", end: "2024-07-25" },
    },
    timing: { mode: "fixed_time", entryTime: "09:20", exitTime: "15:15" },
    legs: [
      {
        id: "ce",
        enabled: true,
        optionType: "CE",
        side: "sell",
        lots: 1,
        strike: { mode: "ATM_OFFSET", steps: 0 },
        expiry: "WEEKLY",
        squareOff: "partial",
      },
      {
        id: "pe",
        enabled: true,
        optionType: "PE",
        side: "sell",
        lots: 1,
        strike: { mode: "ATM_OFFSET", steps: 0 },
        expiry: "WEEKLY",
        squareOff: "partial",
      },
    ],
  };
  return runBacktest(strat, new FixtureDataSource(loadGoldenSnapshot()), { ranAt: 0 });
}

describe("journal-compare over the REAL journal DB (sql.js + real migrations)", () => {
  it("seeds mixed-segment trades and compares the NIFTY subset against the golden run", async () => {
    const { client } = makeClient();
    await runMigrations(client);

    // A realistic mixed book: NIFTY (comparable) + RELIANCE/CRUDE (not comparable).
    await insertTrade(client, {
      id: "n1",
      symbol: "NIFTY",
      segment: "FUT",
      product: "NRML",
      opened_at: "2024-07-24T04:00:00.000Z",
      closed_at: "2024-07-24T09:30:00.000Z",
      gross_pnl: 600,
      charges: 100,
      net_pnl: 500,
    });
    await insertTrade(client, {
      id: "n2",
      symbol: "NIFTY",
      segment: "OPT",
      product: "MIS",
      opened_at: "2024-07-25T04:00:00.000Z",
      closed_at: "2024-07-25T09:30:00.000Z",
      gross_pnl: -200,
      charges: 100,
      net_pnl: -300,
    });
    await insertTrade(client, {
      id: "r1",
      symbol: "RELIANCE",
      segment: "EQ",
      product: "CNC",
      opened_at: "2024-07-24T04:00:00.000Z",
      closed_at: "2024-07-26T09:30:00.000Z",
      gross_pnl: 1000,
      charges: 50,
      net_pnl: 950,
    });
    // Multi-leg NIFTY straddle on day 1: leg-row qty (75+75) should override the
    // single qty on the trade row when summed.
    await insertTrade(client, {
      id: "straddle",
      symbol: "NIFTY",
      segment: "OPT",
      product: "MIS",
      qty: 75,
      opened_at: "2024-07-24T04:05:00.000Z",
      closed_at: "2024-07-24T09:25:00.000Z",
      gross_pnl: 300,
      charges: 60,
      net_pnl: 240,
    });
    await client.execute(
      `INSERT INTO trade_legs (id, trade_id, leg_no, strike, option_type, direction, qty, avg_entry, avg_exit)
       VALUES ('l1','straddle',1,24500,'CE','short',75,100,80), ('l2','straddle',2,24500,'PE','short',75,90,70)`
    );

    const rawTrades = await readTrades(client);
    expect(rawTrades.length).toBe(4);
    const legs = await readLegs(client);
    const normalized = normalizeJournalTrades(rawTrades, legs);

    // The straddle's qty is summed across legs (150), not the row's 75.
    const straddle = normalized.find((t) => t.id === "straddle")!;
    expect(straddle.qty).toBe(150);
    // RELIANCE resolves to no comparable index.
    expect(normalized.find((t) => t.id === "r1")!.index).toBeNull();

    const res = compareJournalToBacktest(normalized, goldenRun());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const c = res.compare;
    expect(c.index).toBe("NIFTY");
    // Day 24 = 500 (n1) + 240 (straddle) = 740; day 25 = −300 (n2).
    const total = c.metrics.find((m) => m.key === "totalPnl")!;
    expect(total.real).toBe(440); // 740 − 300
    // RELIANCE never enters the NIFTY comparison.
    expect(c.sampleTrades).toBe(3); // n1, n2, straddle (all NIFTY, in range)
  });

  it("a non-index-only book yields the honest no-comparable-instrument state", async () => {
    const { client } = makeClient();
    await runMigrations(client);
    await insertTrade(client, {
      id: "r1",
      symbol: "TCS",
      segment: "EQ",
      product: "CNC",
      opened_at: "2024-07-24T04:00:00.000Z",
      closed_at: "2024-07-24T09:30:00.000Z",
      gross_pnl: 500,
      charges: 50,
      net_pnl: 450,
    });
    const normalized = normalizeJournalTrades(await readTrades(client), await readLegs(client));
    const res = compareJournalToBacktest(normalized, goldenRun());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no-comparable-instrument");
  });
});
