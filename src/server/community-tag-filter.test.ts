import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";

// community.ts pulls in auth + next/headers at import time; stub them so the
// pure escapeLike helper (and its SQL behavior) can be exercised in isolation.
vi.mock("./db/platform", () => ({ platformDb: {} }));
vi.mock("./auth", () => ({ auth: {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { escapeLike } from "./community";

describe("escapeLike", () => {
  it("escapes LIKE metacharacters with a backslash", () => {
    expect(escapeLike("a%b")).toBe("a\\%b");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });
  it("leaves ordinary tag characters untouched", () => {
    expect(escapeLike("banknifty")).toBe("banknifty");
    expect(escapeLike("0dte-setup")).toBe("0dte-setup");
  });
});

// The feed tag filter builds `%"<escapedTag>"%` and matches posts.tags (a JSON
// array string) with `ESCAPE '\'`. Prove that a tag containing `%` matches ONLY
// the literal tag, never broadening into a wildcard scan.
describe("tag LIKE filter is injection-safe", () => {
  let client: Client;
  beforeAll(async () => {
    client = createClient({ url: ":memory:" });
    await client.execute(`CREATE TABLE posts (id TEXT, tags TEXT)`);
    await client.execute(`INSERT INTO posts VALUES ('p1', '["banknifty","scalp"]')`);
    await client.execute(`INSERT INTO posts VALUES ('p2', '["options"]')`);
    await client.execute(`INSERT INTO posts VALUES ('p3', '["a%b"]')`);
  });
  afterAll(() => client.close());

  const matchTag = async (tag: string) => {
    const pattern = `%"${escapeLike(tag)}"%`;
    const res = await client.execute({
      sql: `SELECT id FROM posts WHERE tags LIKE ? ESCAPE '\\' ORDER BY id`,
      args: [pattern],
    });
    return res.rows.map((r) => String(r.id));
  };

  it("matches the exact tag", async () => {
    expect(await matchTag("banknifty")).toEqual(["p1"]);
  });

  it("a '%' tag matches only the literal '%' tag, not every row", async () => {
    // Without escaping, `%"%"%` would match every tagged post. Escaped, it must
    // match only the post whose tag literally contains '%'.
    expect(await matchTag("a%b")).toEqual(["p3"]);
    expect(await matchTag("%")).toEqual([]);
  });

  it("an underscore tag does not act as a single-char wildcard", async () => {
    // `_` would otherwise match any single character.
    expect(await matchTag("optio_s")).toEqual([]);
  });
});
