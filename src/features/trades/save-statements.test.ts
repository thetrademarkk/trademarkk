import { describe, expect, it } from "vitest";
import { buildTradeSaveStatements } from "./save-statements";
import type { TradeFormValues } from "./schemas";

const base: TradeFormValues = {
  accountId: "acc1",
  symbol: "banknifty",
  segment: "OPT",
  expiry: "2026-06-26",
  strike: 52000,
  optionType: "CE",
  direction: "long",
  qty: 30,
  avgEntry: 120,
  avgExit: 150,
  openedAt: "2026-06-12T10:15",
  closedAt: "2026-06-12T11:00",
  tagIds: [],
};

const insertOf = (stmts: { sql: string; args?: unknown[] }[], table: string) =>
  stmts.filter((s) => s.sql.includes(`INSERT INTO ${table}`));

describe("buildTradeSaveStatements", () => {
  it("closed single-leg trade → trades row + entry/exit fills, no legs rows", () => {
    const { id, statements } = buildTradeSaveStatements(base, "zerodha");
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // ULID
    const trades = insertOf(statements, "trades");
    expect(trades).toHaveLength(1);
    const args = trades[0]!.args!;
    expect(args[0]).toBe(id);
    expect(args[2]).toBe("BANKNIFTY"); // uppercased symbol
    expect(args[9]).toBe("closed");
    expect(args[10]).toBe(30);
    expect(args[11]).toBe(120);
    expect(args[12]).toBe(150);
    // net = gross - charges; gross = (150-120)*30 = 900, charges > 0 → net < 900
    const gross = Number(args[18]);
    const charges = Number(args[19]);
    const net = Number(args[20]);
    expect(gross).toBe(900);
    expect(charges).toBeGreaterThan(0);
    expect(net).toBeCloseTo(gross - charges, 2);
    // paise precision: at most 2 decimals survive the rounding
    expect(Math.round(net * 100) / 100).toBe(net);
    const fills = insertOf(statements, "trade_fills");
    expect(fills).toHaveLength(2);
    expect(fills[0]!.args![2]).toBe("buy");
    expect(fills[1]!.args![2]).toBe("sell");
    expect(insertOf(statements, "trade_legs")).toHaveLength(0);
    expect(statements.some((s) => s.sql.startsWith("DELETE"))).toBe(false);
  });

  it("no exit → open trade with zeroed P&L and a single fill", () => {
    const { statements } = buildTradeSaveStatements({ ...base, avgExit: undefined }, "zerodha");
    const args = insertOf(statements, "trades")[0]!.args!;
    expect(args[9]).toBe("open");
    expect(args[12]).toBeNull(); // avg_exit
    expect(args[17]).toBeNull(); // closed_at
    expect(args[18]).toBe(0);
    expect(args[20]).toBe(0);
    expect(insertOf(statements, "trade_fills")).toHaveLength(1);
  });

  it("edit replaces: deletes fills/legs/tags/trade before re-inserting under the same id", () => {
    const { id, statements } = buildTradeSaveStatements(base, "zerodha", "existing-id");
    expect(id).toBe("existing-id");
    const deletes = statements.filter((s) => s.sql.startsWith("DELETE"));
    expect(deletes.map((s) => s.sql)).toEqual([
      "DELETE FROM trade_fills WHERE trade_id = ?",
      "DELETE FROM trade_legs WHERE trade_id = ?",
      "DELETE FROM trade_tags WHERE trade_id = ?",
      "DELETE FROM trades WHERE id = ?",
    ]);
    // Deletes come before the insert.
    const firstInsert = statements.findIndex((s) => s.sql.includes("INSERT INTO trades"));
    expect(firstInsert).toBe(4);
  });

  it("multi-leg trade also writes trade_legs rows", () => {
    const { statements } = buildTradeSaveStatements(
      {
        ...base,
        extraLegs: [
          {
            strike: 52000,
            optionType: "PE",
            direction: "short",
            qty: 30,
            avgEntry: 110,
            avgExit: 90,
          },
        ],
      },
      "zerodha"
    );
    expect(insertOf(statements, "trade_legs")).toHaveLength(2);
    expect(insertOf(statements, "trade_fills")).toHaveLength(4);
  });

  it("tags become INSERT OR IGNORE junction rows", () => {
    const { id, statements } = buildTradeSaveStatements(
      { ...base, tagIds: ["t1", "t2"] },
      "zerodha"
    );
    const tagStmts = statements.filter(
      (s) => s.sql.includes("trade_tags") && !s.sql.startsWith("DELETE")
    );
    expect(tagStmts).toHaveLength(2);
    expect(tagStmts[0]!.args).toEqual([id, "t1"]);
  });
});
