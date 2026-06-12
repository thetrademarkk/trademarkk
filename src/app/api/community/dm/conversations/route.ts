import { NextResponse } from "next/server";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { newId } from "@/lib/id";
import { platformDb } from "@/server/db/platform";
import { conversations, profiles } from "@/server/db/platform-schema";
import { ensureProfile, getSession } from "@/server/community";
import { canonicalPair, isBlockedEitherWay } from "@/server/dm";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";
import { startConversationSchema } from "@/features/community/schemas";
import type { ConversationView } from "@/features/community/types";

/** The viewer's DM inbox: peer profile + last message + unread count per thread. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const me = session.user.id;

  const rows = await platformDb
    .select()
    .from(conversations)
    .where(or(eq(conversations.userA, me), eq(conversations.userB, me)))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(50);
  if (rows.length === 0) return NextResponse.json({ conversations: [], unread: 0 });

  const peerIds = [...new Set(rows.map((r) => (r.userA === me ? r.userB : r.userA)))];
  const peers = await platformDb.select().from(profiles).where(inArray(profiles.userId, peerIds));
  const peerMap = new Map(peers.map((p) => [p.userId, p]));

  const idList = sql.join(
    rows.map((r) => sql`${r.id}`),
    sql`, `
  );
  const [lastRows, unreadRows] = await Promise.all([
    platformDb.all<{
      conversation_id: string;
      body: string;
      sender_id: string;
      created_at: string;
    }>(sql`
      SELECT m.conversation_id, m.body, m.sender_id, m.created_at
      FROM dm_messages m
      JOIN (
        SELECT conversation_id, MAX(created_at) AS mx
        FROM dm_messages WHERE conversation_id IN (${idList})
        GROUP BY conversation_id
      ) t ON t.conversation_id = m.conversation_id AND t.mx = m.created_at
    `),
    platformDb.all<{ conversation_id: string; c: number }>(sql`
      SELECT conversation_id, COUNT(*) AS c
      FROM dm_messages
      WHERE conversation_id IN (${idList}) AND sender_id != ${me} AND read = 0
      GROUP BY conversation_id
    `),
  ]);
  const lastMap = new Map(lastRows.map((m) => [m.conversation_id, m]));
  const unreadMap = new Map(unreadRows.map((u) => [u.conversation_id, Number(u.c)]));

  const items: ConversationView[] = rows.map((r) => {
    const peerId = r.userA === me ? r.userB : r.userA;
    const peer = peerMap.get(peerId);
    const last = lastMap.get(r.id);
    return {
      id: r.id,
      peer: peer
        ? { username: peer.username, displayName: peer.displayName, avatar: peer.avatar }
        : { username: "deleted", displayName: "Deleted user" },
      lastMessage: last
        ? { body: last.body, mine: last.sender_id === me, createdAt: last.created_at }
        : null,
      unread: unreadMap.get(r.id) ?? 0,
      lastMessageAt: r.lastMessageAt,
    };
  });
  const unread = items.reduce((sum, c) => sum + c.unread, 0);
  return NextResponse.json({ conversations: items, unread });
}

/** Creates (or returns) the 1:1 conversation with `username`. Block-aware. */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to send messages" }, { status: 401 });

  const { allowed } = await rateLimit(`dm-convo:${session.user.id}`, 30, 3600);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = startConversationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const target = await platformDb
    .select()
    .from(profiles)
    .where(eq(profiles.username, parsed.data.username.toLowerCase()))
    .get();
  if (!target) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  if (target.userId === session.user.id)
    return NextResponse.json({ error: "You can't message yourself" }, { status: 400 });
  if (await isBlockedEitherWay(session.user.id, target.userId))
    return NextResponse.json({ error: "You can't message this trader" }, { status: 403 });
  await ensureProfile(session.user.id, session.user.name);

  const [userA, userB] = canonicalPair(session.user.id, target.userId);
  const existing = await platformDb
    .select()
    .from(conversations)
    .where(and(eq(conversations.userA, userA), eq(conversations.userB, userB)))
    .get();
  if (existing) return NextResponse.json({ id: existing.id, created: false });

  const now = new Date().toISOString();
  const id = newId();
  try {
    await platformDb
      .insert(conversations)
      .values({ id, userA, userB, createdAt: now, lastMessageAt: now });
  } catch {
    // UNIQUE(user_a, user_b) race — another request created it first; reuse it.
    const winner = await platformDb
      .select()
      .from(conversations)
      .where(and(eq(conversations.userA, userA), eq(conversations.userB, userB)))
      .get();
    if (winner) return NextResponse.json({ id: winner.id, created: false });
    return NextResponse.json({ error: "Could not start the conversation" }, { status: 500 });
  }
  return NextResponse.json({ id, created: true }, { status: 201 });
}
