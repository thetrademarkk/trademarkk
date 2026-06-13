import { describe, expect, it } from "vitest";
import type { DbClient, DbResult, DbStatement } from "@/lib/db/types";
import { computeCharges, computeGrossPnl } from "@/lib/charges/charges";
import { getChargeProfile } from "@/config/brokers";
import type { ImportedFill } from "../brokers/kite-positions";
import {
  buildImportPreview,
  importTrades,
  tradeRowToFormValues,
} from "./positions-import";

const ACCOUNT = "acc-1";
const PROFILE = "zerodha";

function fill(over: Partial<ImportedFill> = {}): ImportedFill {
  return {
    broker: "kite",
    adapterVersion: 1,
    symbol: "INFY",
    exchange: "NSE",
    side: "buy",
    qty: 10,
    price: 1450,
    time: "2026-06-12T05:00:00.000Z",
    ...over,
  };
}

/**
 * A minimal in-memory DbClient: records every statement and answers the
 * `SELECT id FROM trades WHERE id IN (...)` dedupe query from a seeded id set.
 */
function fakeDb(existing: string[] = []) {
  const ids = new Set(existing);
  const executed: { sql: string; args: unknown[] }[] = [];
  const batched: DbStatement[] = [];
  const db: DbClient = {
    async execute(sql, args = []): Promise<DbResult> {
      executed.push({ sql, args });
      if (/SELECT id FROM trades WHERE id IN/.test(sql)) {
        const rows = args.filter((a) => ids.has(String(a))).map((a) => ({ id: String(a) }));
        return { rows, rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 0 };
    },
    async batch(statements): Promise<DbResult[]> {
      batched.push(...statements);
      return statements.map(() => ({ rows: [], rowsAffected: 1 }));
    },
  };
  return { db, executed, batched, ids };
}

describe("buildImportPreview", () => {
  it("pairs a buy+sell round trip into one closed trade with paise-correct charges", async () => {
    const fills = [
      fill({ side: "buy", price: 1450, time: "2026-06-12T05:00:00.000Z" }),
      fill({ side: "sell", price: 1470, time: "2026-06-12T06:00:00.000Z" }),
    ];
    const { db } = fakeDb();
    const preview = await buildImportPreview(fills, ACCOUNT, PROFILE, db);
    expect(preview.trades).toHaveLength(1);
    const t = preview.trades[0]!.trade;
    expect(t.status).toBe("closed");
    expect(t.direction).toBe("long");
    expect(t.qty).toBe(10);
    expect(t.avg_entry).toBe(1450);
    expect(t.avg_exit).toBe(1470);

    // Charges must match the central engine to the paise.
    const profile = getChargeProfile(PROFILE);
    const gross = computeGrossPnl({ direction: "long", qty: 10, entryPrice: 1450, exitPrice: 1470 });
    const charges = computeCharges(profile, {
      segment: "EQ",
      qty: 10,
      entryPrice: 1450,
      exitPrice: 1470,
      direction: "long",
      orders: 2,
    }).total;
    expect(t.gross_pnl).toBe(gross);
    expect(t.charges).toBe(Math.round(charges * 100) / 100);
    expect(t.net_pnl).toBe(Math.round((gross - charges) * 100) / 100);
  });

  it("flags already-journaled trades as existing and new ones as new", async () => {
    const fills = [
      fill({ side: "buy", price: 1450, time: "2026-06-12T05:00:00.000Z" }),
      fill({ side: "sell", price: 1470, time: "2026-06-12T06:00:00.000Z" }),
    ];
    const probe = fakeDb();
    const first = await buildImportPreview(fills, ACCOUNT, PROFILE, probe.db);
    const knownId = first.trades[0]!.id;

    const { db } = fakeDb([knownId]);
    const preview = await buildImportPreview(fills, ACCOUNT, PROFILE, db);
    expect(preview.trades[0]!.existing).toBe(true);
  });

  it("skips fills with no readable time and reports the count", async () => {
    const fills = [
      fill({ side: "buy", time: null }),
      fill({ side: "buy", price: 1455, time: "2026-06-12T05:00:00.000Z" }),
    ];
    const { db } = fakeDb();
    const preview = await buildImportPreview(fills, ACCOUNT, PROFILE, db);
    expect(preview.skippedNoTime).toBe(1);
    // The one timed buy leaves an open position (no exit) → an open trade.
    expect(preview.trades).toHaveLength(1);
    expect(preview.trades[0]!.trade.status).toBe("open");
  });

  it("pairs correctly even when the tradebook is rendered newest-first", async () => {
    // Kite often renders executed orders newest-first; the SELL row precedes
    // its BUY. Without sorting this would mispair as a SHORT with inverted P&L.
    const fills = [
      fill({ side: "sell", price: 1470, time: "2026-06-12T06:00:00.000Z" }),
      fill({ side: "buy", price: 1450, time: "2026-06-12T05:00:00.000Z" }),
    ];
    const { db } = fakeDb();
    const preview = await buildImportPreview(fills, ACCOUNT, PROFILE, db);
    expect(preview.trades).toHaveLength(1);
    const t = preview.trades[0]!.trade;
    expect(t.direction).toBe("long");
    expect(t.avg_entry).toBe(1450);
    expect(t.avg_exit).toBe(1470);
    expect(t.net_pnl).toBeGreaterThan(0);
  });

  it("separates two contracts that share a base symbol", async () => {
    const fills = [
      fill({ symbol: "NIFTY2661924500CE", exchange: "NFO", side: "buy", price: 100, time: "2026-06-12T05:00:00.000Z" }),
      fill({ symbol: "NIFTY2661924500CE", exchange: "NFO", side: "sell", price: 120, time: "2026-06-12T06:00:00.000Z" }),
      fill({ symbol: "NIFTY2661924600CE", exchange: "NFO", side: "buy", price: 80, time: "2026-06-12T05:00:00.000Z" }),
      fill({ symbol: "NIFTY2661924600CE", exchange: "NFO", side: "sell", price: 70, time: "2026-06-12T06:00:00.000Z" }),
    ];
    const { db } = fakeDb();
    const preview = await buildImportPreview(fills, ACCOUNT, PROFILE, db);
    expect(preview.trades).toHaveLength(2);
    const strikes = preview.trades.map((t) => t.trade.strike).sort();
    expect(strikes).toEqual([24500, 24600]);
  });
});

describe("dedupe idempotency", () => {
  it("the same fills produce the same deterministic ids across runs", async () => {
    const fills = [
      fill({ side: "buy", price: 1450, time: "2026-06-12T05:00:00.000Z" }),
      fill({ side: "sell", price: 1470, time: "2026-06-12T06:00:00.000Z" }),
    ];
    const a = await buildImportPreview(fills, ACCOUNT, PROFILE, fakeDb().db);
    const b = await buildImportPreview(fills, ACCOUNT, PROFILE, fakeDb().db);
    expect(a.trades[0]!.id).toBe(b.trades[0]!.id);
  });

  it("a re-import after the trade exists finds everything already-in-journal", async () => {
    const fills = [
      fill({ side: "buy", price: 1450, time: "2026-06-12T05:00:00.000Z" }),
      fill({ side: "sell", price: 1470, time: "2026-06-12T06:00:00.000Z" }),
    ];
    const first = await buildImportPreview(fills, ACCOUNT, PROFILE, fakeDb().db);
    const id = first.trades[0]!.id;
    const reimport = await buildImportPreview(fills, ACCOUNT, PROFILE, fakeDb([id]).db);
    expect(reimport.trades.every((t) => t.existing)).toBe(true);
  });
});

describe("importTrades", () => {
  it("writes one trade row + buy & sell fills through the statement builder", async () => {
    const fills = [
      fill({ side: "buy", price: 1450, time: "2026-06-12T05:00:00.000Z" }),
      fill({ side: "sell", price: 1470, time: "2026-06-12T06:00:00.000Z" }),
    ];
    const probe = fakeDb();
    const preview = await buildImportPreview(fills, ACCOUNT, PROFILE, probe.db);
    const { db, batched } = fakeDb();
    const n = await importTrades(preview.trades, PROFILE, db);
    expect(n).toBe(1);
    const tradeInserts = batched.filter((s) => /INSERT INTO trades/.test(s.sql));
    const fillInserts = batched.filter((s) => /INSERT INTO trade_fills/.test(s.sql));
    expect(tradeInserts).toHaveLength(1);
    expect(fillInserts).toHaveLength(2); // entry + exit fills
    // The deterministic dedupe id is what gets written (idempotent re-import).
    expect(tradeInserts[0]!.args![0]).toBe(preview.trades[0]!.id);
  });

  it("importing nothing writes nothing", async () => {
    const { db, batched } = fakeDb();
    const n = await importTrades([], PROFILE, db);
    expect(n).toBe(0);
    expect(batched).toHaveLength(0);
  });

  it("never re-writes an already-in-journal row (protects user edits from clobber)", async () => {
    const fills = [
      fill({ side: "buy", price: 1450, time: "2026-06-12T05:00:00.000Z" }),
      fill({ side: "sell", price: 1470, time: "2026-06-12T06:00:00.000Z" }),
    ];
    const id = (await buildImportPreview(fills, ACCOUNT, PROFILE, fakeDb().db)).trades[0]!.id;
    // Re-import where the trade already exists → preview marks it existing.
    const { db: existsDb } = fakeDb([id]);
    const preview = await buildImportPreview(fills, ACCOUNT, PROFILE, existsDb);
    expect(preview.trades[0]!.existing).toBe(true);
    // Even if the caller forces the existing row into the selection, it's skipped.
    const { db, batched } = fakeDb([id]);
    const n = await importTrades(preview.trades, PROFILE, db);
    expect(n).toBe(0);
    expect(batched).toHaveLength(0);
  });
});

describe("tradeRowToFormValues", () => {
  it("carries the precomputed charges through as manualCharges for closed trades", async () => {
    const fills = [
      fill({ side: "buy", price: 1450, time: "2026-06-12T05:00:00.000Z" }),
      fill({ side: "sell", price: 1470, time: "2026-06-12T06:00:00.000Z" }),
    ];
    const preview = await buildImportPreview(fills, ACCOUNT, PROFILE, fakeDb().db);
    const values = tradeRowToFormValues(preview.trades[0]!.trade);
    expect(values.manualCharges).toBe(preview.trades[0]!.trade.charges);
    expect(values.segment).toBe("EQ");
    expect(values.direction).toBe("long");
  });

  it("leaves manualCharges undefined for open trades", async () => {
    const fills = [fill({ side: "buy", time: "2026-06-12T05:00:00.000Z" })];
    const preview = await buildImportPreview(fills, ACCOUNT, PROFILE, fakeDb().db);
    const values = tradeRowToFormValues(preview.trades[0]!.trade);
    expect(values.manualCharges).toBeUndefined();
  });
});
