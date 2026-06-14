import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";

// community.ts pulls in auth + next/headers at import time; stub them so the pure
// escapeLike helper (and the feed search SQL behavior it now feeds) can be
// exercised in isolation.
vi.mock("./db/platform", () => ({ platformDb: {} }));
vi.mock("./auth", () => ({ auth: {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { escapeLike } from "./community";

// Finding 29: the feed free-text search (?q=) builds `%<escapedQuery>%` and
// matches posts.body / posts.title with `ESCAPE '\'`. Prove that a query
// containing `%` or `_` matches ONLY literally, never broadening into a wildcard
// full-table scan (the pre-fix behavior of `?q=%` matching everything).
describe("feed free-text search LIKE filter is injection-safe", () => {
  let client: Client;
  beforeAll(async () => {
    client = createClient({ url: ":memory:" });
    await client.execute(`CREATE TABLE posts (id TEXT, title TEXT, body TEXT)`);
    await client.execute(`INSERT INTO posts VALUES ('p1', 'BankNifty scalp', 'tight stop')`);
    await client.execute(`INSERT INTO posts VALUES ('p2', 'Options income', 'theta plays')`);
    await client.execute(`INSERT INTO posts VALUES ('p3', '50% gain', 'literal percent in title')`);
  });
  afterAll(() => client.close());

  // Mirrors buildFeedConditions' search clause exactly.
  const matchSearch = async (search: string) => {
    const like = `%${escapeLike(search.slice(0, 60))}%`;
    const res = await client.execute({
      sql: `SELECT id FROM posts WHERE (body LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\') ORDER BY id`,
      args: [like, like],
    });
    return res.rows.map((r) => String(r.id));
  };

  it("matches an ordinary substring across title and body", async () => {
    expect(await matchSearch("scalp")).toEqual(["p1"]);
    expect(await matchSearch("theta")).toEqual(["p2"]);
  });

  it("a bare '%' query matches nothing instead of every row", async () => {
    // Pre-fix, `%%%` matched every post (attacker-controlled full scan). Escaped,
    // it matches only a post literally containing '%'.
    expect(await matchSearch("%")).toEqual(["p3"]);
  });

  it("an underscore does not act as a single-char wildcard", async () => {
    // `_` would otherwise match any single character (e.g. "Optio_s" -> "Options").
    expect(await matchSearch("Optio_s")).toEqual([]);
    expect(await matchSearch("Options")).toEqual(["p2"]);
  });
});
