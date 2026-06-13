import { newId } from "@/lib/id";
import type { DbStatement, DbValue } from "@/lib/db/types";
import type { TradeFormValues } from "./schemas";
import { allLegs, deriveTradeNumbers, localInputToIso } from "./utils";

/**
 * Builds all statements to persist a trade (insert or full replace on edit).
 *
 * Pure (no DbClient): shared by the web client AND the browser extension so a
 * trade logged from either surface is byte-identical — same ULID ids, fills,
 * paise-rounded charges, status derivation and timestamps.
 */
export function buildTradeSaveStatements(
  values: TradeFormValues,
  chargeProfileId: string,
  existingId?: string
): { id: string; statements: DbStatement[] } {
  const d = deriveTradeNumbers(values, chargeProfileId);
  const id = existingId ?? newId();
  const ts = new Date().toISOString();
  const openedIso = localInputToIso(values.openedAt);
  // Closed only when every leg has exited (single-leg trades: leg 1).
  const closedIso =
    d.status === "closed" ? localInputToIso(values.closedAt || values.openedAt) : null;

  const statements: DbStatement[] = [];
  // New trades default to MIS when the form leaves product unset (see SEG-08:
  // onboarding will set a per-user default later). MIS keeps charges identical
  // to the pre-v4 intraday-equity behaviour.
  const product = values.product ?? "MIS";
  const row: DbValue[] = [
    id,
    values.accountId,
    values.symbol.trim().toUpperCase(),
    "NSE",
    values.segment,
    product,
    values.expiry || null,
    values.strike ?? null,
    values.optionType ?? null,
    values.direction,
    d.status,
    values.qty,
    values.avgEntry,
    values.avgExit ?? null,
    values.plannedEntry ?? null,
    values.plannedSl ?? null,
    values.plannedTarget ?? null,
    openedIso,
    closedIso,
    d.gross,
    d.charges,
    d.net,
    d.r,
    values.playbookId || null,
    values.confidence ?? null,
    values.notes || null,
    ts,
    ts,
  ];

  if (existingId) {
    statements.push(
      { sql: `DELETE FROM trade_fills WHERE trade_id = ?`, args: [id] },
      { sql: `DELETE FROM trade_legs WHERE trade_id = ?`, args: [id] },
      { sql: `DELETE FROM trade_tags WHERE trade_id = ?`, args: [id] },
      { sql: `DELETE FROM trades WHERE id = ?`, args: [id] }
    );
  }
  statements.push({
    sql: `INSERT INTO trades (id, account_id, symbol, exchange, segment, product, expiry, strike, option_type, direction, status, qty, avg_entry, avg_exit, planned_entry, planned_sl, planned_target, opened_at, closed_at, gross_pnl, charges, net_pnl, r_multiple, playbook_id, confidence, notes, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: row,
  });
  // Each strategy leg → entry/exit fills + (for multi-leg trades) a legs row.
  const legs = allLegs(values);
  for (const [i, leg] of legs.entries()) {
    statements.push({
      sql: `INSERT INTO trade_fills (id, trade_id, side, qty, price, fill_time) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        newId(),
        id,
        leg.direction === "long" ? "buy" : "sell",
        leg.qty,
        leg.avgEntry,
        openedIso,
      ],
    });
    if (leg.avgExit != null) {
      statements.push({
        sql: `INSERT INTO trade_fills (id, trade_id, side, qty, price, fill_time) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          newId(),
          id,
          leg.direction === "long" ? "sell" : "buy",
          leg.qty,
          leg.avgExit,
          closedIso ?? openedIso,
        ],
      });
    }
    if (legs.length > 1) {
      statements.push({
        sql: `INSERT INTO trade_legs (id, trade_id, leg_no, strike, option_type, direction, qty, avg_entry, avg_exit)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          newId(),
          id,
          i + 1,
          leg.strike ?? null,
          leg.optionType ?? null,
          leg.direction,
          leg.qty,
          leg.avgEntry,
          leg.avgExit ?? null,
        ],
      });
    }
  }
  for (const tagId of values.tagIds) {
    statements.push({
      sql: `INSERT OR IGNORE INTO trade_tags (trade_id, tag_id) VALUES (?, ?)`,
      args: [id, tagId],
    });
  }
  return { id, statements };
}
