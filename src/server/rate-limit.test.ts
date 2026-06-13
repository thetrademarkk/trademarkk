import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

// A real in-memory libsql DB stands in for the platform DB so the limiter's
// actual UPSERT SQL is exercised (window reset / increment / block-at-limit).
let client: Client;
const db = (() => {
  client = createClient({ url: ":memory:" });
  return drizzle(client);
})();

vi.mock("./db/platform", () => ({ platformDb: db }));

beforeAll(async () => {
  await client.execute(
    `CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, window_start INTEGER NOT NULL DEFAULT 0)`
  );
});

afterAll(() => client.close());

beforeEach(async () => {
  await client.execute(`DELETE FROM rate_limits`);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-13T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rateLimit (DB-backed fixed window)", () => {
  it("allows the first hit and creates the counter row", async () => {
    const { rateLimit } = await import("./rate-limit");
    const res = await rateLimit("k1", 3, 60);
    expect(res.allowed).toBe(true);
    const row = await client.execute({
      sql: `SELECT count, window_start FROM rate_limits WHERE key = ?`,
      args: ["k1"],
    });
    expect(Number(row.rows[0]!.count)).toBe(1);
  });

  it("increments within the window and blocks once the limit is exceeded", async () => {
    const { rateLimit } = await import("./rate-limit");
    expect((await rateLimit("k2", 3, 60)).allowed).toBe(true); // 1
    expect((await rateLimit("k2", 3, 60)).allowed).toBe(true); // 2
    expect((await rateLimit("k2", 3, 60)).allowed).toBe(true); // 3 (== limit)
    expect((await rateLimit("k2", 3, 60)).allowed).toBe(false); // 4 > limit
    expect((await rateLimit("k2", 3, 60)).allowed).toBe(false); // stays blocked
    const row = await client.execute({
      sql: `SELECT count FROM rate_limits WHERE key = ?`,
      args: ["k2"],
    });
    expect(Number(row.rows[0]!.count)).toBe(5);
  });

  it("resets the counter once the window has elapsed", async () => {
    const { rateLimit } = await import("./rate-limit");
    await rateLimit("k3", 2, 60); // 1
    await rateLimit("k3", 2, 60); // 2 (== limit)
    expect((await rateLimit("k3", 2, 60)).allowed).toBe(false); // 3 > limit

    // Advance past the 60s window — the next hit starts a fresh window.
    vi.setSystemTime(new Date("2026-06-13T00:01:01.000Z"));
    expect((await rateLimit("k3", 2, 60)).allowed).toBe(true);
    const row = await client.execute({
      sql: `SELECT count FROM rate_limits WHERE key = ?`,
      args: ["k3"],
    });
    expect(Number(row.rows[0]!.count)).toBe(1);
  });

  it("keeps separate counters per key", async () => {
    const { rateLimit } = await import("./rate-limit");
    expect((await rateLimit("a", 1, 60)).allowed).toBe(true);
    expect((await rateLimit("a", 1, 60)).allowed).toBe(false);
    // A different key is unaffected.
    expect((await rateLimit("b", 1, 60)).allowed).toBe(true);
  });
});
