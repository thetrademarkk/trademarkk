import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as schema from "./db/platform-schema";

// A file-backed temp DB (not :memory:) so every libsql connection the server
// code opens sees the same tables — same pattern as community-reshare.test.ts.
const TMP_DIR = mkdtempSync(join(tmpdir(), "tm-events-"));
const DB_FILE = join(TMP_DIR, "events.db");

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

import { ensureActiveEventThreads, getEventThreadForPost, HOUSE_USER_ID } from "./events";

/** Minimal platform-schema subset this suite touches. */
const DDL = [
  // Full user-column set the house-account insert touches (drizzle emits every
  // mapped column, incl. the email-abuse counters) — mirror the platform schema.
  `CREATE TABLE user (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0, image TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, status TEXT,
    last_password_reset_email_at INTEGER,
    password_reset_email_count_today INTEGER NOT NULL DEFAULT 0,
    last_verification_email_at INTEGER,
    verification_email_count_today INTEGER NOT NULL DEFAULT 0,
    last_otp_email_at INTEGER,
    otp_email_count_today INTEGER NOT NULL DEFAULT 0
  )`,
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
    notification_prefs TEXT, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE post_symbols (post_id TEXT NOT NULL, symbol TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (post_id, symbol))`,
  `CREATE TABLE event_threads (
    id TEXT PRIMARY KEY, event_type TEXT NOT NULL, event_date TEXT NOT NULL,
    post_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (event_type, event_date)
  )`,
];

/** IST 10:00 instant for a date key (04:30 UTC). */
const istInstant = (dateKey: string) => new Date(`${dateKey}T04:30:00Z`);

const countRows = async (table: string) => {
  const r = await db.get<{ c: number }>(sql.raw(`SELECT COUNT(*) AS c FROM ${table}`));
  return Number(r?.c ?? 0);
};

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
  for (const t of ["user", "posts", "profiles", "post_symbols", "event_threads"]) {
    await client.execute(`DROP TABLE IF EXISTS ${t}`);
  }
  for (const ddl of DDL) await client.execute(ddl);
});

describe("ensureActiveEventThreads — materialization", () => {
  it("creates a Market Open thread on a normal trading day", async () => {
    const res = await ensureActiveEventThreads(istInstant("2026-06-10")); // Wed
    expect(res.marketClosed).toBe(false);
    expect(res.date).toBe("2026-06-10");
    expect(res.threads.map((t) => t.type)).toEqual(["market-open"]);
    expect(await countRows("event_threads")).toBe(1);
    expect(await countRows("posts")).toBe(1);
    // The thread is authored by the house account.
    const post = await db.get<{ user_id: string }>(
      sql`SELECT user_id FROM posts WHERE id = ${res.threads[0]!.postId}`
    );
    expect(post?.user_id).toBe(HOUSE_USER_ID);
  });

  it("creates BOTH an Expiry Day and a Market Open thread on a NIFTY expiry Thursday", async () => {
    const res = await ensureActiveEventThreads(istInstant("2026-06-11")); // Thu
    expect(res.threads.map((t) => t.type)).toEqual(["expiry-day", "market-open"]);
    expect(await countRows("event_threads")).toBe(2);
    expect(await countRows("posts")).toBe(2);
  });

  it("materializes the house account exactly once (user + profile)", async () => {
    await ensureActiveEventThreads(istInstant("2026-06-10"));
    await ensureActiveEventThreads(istInstant("2026-06-09")); // a different day
    const houseUsers = await db.get<{ c: number }>(
      sql`SELECT COUNT(*) AS c FROM user WHERE id = ${HOUSE_USER_ID}`
    );
    expect(Number(houseUsers?.c)).toBe(1);
    const houseProfiles = await db.get<{ c: number }>(
      sql`SELECT COUNT(*) AS c FROM profiles WHERE user_id = ${HOUSE_USER_ID}`
    );
    expect(Number(houseProfiles?.c)).toBe(1);
  });

  it("is IDEMPOTENT — re-visiting the same day creates NO new rows", async () => {
    const first = await ensureActiveEventThreads(istInstant("2026-06-11"));
    const before = await countRows("posts");
    const second = await ensureActiveEventThreads(istInstant("2026-06-11"));
    // Same post ids, same row counts.
    expect(second.threads.map((t) => t.postId)).toEqual(first.threads.map((t) => t.postId));
    expect(await countRows("posts")).toBe(before);
    expect(await countRows("event_threads")).toBe(2);
  });

  it("DOUBLE-materialization (race) yields exactly ONE row per event", async () => {
    // Fire both visits concurrently — the (event_type,event_date) UNIQUE key +
    // INSERT OR IGNORE must collapse them to a single thread per event, and any
    // losing orphan post must be cleaned up (no duplicate threads in the feed).
    const [a, b] = await Promise.all([
      ensureActiveEventThreads(istInstant("2026-06-11")),
      ensureActiveEventThreads(istInstant("2026-06-11")),
    ]);
    expect(await countRows("event_threads")).toBe(2); // expiry + open, one each
    // Both callers see the SAME winning post id per event type.
    const aByType = new Map(a.threads.map((t) => [t.type, t.postId]));
    const bByType = new Map(b.threads.map((t) => [t.type, t.postId]));
    expect(aByType.get("market-open")).toBe(bByType.get("market-open"));
    expect(aByType.get("expiry-day")).toBe(bByType.get("expiry-day"));
    // No orphan posts: exactly one post per surviving event_threads row.
    const postCount = await countRows("posts");
    const threadCount = await countRows("event_threads");
    expect(postCount).toBe(threadCount);
  });

  it("creates NO threads on a weekend (markets closed)", async () => {
    const res = await ensureActiveEventThreads(istInstant("2026-06-13")); // Sat
    expect(res.marketClosed).toBe(true);
    expect(res.threads).toEqual([]);
    expect(await countRows("event_threads")).toBe(0);
    expect(await countRows("posts")).toBe(0);
    // The house account is NOT even created on a closed day (no work to do).
    expect(await countRows("user")).toBe(0);
  });

  it("creates NO threads on a curated holiday", async () => {
    const res = await ensureActiveEventThreads(istInstant("2026-04-03")); // Good Friday
    expect(res.marketClosed).toBe(true);
    expect(res.threads).toEqual([]);
    expect(await countRows("event_threads")).toBe(0);
  });

  it("indexes index cashtags from the expiry thread body", async () => {
    await ensureActiveEventThreads(istInstant("2026-06-11")); // NIFTY expiry
    // The expiry body names NIFTY — but it uses no $ prefix, so it should not
    // create a cashtag row (we never fabricate $cashtags the body doesn't have).
    expect(await countRows("post_symbols")).toBe(0);
  });
});

describe("getEventThreadForPost", () => {
  it("identifies an auto-created event thread post", async () => {
    const res = await ensureActiveEventThreads(istInstant("2026-06-10"));
    const meta = await getEventThreadForPost(res.threads[0]!.postId);
    expect(meta).toMatchObject({ type: "market-open", date: "2026-06-10" });
  });

  it("returns null for a non-event post", async () => {
    expect(await getEventThreadForPost("not-an-event-post")).toBeNull();
  });
});
