import { NextResponse } from "next/server";
import { and, desc, eq, lt, ne } from "drizzle-orm";
import { newId } from "@/lib/id";
import { platformDb } from "@/server/db/platform";
import { conversations, dmMessages, profiles } from "@/server/db/platform-schema";
import { getSession, notify } from "@/server/community";
import {
  conversationState,
  getConversationForUser,
  isBlockedEitherWay,
  markThreadRead,
  peerId as peerIdOf,
  toMessageView,
} from "@/server/dm";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";
import { sendDmSchema } from "@/features/community/schemas";
import { nextLastRead } from "@/features/community/dm-v2";
import type { DmMessageView, ThreadState } from "@/features/community/types";

const PAGE = 50;
/** Cursors are message ISO timestamps — reject anything else outright. */
const ISO_CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * Thread messages (participant-only, newest page first). Marks the thread read
 * for the viewer (advances their last_read to the head + stamps last_seen) and
 * surfaces the peer's seen/typing state for the sender's delivery ticks +
 * typing bubble. Only the FIRST (newest) page marks read so paging back through
 * history doesn't keep re-stamping.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const me = session.user.id;

  const convo = await getConversationForUser(id, me);
  if (!convo) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const rawCursor = new URL(req.url).searchParams.get("cursor");
  if (rawCursor !== null && !ISO_CURSOR.test(rawCursor)) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  }
  const cursor = rawCursor;
  const conditions = [eq(dmMessages.conversationId, id)];
  if (cursor) conditions.push(lt(dmMessages.createdAt, cursor));
  const rows = await platformDb
    .select()
    .from(dmMessages)
    .where(and(...conditions))
    .orderBy(desc(dmMessages.createdAt), desc(dmMessages.id))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);
  const nextCursor = rows.length > PAGE ? (page[page.length - 1]?.createdAt ?? null) : null;

  const chrono = page.slice().reverse();

  // Only the live (cursor-less) head page marks the thread read — paging back
  // through history must not advance the read mark.
  const state = conversationState(convo, me);
  if (!cursor) {
    const now = new Date().toISOString();
    const readUpTo = nextLastRead(chrono, state.mine.lastRead);
    await markThreadRead(convo, me, now, readUpTo);
    // Keep the v1 `read` flag in sync so old inbox counters stay correct.
    await platformDb
      .update(dmMessages)
      .set({ read: 1 })
      .where(
        and(eq(dmMessages.conversationId, id), ne(dmMessages.senderId, me), eq(dmMessages.read, 0))
      )
      .catch(() => undefined);
  }

  const peerId = peerIdOf(convo, me)!;
  const peer = await platformDb.select().from(profiles).where(eq(profiles.userId, peerId)).get();

  const messages: DmMessageView[] = chrono.map((m) => toMessageView(m, me));
  const threadState: ThreadState = {
    peerLastReadAt: state.peer.lastRead ?? null,
    peerLastSeenAt: state.peer.lastSeen ?? null,
    peerTypingAt: state.peer.typing ?? null,
  };
  return NextResponse.json({
    messages,
    nextCursor,
    state: threadState,
    peer: peer
      ? { username: peer.username, displayName: peer.displayName, avatar: peer.avatar }
      : { username: "deleted", displayName: "Deleted user" },
  });
}

/** Sends a message in the thread (participant-only, block-aware, rate-limited). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to send messages" }, { status: 401 });
  const me = session.user.id;

  const { allowed } = await rateLimit(`dm:${me}`, 60, 3600);
  if (!allowed)
    return NextResponse.json({ error: "Sending too fast — try again soon" }, { status: 429 });
  // Burst guard — at most 5 messages in any 10s window (a chat cadence, not a flood).
  const { allowed: burstOk } = await rateLimit(`dm-burst:${me}`, 5, 10);
  if (!burstOk)
    return NextResponse.json({ error: "Sending too fast — try again soon" }, { status: 429 });

  const parsed = sendDmSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid message" },
      { status: 400 }
    );
  }

  const convo = await getConversationForUser(id, me);
  if (!convo) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const peerId = peerIdOf(convo, me)!;
  if (await isBlockedEitherWay(me, peerId))
    return NextResponse.json({ error: "You can't message this trader" }, { status: 403 });

  const now = new Date().toISOString();
  const messageId = newId();
  const body = parsed.data.body.trim();
  await platformDb.insert(dmMessages).values({
    id: messageId,
    conversationId: id,
    senderId: me,
    body,
    createdAt: now,
    read: 0,
  });
  // Bump the thread + advance the sender's own read/seen mark to their own send.
  await platformDb
    .update(conversations)
    .set({ lastMessageAt: now })
    .where(eq(conversations.id, id));
  await markThreadRead(convo, me, now, now);

  // Notify the recipient (respects their per-type DM preference + bypass rules).
  await notify({ userId: peerId, actorId: me, type: "message" });

  const message = toMessageView(
    {
      id: messageId,
      conversationId: id,
      senderId: me,
      body,
      createdAt: now,
      read: 0,
      reactions: null,
      editedAt: null,
      editHistory: null,
      deletedAt: null,
    },
    me
  );
  return NextResponse.json({ message }, { status: 201 });
}
