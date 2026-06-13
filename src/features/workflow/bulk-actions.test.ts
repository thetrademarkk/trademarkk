import { describe, it, expect } from "vitest";
import {
  selectionReducer,
  selectAllState,
  buildBulkStatements,
  describeBulkResult,
  type BulkAction,
} from "./bulk-actions";

describe("selectionReducer", () => {
  it("toggles an id on then off", () => {
    let s = new Set<string>();
    s = selectionReducer(s, { type: "toggle", id: "a" });
    expect([...s]).toEqual(["a"]);
    s = selectionReducer(s, { type: "toggle", id: "a" });
    expect(s.size).toBe(0);
  });

  it("set is idempotent", () => {
    let s = new Set<string>();
    s = selectionReducer(s, { type: "set", id: "a", on: true });
    s = selectionReducer(s, { type: "set", id: "a", on: true });
    expect([...s]).toEqual(["a"]);
    s = selectionReducer(s, { type: "set", id: "a", on: false });
    expect(s.size).toBe(0);
  });

  it("selectAll replaces with exactly the given ids", () => {
    let s = new Set(["x"]);
    s = selectionReducer(s, { type: "selectAll", ids: ["a", "b"] });
    expect([...s].sort()).toEqual(["a", "b"]);
  });

  it("clear empties the selection", () => {
    const s = selectionReducer(new Set(["a", "b"]), { type: "clear" });
    expect(s.size).toBe(0);
  });

  it("never mutates the input set", () => {
    const orig = new Set(["a"]);
    selectionReducer(orig, { type: "toggle", id: "b" });
    expect([...orig]).toEqual(["a"]);
  });
});

describe("selectAllState", () => {
  const visible = ["a", "b", "c"];
  it("none when nothing selected", () => {
    expect(selectAllState(new Set(), visible)).toBe("none");
  });
  it("some when a subset is selected", () => {
    expect(selectAllState(new Set(["a"]), visible)).toBe("some");
  });
  it("all when every visible id is selected", () => {
    expect(selectAllState(new Set(["a", "b", "c"]), visible)).toBe("all");
  });
  it("none on an empty visible list", () => {
    expect(selectAllState(new Set(["a"]), [])).toBe("none");
  });
  it("ignores selected ids no longer visible (none)", () => {
    expect(selectAllState(new Set(["z"]), visible)).toBe("none");
  });
});

describe("buildBulkStatements", () => {
  it("returns no statements for an empty selection", () => {
    expect(buildBulkStatements({ kind: "delete" }, [])).toEqual([]);
  });

  it("de-dupes ids", () => {
    const stmts = buildBulkStatements({ kind: "setPlaybook", playbookId: "pb1" }, ["a", "a", "b"]);
    expect(stmts).toHaveLength(2);
  });

  it("addTag uses INSERT OR IGNORE and stamps updated_at", () => {
    const stmts = buildBulkStatements({ kind: "addTag", tagId: "t1" }, ["a", "b"]);
    const inserts = stmts.filter((s) => s.sql.includes("INSERT OR IGNORE INTO trade_tags"));
    const touches = stmts.filter((s) => s.sql.includes("UPDATE trades SET updated_at"));
    expect(inserts).toHaveLength(2);
    expect(touches).toHaveLength(2);
    expect(inserts[0]!.args).toEqual(["a", "t1"]);
  });

  it("removeTag scopes the delete to (trade, tag)", () => {
    const stmts = buildBulkStatements({ kind: "removeTag", tagId: "t1" }, ["a"]);
    const del = stmts.find((s) => s.sql.startsWith("DELETE FROM trade_tags"));
    expect(del?.sql).toContain("AND tag_id = ?");
    expect(del?.args).toEqual(["a", "t1"]);
  });

  it("setPlaybook can clear (null) or assign", () => {
    const assign = buildBulkStatements({ kind: "setPlaybook", playbookId: "pb1" }, ["a"]);
    expect(assign[0]!.args?.[0]).toBe("pb1");
    const clear = buildBulkStatements({ kind: "setPlaybook", playbookId: null }, ["a"]);
    expect(clear[0]!.args?.[0]).toBeNull();
  });

  it("delete removes children before the trade row", () => {
    const stmts = buildBulkStatements({ kind: "delete" }, ["a"]);
    const order = stmts.map((s) => s.sql.match(/DELETE FROM (\w+)/)?.[1]);
    expect(order).toEqual(["trade_fills", "trade_legs", "trade_tags", "attachments", "trades"]);
  });

  it("uses a single timestamp across all touched trades", () => {
    const stmts = buildBulkStatements({ kind: "addTag", tagId: "t1" }, ["a", "b", "c"]);
    const stamps = stmts.filter((s) => s.sql.includes("updated_at")).map((s) => s.args?.[0]);
    expect(new Set(stamps).size).toBe(1);
  });
});

describe("describeBulkResult", () => {
  it("pluralizes correctly", () => {
    expect(describeBulkResult({ kind: "addTag", tagId: "t" }, 1)).toBe("Tagged 1 trade");
    expect(describeBulkResult({ kind: "addTag", tagId: "t" }, 3)).toBe("Tagged 3 trades");
  });
  it("distinguishes clear vs reassign playbook", () => {
    const clear = describeBulkResult({ kind: "setPlaybook", playbookId: null } as BulkAction, 2);
    expect(clear).toContain("Cleared");
    const reassign = describeBulkResult({ kind: "setPlaybook", playbookId: "p" } as BulkAction, 2);
    expect(reassign).toContain("Reassigned");
  });
});
