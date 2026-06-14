import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as schema from "./db/platform-schema";

// File-backed temp DB so every libsql connection the server opens sees the same
// tables (same pattern as community-reshare / notification-prefs tests).
const TMP_DIR = mkdtempSync(join(tmpdir(), "tm-muted-words-"));
const DB_FILE = join(TMP_DIR, "muted.db");

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

import { addMutedWord, getMutedWords, queryFeed, removeMutedWord } from "./community";
import type { FeedQuery } from "./community";

// profiles DDL must carry EVERY mapped column (drizzle emits all on insert).
const DDL = [
  `CREATE TABLE posts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, body TEXT NOT NULL,
    trade_card TEXT, tags TEXT, like_count INTEGER NOT NULL DEFAULT 0, reactions TEXT,
    comment_count INTEGER NOT NULL DEFAULT 0, share_count INTEGER NOT NULL DEFAULT 0,
    reshare_count INTEGER NOT NULL DEFAULT 0, quote_post_id TEXT, sentiment TEXT,
    quality_flag TEXT, created_at TEXT NOT NULL, edited_at TEXT, edit_history TEXT
  )`,
  `CREATE TABLE profiles (
    user_id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
    bio TEXT, website TEXT, avatar TEXT, share_streak INTEGER NOT NULL DEFAULT 0,
    streak_current INTEGER NOT NULL DEFAULT 0, streak_best INTEGER NOT NULL DEFAULT 0,
    streak_updated_at TEXT, pinned_post_id TEXT, accent_color TEXT,
    reputation_score INTEGER, reputation_tier TEXT, reputation_computed_at TEXT,
    notification_prefs TEXT, awards TEXT, muted_words TEXT, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE blocks (blocker_id TEXT NOT NULL, blocked_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (blocker_id, blocked_id))`,
  `CREATE TABLE post_symbols (post_id TEXT NOT NULL, symbol TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (post_id, symbol))`,
  `CREATE TABLE post_images (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL)`,
  `CREATE TABLE likes (post_id TEXT NOT NULL, user_id TEXT NOT NULL, reaction TEXT, created_at TEXT NOT NULL, PRIMARY KEY (post_id, user_id))`,
  `CREATE TABLE bookmarks (user_id TEXT NOT NULL, post_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (user_id, post_id))`,
  `CREATE TABLE follows (follower_id TEXT NOT NULL, following_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (follower_id, following_id))`,
  `CREATE TABLE followed_tags (user_id TEXT NOT NULL, tag TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (user_id, tag))`,
  `CREATE TABLE watched_symbols (user_id TEXT NOT NULL, symbol TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (user_id, symbol))`,
];

const MUTER = "user-muter";
const OTHER = "user-other";
const AUTHOR = "user-author";

async function seedProfile(userId: string, username: string) {
  await db.run(
    sql`INSERT INTO profiles (user_id, username, display_name, created_at) VALUES (${userId}, ${username}, ${username}, ${"2026-01-01"})`
  );
}
let clock = Date.parse("2026-06-14T08:00:00.000Z");
async function seedPost(
  id: string,
  userId: string,
  body: string,
  opts: { title?: string; tags?: string[]; symbols?: string[] } = {}
) {
  // Monotonic descending createdAt by insertion so order is deterministic.
  clock += 1000;
  const createdAt = new Date(clock).toISOString();
  await db.run(
    sql`INSERT INTO posts (id, user_id, title, body, tags, created_at) VALUES (${id}, ${userId}, ${opts.title ?? null}, ${body}, ${opts.tags ? JSON.stringify(opts.tags) : null}, ${createdAt})`
  );
  for (const s of opts.symbols ?? []) {
    await db.run(
      sql`INSERT INTO post_symbols (post_id, symbol, created_at) VALUES (${id}, ${s}, ${createdAt})`
    );
  }
}

const LATEST: FeedQuery = { sort: "latest", cursor: null, tag: null, scope: "all" };

beforeAll(() => {
  client = createClient({ url: `file:${DB_FILE.replace(/\\/g, "/")}` });
  db = drizzle(client, { schema });
});
afterAll(() => {
  client.close();
  try {
    rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    /* OS reaps later */
  }
});
beforeEach(async () => {
  for (const t of [
    "posts",
    "profiles",
    "blocks",
    "post_symbols",
    "post_images",
    "likes",
    "bookmarks",
    "follows",
    "followed_tags",
    "watched_symbols",
  ]) {
    await client.execute(`DROP TABLE IF EXISTS ${t}`);
  }
  for (const ddl of DDL) await client.execute(ddl);
  await seedProfile(MUTER, "muter");
  await seedProfile(OTHER, "other");
  await seedProfile(AUTHOR, "author");
  clock = Date.parse("2026-06-14T08:00:00.000Z");
});

const ids = (r: { posts: { id: string }[] }) => r.posts.map((p) => p.id);

describe("muted words — feed enforcement", () => {
  it("hides a matching post from the MUTER but not from another user; author still sees own", async () => {
    await seedPost("p1", AUTHOR, "This looks like a total scam to me");
    await seedPost("p2", AUTHOR, "A perfectly normal trade idea");

    await addMutedWord(MUTER, "muter", { term: "scam", mode: "substring" });

    // Muter: p1 hidden, p2 visible.
    const muterFeed = await queryFeed(LATEST, MUTER);
    expect(ids(muterFeed)).toEqual(["p2"]);

    // Another user with no mutes: sees both.
    const otherFeed = await queryFeed(LATEST, OTHER);
    expect(ids(otherFeed).sort()).toEqual(["p1", "p2"]);

    // The author of the muting term sees their own posts even if they'd match.
    await seedPost("p3", MUTER, "honestly a scam free zone, my own post");
    const ownFeed = await queryFeed(LATEST, MUTER);
    expect(ids(ownFeed)).toContain("p3"); // never hides the viewer's own post
  });

  it("whole-word mode does NOT hide a substring (asset vs ass)", async () => {
    await seedPost("p1", AUTHOR, "I bought a great asset today");
    await seedPost("p2", AUTHOR, "what an ass move that was");

    await addMutedWord(MUTER, "muter", { term: "ass", mode: "word" });

    const feed = await queryFeed(LATEST, MUTER);
    // p1 (asset) stays; p2 (whole-word "ass") is hidden.
    expect(ids(feed)).toEqual(["p1"]);
  });

  it("substring mode is blunter and hides the larger word too", async () => {
    await seedPost("p1", AUTHOR, "I bought a great asset today");
    await addMutedWord(MUTER, "muter", { term: "ass", mode: "substring" });
    const feed = await queryFeed(LATEST, MUTER);
    expect(ids(feed)).toEqual([]); // "asset" contains "ass"
  });

  it("cashtag mute hides a post via the post_symbols join (not just inline text)", async () => {
    await seedPost("p1", AUTHOR, "thoughts on the market", { symbols: ["RELIANCE"] });
    await seedPost("p2", AUTHOR, "thoughts on the index", { symbols: ["NIFTY"] });

    await addMutedWord(MUTER, "muter", { term: "$RELIANCE", mode: "cashtag" });

    const feed = await queryFeed(LATEST, MUTER);
    expect(ids(feed)).toEqual(["p2"]); // RELIANCE-tagged post hidden, boundary-safe
  });

  it("removing the mute makes the post reappear", async () => {
    await seedPost("p1", AUTHOR, "this is a scam");
    await addMutedWord(MUTER, "muter", { term: "scam", mode: "substring" });
    expect(ids(await queryFeed(LATEST, MUTER))).toEqual([]);

    await removeMutedWord(MUTER, "muter", "substring", "scam");
    expect(ids(await queryFeed(LATEST, MUTER))).toEqual(["p1"]);
  });

  it("no mutes = no behaviour change (signed-out and mute-free see everything)", async () => {
    await seedPost("p1", AUTHOR, "this is a scam");
    await seedPost("p2", AUTHOR, "a normal post");
    expect(ids(await queryFeed(LATEST, null)).sort()).toEqual(["p1", "p2"]);
    expect(ids(await queryFeed(LATEST, MUTER)).sort()).toEqual(["p1", "p2"]);
  });

  it("pagination tops up so a full page is returned despite muted rows", async () => {
    // 6 posts, every other one matches the mute. With a page limit of 2, the
    // top-up must dig deeper so the first page still returns 2 KEPT posts.
    await seedPost("k1", AUTHOR, "keep one");
    await seedPost("m1", AUTHOR, "hide spam one");
    await seedPost("k2", AUTHOR, "keep two");
    await seedPost("m2", AUTHOR, "hide spam two");
    await seedPost("k3", AUTHOR, "keep three");
    await seedPost("m3", AUTHOR, "hide spam three");

    await addMutedWord(MUTER, "muter", { term: "spam", mode: "substring" });

    const page1 = await queryFeed({ ...LATEST, limit: 2 }, MUTER);
    // Newest-first kept order: k3, k2, k1 → page of 2 = [k3, k2], more remains.
    expect(ids(page1)).toEqual(["k3", "k2"]);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await queryFeed({ ...LATEST, limit: 2, cursor: page1.nextCursor }, MUTER);
    expect(ids(page2)).toEqual(["k1"]);
    expect(page2.nextCursor).toBeNull(); // no kept posts remain
  });

  it("an expired mute does not hide the post", async () => {
    await seedPost("p1", AUTHOR, "this is a scam");
    // expires 1ms in the past relative to the matcher's now (Date.now()).
    await addMutedWord(MUTER, "muter", {
      term: "scam",
      mode: "substring",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const feed = await queryFeed(LATEST, MUTER);
    expect(ids(feed)).toEqual(["p1"]); // expired → inert
  });
});

describe("muted words — storage round-trip", () => {
  it("persists and reads back a sanitized entry", async () => {
    await addMutedWord(MUTER, "muter", { term: "$reliance", mode: "cashtag" });
    const entries = await getMutedWords(MUTER, "muter");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.term).toBe("RELIANCE"); // normalized + uppercased
    expect(entries[0]!.mode).toBe("cashtag");
  });

  it("re-adding the same term de-dupes (idempotent)", async () => {
    await addMutedWord(MUTER, "muter", { term: "scam", mode: "substring" });
    await addMutedWord(MUTER, "muter", { term: "Scam", mode: "substring" });
    expect(await getMutedWords(MUTER, "muter")).toHaveLength(1);
  });
});
