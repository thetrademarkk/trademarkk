import { describe, expect, it, vi } from "vitest";
import { LocalDbClient } from "./local";

/**
 * Finding (13) — LocalDbClient must coalesce persistence: a burst of writes
 * should serialize the DB to IndexedDB ONCE (not once per execute()/batch()),
 * and an explicit flush() must force a durable write. These tests drive the
 * real class with a fake sql.js DB + an injected `save` sink (no IndexedDB).
 */

// Minimal stand-in for the sql.js Database surface LocalDbClient uses. Each
// export() returns a fresh byte snapshot so we can assert how many were taken.
function makeFakeDb() {
  let version = 0;
  const exportSpy = vi.fn(() => {
    version += 1;
    return new Uint8Array([version]);
  });
  const db = {
    run: vi.fn(),
    prepare: vi.fn(() => ({
      bind: () => true,
      step: () => false,
      getAsObject: () => ({}),
      free: () => true,
    })),
    getRowsModified: vi.fn(() => 1),
    export: exportSpy,
  };
  return { db, exportSpy };
}

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

describe("LocalDbClient — coalesced persistence (finding 13)", () => {
  it("collapses a burst of writes into ONE export + IDB write", async () => {
    const { db, exportSpy } = makeFakeDb();
    const save = vi.fn(async () => {});
    const client = new LocalDbClient(db as never, { save, debounceMs: 10 });

    // Rapid, un-awaited-on-disk writes (each only schedules persistence).
    await client.execute("INSERT INTO t VALUES (1)");
    await client.execute("INSERT INTO t VALUES (2)");
    await client.batch([{ sql: "INSERT INTO t VALUES (3)" }, { sql: "INSERT INTO t VALUES (4)" }]);

    // Nothing has been serialized yet — the export is debounced.
    expect(exportSpy).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();

    // After the debounce window, a SINGLE export+save covers the whole burst.
    await client.flush();
    expect(exportSpy).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("explicit flush() persists pending writes and resolves when durable", async () => {
    const { db } = makeFakeDb();
    const saved: Uint8Array[] = [];
    const save = vi.fn(async (bytes: Uint8Array) => {
      saved.push(bytes);
    });
    const client = new LocalDbClient(db as never, { save, debounceMs: 10_000 });

    await client.execute("INSERT INTO t VALUES (1)");
    // Debounce is long; only an explicit flush should persist promptly.
    expect(save).not.toHaveBeenCalled();

    await client.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(1);

    // Idempotent: flushing again with nothing dirty does not re-export.
    await client.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("read-only statements never schedule a persist", async () => {
    const { db, exportSpy } = makeFakeDb();
    const save = vi.fn(async () => {});
    const client = new LocalDbClient(db as never, { save, debounceMs: 10 });

    await client.execute("SELECT * FROM t");
    await client.batch([{ sql: "SELECT 1" }, { sql: "PRAGMA user_version" }]);

    await client.flush();
    expect(exportSpy).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("the debounce timer alone flushes a burst (durability without an explicit flush)", async () => {
    const { db, exportSpy } = makeFakeDb();
    const save = vi.fn(async () => {});
    const client = new LocalDbClient(db as never, { save, debounceMs: 5 });

    await client.execute("INSERT INTO t VALUES (1)");
    await client.execute("INSERT INTO t VALUES (2)");
    expect(save).not.toHaveBeenCalled();

    // Wait past the debounce window without calling flush() ourselves.
    await new Promise((r) => setTimeout(r, 20));
    await flushMicrotasks();

    expect(exportSpy).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("a write that lands DURING an in-flight export is re-exported (no dropped write)", async () => {
    const { db, exportSpy } = makeFakeDb();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const save = vi.fn(async () => {
      calls += 1;
      if (calls === 1) await gate; // hold the first export open
    });
    const client = new LocalDbClient(db as never, { save, debounceMs: 5 });

    await client.execute("INSERT INTO t VALUES (1)");
    const firstFlush = client.flush(); // starts export #1, which blocks on `gate`

    // While export #1 is in flight, a new write arrives.
    await client.execute("INSERT INTO t VALUES (2)");

    release(); // let export #1 finish; the loop must re-export for write #2
    await firstFlush;
    await client.flush();

    // Two exports total: the in-flight one plus the re-export covering write #2.
    expect(exportSpy).toHaveBeenCalledTimes(2);
  });
});
