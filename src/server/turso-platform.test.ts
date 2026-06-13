import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

// A real in-memory libsql DB stands in for the platform DB so the ownership
// SELECT runs against actual SQL.
let client: Client;
const db = (() => {
  client = createClient({ url: ":memory:" });
  return drizzle(client);
})();
vi.mock("./db/platform", () => ({ platformDb: db }));

// hasTursoApi() must report configured, and the Turso API client is mocked so
// createToken never hits the network — we only assert WHEN it's called.
const createToken = vi.fn(async () => ({ jwt: "minted.jwt.token" }));
vi.mock("./env", () => ({
  hasTursoApi: () => true,
  serverEnv: { tursoOrg: "org", tursoApiToken: "tok", tursoGroup: "grp" },
}));
vi.mock("@tursodatabase/api", () => ({
  createClient: () => ({ databases: { createToken } }),
}));

beforeAll(async () => {
  await client.execute(
    `CREATE TABLE user_databases (
       user_id TEXT PRIMARY KEY, db_name TEXT NOT NULL, hostname TEXT NOT NULL,
       storage_mode TEXT NOT NULL DEFAULT 'hosted', status TEXT NOT NULL DEFAULT 'active',
       created_at TEXT NOT NULL, delete_after TEXT)`
  );
});
afterAll(() => client.close());
beforeEach(async () => {
  createToken.mockClear();
  await client.execute(`DELETE FROM user_databases`);
  await client.execute({
    sql: `INSERT INTO user_databases (user_id, db_name, hostname, created_at) VALUES (?, ?, ?, ?)`,
    args: ["alice", "tm-alice-abc", "tm-alice-abc.turso.io", "2026-06-13T00:00:00.000Z"],
  });
});

describe("mintDbToken ownership check", () => {
  it("mints a token when the dbName belongs to the user", async () => {
    const { mintDbToken } = await import("./turso-platform");
    const jwt = await mintDbToken("tm-alice-abc", "alice");
    expect(jwt).toBe("minted.jwt.token");
    expect(createToken).toHaveBeenCalledWith("tm-alice-abc", expect.anything());
  });

  it("refuses to mint another user's database (privilege escalation)", async () => {
    const { mintDbToken } = await import("./turso-platform");
    await expect(mintDbToken("tm-alice-abc", "mallory")).rejects.toThrow(/does not belong/i);
    // Crucially, the Turso API is never reached when ownership fails.
    expect(createToken).not.toHaveBeenCalled();
  });

  it("refuses to mint a db the user does not own even with the right userId", async () => {
    const { mintDbToken } = await import("./turso-platform");
    await expect(mintDbToken("tm-someone-else", "alice")).rejects.toThrow(/does not belong/i);
    expect(createToken).not.toHaveBeenCalled();
  });
});
