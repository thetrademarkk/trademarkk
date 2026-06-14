import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as schema from "./db/platform-schema";

// File-backed temp DB (not :memory:) so every libsql connection the server code
// opens sees the same tables — same pattern as events-materialize.test.ts.
const TMP_DIR = mkdtempSync(join(tmpdir(), "tm-notif-prefs-"));
const DB_FILE = join(TMP_DIR, "prefs.db");

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

import { getNotificationPrefs, notify, setNotificationPref } from "./community";

// profiles DDL must carry EVERY mapped column (drizzle emits all on insert),
// including the rank-16 reputation cols and the new notification_prefs column.
const DDL = [
  `CREATE TABLE user (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0, image TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, status TEXT,
    last_password_reset_email_at INTEGER,
    password_reset_email_count_today INTEGER NOT NULL DEFAULT 0,
    last_verification_email_at INTEGER,
    verification_email_count_today INTEGER NOT NULL DEFAULT 0,
    last_otp_email_at INTEGER,
    otp_email_count_today INTEGER NOT NULL DEFAULT 0,
    two_factor_enabled INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE profiles (
    user_id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
    bio TEXT, website TEXT, avatar TEXT, share_streak INTEGER NOT NULL DEFAULT 0,
    streak_current INTEGER NOT NULL DEFAULT 0, streak_best INTEGER NOT NULL DEFAULT 0,
    streak_updated_at TEXT, pinned_post_id TEXT, accent_color TEXT,
    reputation_score INTEGER, reputation_tier TEXT, reputation_computed_at TEXT,
    notification_prefs TEXT, awards TEXT, muted_words TEXT, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE notifications (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, actor_id TEXT NOT NULL, type TEXT NOT NULL,
    post_id TEXT, comment_id TEXT, backtest_id TEXT, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  )`,
];

const RECIPIENT = "user-recipient";
const ACTOR = "user-actor";

async function seedProfile(userId: string, username: string) {
  await db.insert(schema.profiles).values({
    userId,
    username,
    displayName: username,
    createdAt: new Date().toISOString(),
  });
}

const notifsOfType = async (type: string) => {
  const r = await db.get<{ c: number }>(
    sql`SELECT COUNT(*) AS c FROM notifications WHERE user_id = ${RECIPIENT} AND type = ${type}`
  );
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
  for (const t of ["user", "profiles", "notifications"]) {
    await client.execute(`DROP TABLE IF EXISTS ${t}`);
  }
  for (const ddl of DDL) await client.execute(ddl);
  await seedProfile(RECIPIENT, "recipient");
  await seedProfile(ACTOR, "actor");
});

describe("notify() respects notification preferences at emit time", () => {
  it("creates BOTH a follow and a reply notification by default (all on)", async () => {
    await notify({ userId: RECIPIENT, actorId: ACTOR, type: "follow" });
    await notify({ userId: RECIPIENT, actorId: ACTOR, type: "reply", postId: "p1" });
    expect(await notifsOfType("follow")).toBe(1);
    expect(await notifsOfType("reply")).toBe(1);
  });

  it("opting out of 'follow' suppresses the follow notification but NOT the reply", async () => {
    await setNotificationPref(RECIPIENT, "recipient", "follow", false);

    await notify({ userId: RECIPIENT, actorId: ACTOR, type: "follow" });
    await notify({ userId: RECIPIENT, actorId: ACTOR, type: "reply", postId: "p1" });

    expect(await notifsOfType("follow")).toBe(0); // suppressed
    expect(await notifsOfType("reply")).toBe(1); // still flows
  });

  it("re-enabling 'follow' lets it flow again", async () => {
    await setNotificationPref(RECIPIENT, "recipient", "follow", false);
    await notify({ userId: RECIPIENT, actorId: ACTOR, type: "follow" });
    expect(await notifsOfType("follow")).toBe(0);

    await setNotificationPref(RECIPIENT, "recipient", "follow", true);
    await notify({ userId: RECIPIENT, actorId: ACTOR, type: "follow" });
    expect(await notifsOfType("follow")).toBe(1);
  });

  it("an unknown/new type defaults ON even when other types are disabled", async () => {
    await setNotificationPref(RECIPIENT, "recipient", "follow", false);
    await notify({ userId: RECIPIENT, actorId: ACTOR, type: "backtest_done", postId: "p1" });
    expect(await notifsOfType("backtest_done")).toBe(1);
  });

  it("a moderation (bypass) type is delivered regardless of prefs", async () => {
    // Even though there is no pref to disable it, this proves the bypass path
    // does not even read prefs and always inserts.
    await notify({ userId: RECIPIENT, actorId: ACTOR, type: "moderation", postId: "p1" });
    expect(await notifsOfType("moderation")).toBe(1);
  });

  it("persists prefs compactly and reads them back", async () => {
    await setNotificationPref(RECIPIENT, "recipient", "like", false);
    const prefs = await getNotificationPrefs(RECIPIENT, "recipient");
    expect(prefs).toEqual({ like: false });
    const stored = await db.get<{ notification_prefs: string | null }>(
      sql`SELECT notification_prefs FROM profiles WHERE user_id = ${RECIPIENT}`
    );
    expect(stored?.notification_prefs).toBe('{"like":false}');

    // Re-enabling clears the column entirely (back to all-on, no row residue).
    await setNotificationPref(RECIPIENT, "recipient", "like", true);
    const cleared = await db.get<{ notification_prefs: string | null }>(
      sql`SELECT notification_prefs FROM profiles WHERE user_id = ${RECIPIENT}`
    );
    expect(cleared?.notification_prefs).toBeNull();
  });

  it("does NOT affect pre-existing notifications when a type is later disabled", async () => {
    // A like notification created BEFORE opting out stays in the stream.
    await notify({ userId: RECIPIENT, actorId: ACTOR, type: "like", postId: "p1" });
    expect(await notifsOfType("like")).toBe(1);
    await setNotificationPref(RECIPIENT, "recipient", "like", false);
    // The historical row is untouched; only future likes are suppressed.
    expect(await notifsOfType("like")).toBe(1);
    await notify({ userId: RECIPIENT, actorId: ACTOR, type: "like", postId: "p2" });
    expect(await notifsOfType("like")).toBe(1);
  });
});
