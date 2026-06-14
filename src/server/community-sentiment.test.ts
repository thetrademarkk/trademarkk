import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as schema from "./db/platform-schema";

// File-backed temp DB so any connection (and the cache passthrough) sees the
// same tables. Mirrors community-trending.test.ts's harness.
const TMP_DIR = mkdtempSync(join(tmpdir(), "tm-sentiment-"));
const DB_FILE = join(TMP_DIR, "sentiment.db");

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
// Bypass the in-memory TTL cache so the anonymous gauge is recomputed every call
// (otherwise a prior test's gauge would leak into the next assertion).
vi.mock("./cache", () => ({
  cached: <T>(_key: string, _ttl: number, fn: () => Promise<T>) => fn(),
  invalidateCached: () => undefined,
}));

import { querySymbolSentiment } from "./community";

const DDL = [
  `CREATE TABLE posts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, body TEXT NOT NULL,
    trade_card TEXT, tags TEXT, like_count INTEGER NOT NULL DEFAULT 0, reactions TEXT,
    comment_count INTEGER NOT NULL DEFAULT 0, share_count INTEGER NOT NULL DEFAULT 0,
    reshare_count INTEGER NOT NULL DEFAULT 0, quote_post_id TEXT, sentiment TEXT,
    created_at TEXT NOT NULL, edited_at TEXT, edit_history TEXT
  )`,
  `CREATE TABLE blocks (blocker_id TEXT NOT NULL, blocked_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (blocker_id, blocked_id))`,
  `CREATE TABLE post_symbols (post_id TEXT NOT NULL, symbol TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (post_id, symbol))`,
];

let seq = 0;
/** Inserts a post `ageHours` old with a sentiment, tagging the given symbol. */
async function seedSentimentPost(
  userId: string,
  symbol: string,
  sentiment: "bull" | "bear" | null,
  ageHours = 0
) {
  const id = `p${seq++}`;
  const createdAt = new Date(Date.now() - ageHours * 3_600_000).toISOString();
  await db.run(
    sql`INSERT INTO posts (id, user_id, body, sentiment, created_at)
        VALUES (${id}, ${userId}, ${"body"}, ${sentiment}, ${createdAt})`
  );
  await db.run(
    sql`INSERT INTO post_symbols (post_id, symbol, created_at)
        VALUES (${id}, ${symbol.toUpperCase()}, ${createdAt})`
  );
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

describe("querySymbolSentiment — aggregation + gate", () => {
  it("computes the bull/bear split among tagged, sentiment-bearing posts", async () => {
    // 2 bull + 1 bear on $NIFTY → 67% bullish, gate cleared (3 >= 3).
    await seedSentimentPost("a", "NIFTY", "bull");
    await seedSentimentPost("b", "NIFTY", "bull");
    await seedSentimentPost("c", "NIFTY", "bear");

    const g = await querySymbolSentiment("NIFTY", "24h", null);
    expect(g.bull).toBe(2);
    expect(g.bear).toBe(1);
    expect(g.total).toBe(3);
    expect(g.bullPct).toBe(67);
    expect(g.bearPct).toBe(33);
    expect(g.hasSignal).toBe(true);
  });

  it("ignores posts that tagged the symbol but set NO sentiment", async () => {
    await seedSentimentPost("a", "NIFTY", "bull");
    await seedSentimentPost("b", "NIFTY", "bull");
    await seedSentimentPost("c", "NIFTY", null); // neutral — excluded
    await seedSentimentPost("d", "NIFTY", null); // neutral — excluded

    const g = await querySymbolSentiment("NIFTY", "24h", null);
    expect(g.total).toBe(2); // only the two bull posts count
    expect(g.hasSignal).toBe(false); // 2 < min sample of 3
  });

  it("withholds the signal below the minimum sample", async () => {
    await seedSentimentPost("a", "INFY", "bull");
    await seedSentimentPost("b", "INFY", "bear");
    const g = await querySymbolSentiment("INFY", "24h", null);
    expect(g.total).toBe(2);
    expect(g.hasSignal).toBe(false);
  });

  it("only counts the queried symbol's posts", async () => {
    await seedSentimentPost("a", "NIFTY", "bull");
    await seedSentimentPost("b", "RELIANCE", "bear");
    await seedSentimentPost("c", "RELIANCE", "bear");
    const g = await querySymbolSentiment("NIFTY", "24h", null);
    expect(g.total).toBe(1);
    expect(g.bull).toBe(1);
  });
});

describe("querySymbolSentiment — window filter", () => {
  it("a 24h window excludes a 7d-old post; a 7d window includes it", async () => {
    await seedSentimentPost("a", "TCS", "bull"); // now
    await seedSentimentPost("b", "TCS", "bull"); // now
    await seedSentimentPost("c", "TCS", "bear", 24 * 6); // 6 days old

    const day = await querySymbolSentiment("TCS", "24h", null);
    expect(day.total).toBe(2); // the 6-day-old bear is out of the 24h window

    const week = await querySymbolSentiment("TCS", "7d", null);
    expect(week.total).toBe(3); // all three in the 7d window
    expect(week.bull).toBe(2);
    expect(week.bear).toBe(1);
  });
});

describe("querySymbolSentiment — block-aware", () => {
  it("excludes posts from authors the viewer has blocked", async () => {
    // 2 bull (alice, bob) + 1 bear (mallory) → anon sees 67% bull, 3 posts.
    await seedSentimentPost("alice", "HDFC", "bull");
    await seedSentimentPost("bob", "HDFC", "bull");
    await seedSentimentPost("mallory", "HDFC", "bear");
    await block("carol", "mallory");

    const anon = await querySymbolSentiment("HDFC", "24h", null);
    expect(anon.total).toBe(3);
    expect(anon.bear).toBe(1);

    // carol blocked mallory → her bear vanishes; only the 2 bull posts remain,
    // which drops below the gate (2 < 3).
    const carol = await querySymbolSentiment("HDFC", "24h", "carol");
    expect(carol.total).toBe(2);
    expect(carol.bear).toBe(0);
    expect(carol.hasSignal).toBe(false);
  });
});

describe("querySymbolSentiment — empty / low-data", () => {
  it("returns an empty no-signal gauge when there's no activity", async () => {
    const g = await querySymbolSentiment("ZZZZ", "24h", null);
    expect(g).toEqual({ bull: 0, bear: 0, total: 0, bullPct: 0, bearPct: 0, hasSignal: false });
  });
});
