import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as schema from "./db/platform-schema";

// File-backed temp DB so every libsql connection the server code opens sees the
// same tables — same pattern as notification-prefs / muted-words tests.
const TMP_DIR = mkdtempSync(join(tmpdir(), "tm-dm-v2-"));
const DB_FILE = join(TMP_DIR, "dm.db");

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

import {
  canonicalPair,
  conversationState,
  getConversationForUser,
  isBlockedEitherWay,
  markThreadRead,
  peerId,
  setTyping,
  toMessageView,
} from "./dm";
import { countUnread, deliveryState, isTyping } from "@/features/community/dm-v2";

const DDL = [
  `CREATE TABLE conversations (
    id TEXT PRIMARY KEY, user_a TEXT NOT NULL, user_b TEXT NOT NULL,
    created_at TEXT NOT NULL, last_message_at TEXT NOT NULL,
    last_read_a TEXT, last_read_b TEXT, last_seen_a TEXT, last_seen_b TEXT,
    typing_a TEXT, typing_b TEXT, UNIQUE (user_a, user_b)
  )`,
  `CREATE TABLE dm_messages (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sender_id TEXT NOT NULL,
    body TEXT NOT NULL, created_at TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0,
    reactions TEXT, edited_at TEXT, edit_history TEXT, deleted_at TEXT
  )`,
  `CREATE TABLE blocks (
    blocker_id TEXT NOT NULL, blocked_id TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id)
  )`,
];

// userA < userB canonically: alice < bob.
const ALICE = "alice";
const BOB = "bob";
const CONVO = "convo-1";

async function seedConversation() {
  const [a, b] = canonicalPair(ALICE, BOB);
  expect([a, b]).toEqual([ALICE, BOB]); // sanity: alice is side A
  await db.run(
    sql`INSERT INTO conversations (id, user_a, user_b, created_at, last_message_at)
        VALUES (${CONVO}, ${a}, ${b}, ${"2026-06-14T08:00:00.000Z"}, ${"2026-06-14T08:00:00.000Z"})`
  );
}

async function sendMessage(sender: string, body: string, at: string) {
  const id = `m-${at}-${sender}`;
  await db.run(
    sql`INSERT INTO dm_messages (id, conversation_id, sender_id, body, created_at, read)
        VALUES (${id}, ${CONVO}, ${sender}, ${body}, ${at}, 0)`
  );
  await db.run(sql`UPDATE conversations SET last_message_at = ${at} WHERE id = ${CONVO}`);
  return id;
}

async function loadMessages() {
  const rows = await db.all<{
    sender_id: string;
    created_at: string;
  }>(
    sql`SELECT sender_id, created_at FROM dm_messages WHERE conversation_id = ${CONVO} ORDER BY created_at`
  );
  return rows.map((r) => ({ senderId: r.sender_id, createdAt: r.created_at }));
}

beforeAll(() => {
  client = createClient({ url: `file:${DB_FILE}` });
  db = drizzle(client, { schema });
});
afterAll(() => {
  client.close();
  // Windows can hold the libsql file handle briefly after close() — a failed
  // temp cleanup must not fail the suite (the OS reaps the temp dir later).
  try {
    rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    /* best-effort temp cleanup */
  }
});
beforeEach(async () => {
  await client.execute(`DROP TABLE IF EXISTS dm_messages`);
  await client.execute(`DROP TABLE IF EXISTS conversations`);
  await client.execute(`DROP TABLE IF EXISTS blocks`);
  for (const ddl of DDL) await client.execute(ddl);
});

describe("DM v2 server integration", () => {
  it("send → recipient unread +1 → mark-read → unread 0 + sender sees seen", async () => {
    await seedConversation();

    // Alice sends one message at 08:01.
    const sentAt = "2026-06-14T08:01:00.000Z";
    await sendMessage(ALICE, "hello bob", sentAt);

    let convo = (await getConversationForUser(CONVO, BOB))!;
    expect(convo).toBeTruthy();
    let bobState = conversationState(convo, BOB);
    const msgs = await loadMessages();

    // Bob has not read anything yet → 1 unread; sender's bubble is "sent".
    expect(countUnread(msgs, BOB, bobState.mine.lastRead)).toBe(1);
    let aliceState = conversationState(convo, ALICE);
    expect(
      deliveryState(
        sentAt,
        false,
        aliceState.peer.lastRead ?? null,
        aliceState.peer.lastSeen ?? null
      )
    ).toBe("sent");

    // Bob opens the thread → mark read up to the head + stamp last_seen.
    const openAt = "2026-06-14T08:02:00.000Z";
    await markThreadRead(convo, BOB, openAt, sentAt);

    convo = (await getConversationForUser(CONVO, BOB))!;
    bobState = conversationState(convo, BOB);
    expect(countUnread(msgs, BOB, bobState.mine.lastRead)).toBe(0);

    // From Alice's side, Bob's last_read is now at/after her message → "seen".
    aliceState = conversationState(convo, ALICE);
    expect(
      deliveryState(
        sentAt,
        false,
        aliceState.peer.lastRead ?? null,
        aliceState.peer.lastSeen ?? null
      )
    ).toBe("seen");
  });

  it("delivered (peer loaded thread) is distinct from seen (peer read up to it)", async () => {
    await seedConversation();
    const sentAt = "2026-06-14T08:05:00.000Z";
    await sendMessage(ALICE, "ping", sentAt);

    // Bob's client loaded the thread BEFORE Alice's message (last_seen older,
    // last_read older) — then a later poll stamps last_seen past the message but
    // we simulate "delivered but not yet read" by advancing only last_seen.
    let convo = (await getConversationForUser(CONVO, BOB))!;
    // Bob sees the thread at 08:06 but his read mark stays before the message.
    await markThreadRead(convo, BOB, "2026-06-14T08:06:00.000Z", null);
    convo = (await getConversationForUser(CONVO, BOB))!;
    const aliceState = conversationState(convo, ALICE);
    expect(
      deliveryState(
        sentAt,
        false,
        aliceState.peer.lastRead ?? null,
        aliceState.peer.lastSeen ?? null
      )
    ).toBe("delivered");
  });

  it("blocked either way refuses messaging", async () => {
    await seedConversation();
    expect(await isBlockedEitherWay(ALICE, BOB)).toBe(false);
    // Bob blocks Alice.
    await db.run(
      sql`INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (${BOB}, ${ALICE}, ${"2026-06-14T08:00:00.000Z"})`
    );
    expect(await isBlockedEitherWay(ALICE, BOB)).toBe(true);
    expect(await isBlockedEitherWay(BOB, ALICE)).toBe(true);
  });

  it("typing heartbeat is surfaced to the peer and expires after the TTL", async () => {
    await seedConversation();
    const now = Date.parse("2026-06-14T09:00:00.000Z");
    const typingAt = new Date(now).toISOString();
    let convo = (await getConversationForUser(CONVO, ALICE))!;
    await setTyping(convo, ALICE, typingAt);

    convo = (await getConversationForUser(CONVO, BOB))!;
    const bobView = conversationState(convo, BOB);
    // Bob (peer) sees Alice typing now, but not 10s later.
    expect(isTyping(bobView.peer.typing ?? null, now + 1000)).toBe(true);
    expect(isTyping(bobView.peer.typing ?? null, now + 10_000)).toBe(false);
  });

  it("peer helper resolves the other participant", async () => {
    await seedConversation();
    const convo = (await getConversationForUser(CONVO, ALICE))!;
    expect(peerId(convo, ALICE)).toBe(BOB);
    expect(peerId(convo, BOB)).toBe(ALICE);
    expect(peerId(convo, "stranger")).toBeNull();
  });

  it("toMessageView projects reactions/edit and suppresses a deleted body", () => {
    const base = {
      id: "m1",
      conversationId: CONVO,
      senderId: ALICE,
      body: "secret text https://news.site/x",
      createdAt: "2026-06-14T08:01:00.000Z",
      read: 0,
      reactions: JSON.stringify({ bob: "love" }),
      editedAt: "2026-06-14T08:02:00.000Z",
      editHistory: JSON.stringify([{ editedAt: "2026-06-14T08:02:00.000Z", body: "old" }]),
      deletedAt: null as string | null,
    };
    const live = toMessageView(base, BOB);
    expect(live.body).toBe(base.body);
    expect(live.reactions).toEqual({ bob: "love" });
    expect(live.editedAt).toBe(base.editedAt);
    expect(live.editHistory).toHaveLength(1);
    expect(live.attachment).toEqual({ kind: "link", url: "https://news.site/x" });
    expect(live.mine).toBe(false); // viewer is bob, sender is alice

    // Deleted: body, reactions, attachment and history are all suppressed.
    const tomb = toMessageView({ ...base, deletedAt: "2026-06-14T08:03:00.000Z" }, ALICE);
    expect(tomb.body).toBe("");
    expect(tomb.reactions).toEqual({});
    expect(tomb.editHistory).toEqual([]);
    expect(tomb.attachment).toBeNull();
    expect(tomb.deletedAt).toBeTruthy();
    expect(tomb.mine).toBe(true);
  });

  it("getConversationForUser denies a non-participant", async () => {
    await seedConversation();
    expect(await getConversationForUser(CONVO, "stranger")).toBeNull();
    expect(await getConversationForUser("nope", ALICE)).toBeNull();
  });
});
