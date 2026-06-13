import { NextResponse } from "next/server";
import { and, desc, eq, lt, ne } from "drizzle-orm";
import { newId } from "@/lib/id";
import { platformDb } from "@/server/db/platform";
import { conversations, dmMessages, profiles } from "@/server/db/platform-schema";
import { getSession } from "@/server/community";
import { getConversationForUser, isBlockedEitherWay } from "@/server/dm";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";
import { sendDmSchema } from "@/features/community/schemas";
import type { DmMessageView } from "@/features/community/types";

const PAGE = 50;
/** Cursors are message ISO timestamps — reject anything else outright. */
const ISO_CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** Thread messages (participant-only, newest page first) — marks incoming read. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const convo = await getConversationForUser(id, session.user.id);
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

  // Opening the thread reads everything the peer sent.
  await platformDb
    .update(dmMessages)
    .set({ read: 1 })
    .where(
      and(
        eq(dmMessages.conversationId, id),
        ne(dmMessages.senderId, session.user.id),
        eq(dmMessages.read, 0)
      )
    );

  const peerId = convo.userA === session.user.id ? convo.userB : convo.userA;
  const peer = await platformDb.select().from(profiles).where(eq(profiles.userId, peerId)).get();

  const messages: DmMessageView[] = page.reverse().map((m) => ({
    id: m.id,
    body: m.body,
    mine: m.senderId === session.user.id,
    createdAt: m.createdAt,
  }));
  return NextResponse.json({
    messages,
    nextCursor,
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

  const { allowed } = await rateLimit(`dm:${session.user.id}`, 60, 3600);
  if (!allowed)
    return NextResponse.json({ error: "Sending too fast — try again soon" }, { status: 429 });
  // Burst guard — at most 5 messages in any 10s window (a chat cadence, not a flood).
  const { allowed: burstOk } = await rateLimit(`dm-burst:${session.user.id}`, 5, 10);
  if (!burstOk)
    return NextResponse.json({ error: "Sending too fast — try again soon" }, { status: 429 });

  const parsed = sendDmSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid message" },
      { status: 400 }
    );
  }

  const convo = await getConversationForUser(id, session.user.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const peerId = convo.userA === session.user.id ? convo.userB : convo.userA;
  if (await isBlockedEitherWay(session.user.id, peerId))
    return NextResponse.json({ error: "You can't message this trader" }, { status: 403 });

  const now = new Date().toISOString();
  const messageId = newId();
  await platformDb.insert(dmMessages).values({
    id: messageId,
    conversationId: id,
    senderId: session.user.id,
    body: parsed.data.body.trim(),
    createdAt: now,
    read: 0,
  });
  await platformDb
    .update(conversations)
    .set({ lastMessageAt: now })
    .where(eq(conversations.id, id));

  const message: DmMessageView = {
    id: messageId,
    body: parsed.data.body.trim(),
    mine: true,
    createdAt: now,
  };
  return NextResponse.json({ message }, { status: 201 });
}
