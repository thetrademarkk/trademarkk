import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as schema from "./db/platform-schema";

// A file-backed temp DB (not :memory:) so deletePostCascade's transaction() —
// which opens its own libsql connection — sees the same tables.
const TMP_DIR = mkdtempSync(join(tmpdir(), "tm-reshare-"));
const DB_FILE = join(TMP_DIR, "reshare.db");

// community.ts imports auth + next/headers at module load — stub them so we can
// exercise the reshare server logic against a REAL in-memory libsql DB (the same
// pattern community-tag-filter.test.ts uses for the tag-filter SQL).
let client: Client;
let db: ReturnType<typeof drizzle<typeof schema>>;

vi.mock("./db/platform", () => ({
  // Proxy so the lazily-bound `db` (assigned in beforeAll) is always current.
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

import { createReshare, deletePostCascade, hydratePosts } from "./community";

// Minimal subset of the platform schema this suite touches.
const DDL = [
  `CREATE TABLE posts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, body TEXT NOT NULL,
    trade_card TEXT, tags TEXT, like_count INTEGER NOT NULL DEFAULT 0, reactions TEXT,
    comment_count INTEGER NOT NULL DEFAULT 0, share_count INTEGER NOT NULL DEFAULT 0,
    reshare_count INTEGER NOT NULL DEFAULT 0, quote_post_id TEXT, sentiment TEXT,
    quality_flag TEXT,
    created_at TEXT NOT NULL, edited_at TEXT, edit_history TEXT
  )`,
  `CREATE TABLE profiles (
    user_id TEXT PRIMARY KEY, username TEXT NOT NULL, display_name TEXT NOT NULL,
    bio TEXT, website TEXT, avatar TEXT, share_streak INTEGER NOT NULL DEFAULT 0,
    streak_current INTEGER NOT NULL DEFAULT 0, streak_best INTEGER NOT NULL DEFAULT 0,
    streak_updated_at TEXT, pinned_post_id TEXT, accent_color TEXT,
    reputation_score INTEGER, reputation_tier TEXT, reputation_computed_at TEXT,
    notification_prefs TEXT, awards TEXT, muted_words TEXT, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE notifications (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, actor_id TEXT NOT NULL, type TEXT NOT NULL,
    post_id TEXT, comment_id TEXT, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE blocks (blocker_id TEXT NOT NULL, blocked_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (blocker_id, blocked_id))`,
  `CREATE TABLE post_symbols (post_id TEXT NOT NULL, symbol TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (post_id, symbol))`,
  `CREATE TABLE post_images (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL)`,
  `CREATE TABLE comments (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL, body TEXT NOT NULL, parent_id TEXT, like_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, edited_at TEXT, edit_history TEXT)`,
  `CREATE TABLE comment_likes (comment_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (comment_id, user_id))`,
  `CREATE TABLE likes (post_id TEXT NOT NULL, user_id TEXT NOT NULL, reaction TEXT, created_at TEXT NOT NULL, PRIMARY KEY (post_id, user_id))`,
  `CREATE TABLE bookmarks (user_id TEXT NOT NULL, post_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (user_id, post_id))`,
  `CREATE TABLE reports (id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL)`,
];

async function seedProfile(userId: string, username: string) {
  await db.run(
    sql`INSERT INTO profiles (user_id, username, display_name, created_at) VALUES (${userId}, ${username}, ${username}, ${"2026-01-01"})`
  );
}
async function seedPost(id: string, userId: string, body: string, quoteOf: string | null = null) {
  await db.run(
    sql`INSERT INTO posts (id, user_id, body, quote_post_id, created_at) VALUES (${id}, ${userId}, ${body}, ${quoteOf}, ${new Date().toISOString()})`
  );
}
const reshareCount = async (id: string) => {
  const r = await db.get<{ n: number }>(sql`SELECT reshare_count AS n FROM posts WHERE id = ${id}`);
  return r?.n ?? -1;
};
const postRow = async (id: string) =>
  db.get<{ id: string; user_id: string; body: string; quote_post_id: string | null }>(
    sql`SELECT id, user_id, body, quote_post_id FROM posts WHERE id = ${id}`
  );

beforeAll(() => {
  client = createClient({ url: `file:${DB_FILE.replace(/\\/g, "/")}` });
  db = drizzle(client, { schema });
});
afterAll(() => {
  client.close();
  // Best-effort: Windows may still hold the file handle right after close().
  try {
    rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    /* OS reaps the temp dir later */
  }
});

beforeEach(async () => {
  for (const t of [
    "posts",
    "profiles",
    "notifications",
    "blocks",
    "post_symbols",
    "post_images",
    "comments",
    "comment_likes",
    "likes",
    "bookmarks",
    "reports",
  ]) {
    await client.execute(`DROP TABLE IF EXISTS ${t}`);
  }
  for (const ddl of DDL) await client.execute(ddl);
  await seedProfile("alice", "alice");
  await seedProfile("bob", "bob");
});

describe("createReshare", () => {
  it("creates a referencing post (empty body) and increments the original's count", async () => {
    await seedPost("p1", "alice", "Original idea");
    const res = await createReshare("bob", "p1", "");
    expect(res).not.toBeNull();
    expect(res!.rootId).toBe("p1");
    expect(res!.quote).toBe(false);

    const reshare = await postRow(res!.id);
    expect(reshare?.user_id).toBe("bob");
    expect(reshare?.quote_post_id).toBe("p1");
    expect(reshare?.body).toBe(""); // plain reshare carries no body
    expect(await reshareCount("p1")).toBe(1);
  });

  it("a quote carries the resharer's commentary as the body", async () => {
    await seedPost("p1", "alice", "Original idea");
    const res = await createReshare("bob", "p1", "  Great call, watching this.  ");
    expect(res!.quote).toBe(true);
    const reshare = await postRow(res!.id);
    expect(reshare?.body).toBe("Great call, watching this."); // trimmed
    expect(reshare?.quote_post_id).toBe("p1");
  });

  it("collapses a reshare-of-a-reshare to the ROOT original", async () => {
    await seedPost("p1", "alice", "Original");
    const first = await createReshare("bob", "p1", "");
    // Carol reshares Bob's reshare → must point at p1, not at the reshare.
    await seedProfile("carol", "carol");
    const second = await createReshare("carol", first!.id, "");
    expect(second!.rootId).toBe("p1");
    const row = await postRow(second!.id);
    expect(row?.quote_post_id).toBe("p1");
    // Root counted twice (Bob + Carol); the intermediate reshare is NOT counted.
    expect(await reshareCount("p1")).toBe(2);
    expect(await reshareCount(first!.id)).toBe(0);
  });

  it("allows resharing your OWN post (and does not self-notify)", async () => {
    await seedPost("p1", "alice", "Mine");
    const res = await createReshare("alice", "p1", "");
    expect(res).not.toBeNull();
    expect(await reshareCount("p1")).toBe(1);
    const notes = await db.all<{ c: number }>(sql`SELECT COUNT(*) AS c FROM notifications`);
    expect(Number(notes[0]?.c ?? 0)).toBe(0); // never notify yourself
  });

  it("notifies the original author with a 'reshare' notification", async () => {
    await seedPost("p1", "alice", "Original");
    await createReshare("bob", "p1", "");
    const note = await db.get<{ user_id: string; actor_id: string; type: string; post_id: string }>(
      sql`SELECT user_id, actor_id, type, post_id FROM notifications LIMIT 1`
    );
    expect(note).toMatchObject({
      user_id: "alice",
      actor_id: "bob",
      type: "reshare",
      post_id: "p1",
    });
  });

  it("returns null for a missing target (no count change, no row)", async () => {
    const res = await createReshare("bob", "does-not-exist", "");
    expect(res).toBeNull();
    const n = await db.all<{ c: number }>(sql`SELECT COUNT(*) AS c FROM posts`);
    expect(Number(n[0]?.c ?? 0)).toBe(0);
  });

  it("refuses to reshare when either side has blocked the other (block-aware both ways)", async () => {
    await seedPost("p1", "alice", "Original");
    // alice blocked bob
    await db.run(
      sql`INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES ('alice','bob','x')`
    );
    expect(await createReshare("bob", "p1", "")).toBeNull();
    expect(await reshareCount("p1")).toBe(0);

    // reverse direction: bob blocked alice
    await db.run(sql`DELETE FROM blocks`);
    await db.run(
      sql`INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES ('bob','alice','x')`
    );
    expect(await createReshare("bob", "p1", "")).toBeNull();
    expect(await reshareCount("p1")).toBe(0);
  });
});

describe("deletePostCascade decrements the reshared original", () => {
  it("removing a reshare drops the original's count back", async () => {
    await seedPost("p1", "alice", "Original");
    const res = await createReshare("bob", "p1", "thoughts");
    expect(await reshareCount("p1")).toBe(1);
    await deletePostCascade(res!.id);
    expect(await reshareCount("p1")).toBe(0);
    const gone = await db.all<{ c: number }>(
      sql`SELECT COUNT(*) AS c FROM posts WHERE id = ${res!.id}`
    );
    expect(Number(gone[0]?.c ?? -1)).toBe(0); // the reshare row is gone
  });

  it("never drives the count below zero", async () => {
    await seedPost("p1", "alice", "Original"); // count starts at 0
    const res = await createReshare("bob", "p1", "");
    // Manually corrupt to 0 then delete → MAX(0, …) guards.
    await db.run(sql`UPDATE posts SET reshare_count = 0 WHERE id = 'p1'`);
    await deletePostCascade(res!.id);
    expect(await reshareCount("p1")).toBe(0);
  });
});

describe("hydratePosts embeds the quoted original", () => {
  const rowFor = async (id: string) => {
    const r = await db.get<Record<string, unknown>>(sql`SELECT * FROM posts WHERE id = ${id}`);
    return {
      id: r!.id as string,
      userId: r!.user_id as string,
      title: (r!.title as string) ?? null,
      body: r!.body as string,
      tradeCard: (r!.trade_card as string) ?? null,
      tags: (r!.tags as string) ?? null,
      likeCount: r!.like_count as number,
      reactions: (r!.reactions as string) ?? null,
      commentCount: r!.comment_count as number,
      shareCount: r!.share_count as number,
      reshareCount: r!.reshare_count as number,
      quotePostId: (r!.quote_post_id as string) ?? null,
      sentiment: (r!.sentiment as string) ?? null,
      createdAt: r!.created_at as string,
      editedAt: (r!.edited_at as string) ?? null,
      editHistory: (r!.edit_history as string) ?? null,
    };
  };

  it("embeds the original (author + snippet) for a reshare", async () => {
    await seedPost("p1", "alice", "The original body text");
    const res = await createReshare("bob", "p1", "my take");
    const view = (await hydratePosts([await rowFor(res!.id)], "bob"))[0]!;
    expect(view.quoted?.unavailable).toBe(false);
    expect(view.quoted?.id).toBe("p1");
    expect(view.quoted?.author.username).toBe("alice");
    expect(view.quoted?.body).toContain("original body");
    expect(view.reshareCount).toBe(0); // the reshare itself has not been reshared
    expect(view.body).toBe("my take");
  });

  it("marks a deleted original as unavailable", async () => {
    await seedPost("p1", "alice", "Original");
    const res = await createReshare("bob", "p1", "");
    await db.run(sql`DELETE FROM posts WHERE id = 'p1'`); // raw delete: original gone
    const view = (await hydratePosts([await rowFor(res!.id)], "bob"))[0]!;
    expect(view.quoted?.unavailable).toBe(true);
  });

  it("hides the embedded original when the viewer blocked its author", async () => {
    await seedPost("p1", "alice", "Original");
    const res = await createReshare("bob", "p1", "");
    // carol views; carol blocked alice
    await seedProfile("carol", "carol");
    await db.run(
      sql`INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES ('carol','alice','x')`
    );
    const view = (await hydratePosts([await rowFor(res!.id)], "carol"))[0]!;
    expect(view.quoted).toBeNull(); // suppressed, not unavailable
  });

  it("a normal post has no quoted field", async () => {
    await seedPost("p1", "alice", "Plain");
    const view = (await hydratePosts([await rowFor("p1")], "alice"))[0]!;
    expect(view.quoted).toBeUndefined();
    expect(view.quotePostId).toBeNull();
  });
});
