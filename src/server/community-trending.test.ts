import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as schema from "./db/platform-schema";

// File-backed temp DB so any connection (and the cache passthrough) sees the
// same tables. Mirrors community-reshare.test.ts's harness.
const TMP_DIR = mkdtempSync(join(tmpdir(), "tm-trending-"));
const DB_FILE = join(TMP_DIR, "trending.db");

let client: Client;
let db: ReturnType<typeof drizzle<typeof schema>>;

vi.mock("./db/platform", () => ({
  platformDb: new Proxy(
    {},
    {
      get(_t, prop) {
        return Reflect.get(db, prop, db);
      },
    }
  ),
}));
vi.mock("./auth", () => ({ auth: {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Bypass the in-memory TTL cache so the anonymous board is recomputed every
// call (otherwise a prior test's board would leak into the next assertion).
vi.mock("./cache", () => ({
  cached: <T>(_key: string, _ttl: number, fn: () => Promise<T>) => fn(),
  invalidateCached: () => undefined,
}));

import { queryTrending } from "./community";

const DDL = [
  `CREATE TABLE posts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, body TEXT NOT NULL,
    trade_card TEXT, tags TEXT, like_count INTEGER NOT NULL DEFAULT 0, reactions TEXT,
    comment_count INTEGER NOT NULL DEFAULT 0, share_count INTEGER NOT NULL DEFAULT 0,
    reshare_count INTEGER NOT NULL DEFAULT 0, quote_post_id TEXT,
    created_at TEXT NOT NULL, edited_at TEXT, edit_history TEXT
  )`,
  `CREATE TABLE blocks (blocker_id TEXT NOT NULL, blocked_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (blocker_id, blocked_id))`,
  `CREATE TABLE post_symbols (post_id TEXT NOT NULL, symbol TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (post_id, symbol))`,
];

let seq = 0;
/** Inserts a post `ageHours` old with the given tags + cashtag symbols. */
async function seedPost(
  userId: string,
  opts: { ageHours?: number; tags?: string[]; symbols?: string[] } = {}
) {
  const id = `p${seq++}`;
  const createdAt = new Date(Date.now() - (opts.ageHours ?? 0) * 3_600_000).toISOString();
  const tags = opts.tags && opts.tags.length ? JSON.stringify(opts.tags) : null;
  await db.run(
    sql`INSERT INTO posts (id, user_id, body, tags, created_at) VALUES (${id}, ${userId}, ${"body"}, ${tags}, ${createdAt})`
  );
  for (const s of opts.symbols ?? []) {
    await db.run(
      sql`INSERT INTO post_symbols (post_id, symbol, created_at) VALUES (${id}, ${s.toUpperCase()}, ${createdAt})`
    );
  }
  return id;
}
async function block(blocker: string, blocked: string) {
  await db.run(
    sql`INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (${blocker}, ${blocked}, ${new Date().toISOString()})`
  );
}

beforeAll(() => {
  client = createClient({ url: `file:${DB_FILE.replace(/\\/g, "/")}` });
  db = drizzle(client, { schema });
});
afterAll(() => {
  client.close();
  try {
    rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    /* OS reaps it later */
  }
});
beforeEach(async () => {
  for (const t of ["posts", "blocks", "post_symbols"]) {
    await client.execute(`DROP TABLE IF EXISTS ${t}`);
  }
  for (const ddl of DDL) await client.execute(ddl);
  seq = 0;
});

describe("queryTrending — tickers", () => {
  it("a multi-author ticker trends; a single-author spammed ticker does not", async () => {
    // 3 distinct authors each post once about $NIFTY.
    await seedPost("a", { symbols: ["NIFTY"] });
    await seedPost("b", { symbols: ["NIFTY"] });
    await seedPost("c", { symbols: ["NIFTY"] });
    // 1 author spams $XYZ ten times.
    for (let i = 0; i < 10; i++) await seedPost("spammer", { symbols: ["XYZ"] });

    const board = await queryTrending("24h", null);
    expect(board.tickers.map((t) => t.key)).toEqual(["NIFTY"]);
    expect(board.tickers[0]!.authors).toBe(3);
    // XYZ (10 posts, 1 author) is gated out entirely.
    expect(board.tickers.find((t) => t.key === "XYZ")).toBeUndefined();
  });

  it("excludes posts from authors the viewer has blocked", async () => {
    // bob makes $RELIANCE trend with alice...
    await seedPost("alice", { symbols: ["RELIANCE"] });
    await seedPost("bob", { symbols: ["RELIANCE"] });
    // ...but if the viewer (carol) has blocked bob, only alice's post counts →
    // RELIANCE drops to 1 distinct author and falls below the gate.
    await block("carol", "bob");

    const anon = await queryTrending("24h", null);
    expect(anon.tickers.map((t) => t.key)).toEqual(["RELIANCE"]); // anon sees both

    const blockedView = await queryTrending("24h", "carol");
    expect(blockedView.tickers.find((t) => t.key === "RELIANCE")).toBeUndefined();
  });

  it("respects the window filter (24h excludes a 7d-old post)", async () => {
    await seedPost("a", { symbols: ["INFY"] }); // now
    await seedPost("b", { symbols: ["INFY"], ageHours: 24 * 6 }); // 6 days old

    // 24h window: only one author in-window → gated out.
    const day = await queryTrending("24h", null);
    expect(day.tickers.find((t) => t.key === "INFY")).toBeUndefined();

    // 7d window: both authors in-window → trends.
    const week = await queryTrending("7d", null);
    expect(week.tickers.map((t) => t.key)).toEqual(["INFY"]);
    expect(week.tickers[0]!.authors).toBe(2);
  });
});

describe("queryTrending — topics", () => {
  it("ranks tags by distinct authors, breaking ties by recency-weighted volume", async () => {
    // #setups: 3 distinct authors.
    await seedPost("a", { tags: ["setups"] });
    await seedPost("b", { tags: ["setups"] });
    await seedPost("c", { tags: ["setups"] });
    // #psychology: 2 distinct authors.
    await seedPost("a", { tags: ["psychology"] });
    await seedPost("b", { tags: ["psychology"] });
    // #solo: 1 author → gated.
    await seedPost("a", { tags: ["solo"] });

    const board = await queryTrending("24h", null);
    expect(board.topics.map((t) => t.key)).toEqual(["setups", "psychology"]);
    expect(board.topics.find((t) => t.key === "solo")).toBeUndefined();
  });

  it("counts a post under each of its tags", async () => {
    await seedPost("a", { tags: ["nifty", "options"] });
    await seedPost("b", { tags: ["nifty", "options"] });
    const board = await queryTrending("24h", null);
    const keys = board.topics.map((t) => t.key).sort();
    expect(keys).toEqual(["nifty", "options"]);
  });
});

describe("queryTrending — empty / low-data", () => {
  it("returns empty columns when there's no activity", async () => {
    const board = await queryTrending("24h", null);
    expect(board).toEqual({ window: "24h", tickers: [], topics: [] });
  });

  it("returns empty columns when all activity is single-author (below the gate)", async () => {
    await seedPost("loner", { symbols: ["AAA"], tags: ["bbb"] });
    await seedPost("loner", { symbols: ["AAA"], tags: ["bbb"] });
    const board = await queryTrending("24h", null);
    expect(board.tickers).toEqual([]);
    expect(board.topics).toEqual([]);
  });
});
