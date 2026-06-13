import type { DbStatement } from "@/lib/db/types";

/**
 * Bulk-edit primitives for the trades table multi-select. Everything here is
 * pure: selection is a plain reducer and each batch action compiles to a flat
 * list of {@link DbStatement}s run in ONE `db.batch(...)` transaction, so a
 * bulk tag / playbook reassignment / delete either fully applies or fully
 * rolls back — identical across hosted, BYOD and local (sql.js) modes.
 */

/** A bulk action the user can apply to the current selection. */
export type BulkAction =
  | { kind: "addTag"; tagId: string }
  | { kind: "removeTag"; tagId: string }
  | { kind: "setPlaybook"; playbookId: string | null }
  | { kind: "delete" };

// --- selection reducer -----------------------------------------------------

export type SelectionEvent =
  | { type: "toggle"; id: string }
  | { type: "set"; id: string; on: boolean }
  | { type: "selectAll"; ids: string[] }
  | { type: "clear" };

/**
 * Reduces a selection (a Set of trade ids) over a UI event. Returns a NEW Set
 * — never mutates — so React state updates stay referentially honest. `set` is
 * idempotent (toggling on twice keeps one), and `selectAll` replaces the
 * selection with exactly the supplied ids (so it also drops stale ids).
 */
export function selectionReducer(current: Set<string>, event: SelectionEvent): Set<string> {
  switch (event.type) {
    case "toggle": {
      const next = new Set(current);
      if (next.has(event.id)) next.delete(event.id);
      else next.add(event.id);
      return next;
    }
    case "set": {
      const next = new Set(current);
      if (event.on) next.add(event.id);
      else next.delete(event.id);
      return next;
    }
    case "selectAll":
      return new Set(event.ids);
    case "clear":
      return new Set();
  }
}

/** Tri-state for a "select all" header checkbox over a list of visible ids. */
export type SelectAllState = "none" | "some" | "all";

export function selectAllState(selected: Set<string>, visibleIds: string[]): SelectAllState {
  if (visibleIds.length === 0 || selected.size === 0) return "none";
  const inView = visibleIds.filter((id) => selected.has(id)).length;
  if (inView === 0) return "none";
  return inView >= visibleIds.length ? "all" : "some";
}

// --- batch-action → DbStatement compiler -----------------------------------

const now = () => new Date().toISOString();

/**
 * Compiles a {@link BulkAction} over a set of trade ids into the statements
 * that apply it. Order matters for delete (children before parent). De-dupes
 * ids and ignores an empty selection (returns []). The same `updated_at` stamp
 * is applied to every touched trade so a bulk edit reads as one event.
 */
export function buildBulkStatements(action: BulkAction, tradeIds: string[]): DbStatement[] {
  const ids = [...new Set(tradeIds)].filter(Boolean);
  if (ids.length === 0) return [];
  const ts = now();
  const touch = (id: string): DbStatement => ({
    sql: `UPDATE trades SET updated_at = ? WHERE id = ?`,
    args: [ts, id],
  });

  switch (action.kind) {
    case "addTag":
      // INSERT OR IGNORE keeps the (trade_id, tag_id) PK idempotent — re-adding
      // a tag a trade already has is a no-op, never a constraint error.
      return ids.flatMap((id) => [
        {
          sql: `INSERT OR IGNORE INTO trade_tags (trade_id, tag_id) VALUES (?, ?)`,
          args: [id, action.tagId],
        },
        touch(id),
      ]);
    case "removeTag":
      return ids.flatMap((id) => [
        {
          sql: `DELETE FROM trade_tags WHERE trade_id = ? AND tag_id = ?`,
          args: [id, action.tagId],
        },
        touch(id),
      ]);
    case "setPlaybook":
      return ids.map((id) => ({
        sql: `UPDATE trades SET playbook_id = ?, updated_at = ? WHERE id = ?`,
        args: [action.playbookId, ts, id],
      }));
    case "delete":
      // Children first (fills, legs, tags, attachments) then the trade row, so
      // no orphan rows survive even on engines without FK cascade.
      return ids.flatMap((id) => [
        { sql: `DELETE FROM trade_fills WHERE trade_id = ?`, args: [id] },
        { sql: `DELETE FROM trade_legs WHERE trade_id = ?`, args: [id] },
        { sql: `DELETE FROM trade_tags WHERE trade_id = ?`, args: [id] },
        { sql: `DELETE FROM attachments WHERE trade_id = ?`, args: [id] },
        { sql: `DELETE FROM trades WHERE id = ?`, args: [id] },
      ]);
  }
}

/** Human summary for the success toast, e.g. "Tagged 3 trades". */
export function describeBulkResult(action: BulkAction, count: number): string {
  const n = `${count} trade${count === 1 ? "" : "s"}`;
  switch (action.kind) {
    case "addTag":
      return `Tagged ${n}`;
    case "removeTag":
      return `Removed tag from ${n}`;
    case "setPlaybook":
      return action.playbookId ? `Reassigned ${n}` : `Cleared playbook on ${n}`;
    case "delete":
      return `Deleted ${n}`;
  }
}
