import { NextResponse } from "next/server";
import { and, desc, eq, ne } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { dmMessages } from "@/server/db/platform-schema";
import { getSession } from "@/server/community";
import { conversationState, getConversationForUser, markThreadRead } from "@/server/dm";
import { isAllowedOrigin } from "@/server/origin-check";
import { nextLastRead } from "@/features/community/dm-v2";

/**
 * Explicitly marks a thread read for the viewer (participant-only). The thread
 * GET already marks read on load; this endpoint lets the client re-confirm a
 * read on window focus / tab re-activation so the sender's "seen" updates
 * promptly when the recipient comes back to an already-open thread. Advances the
 * viewer's last_read to the newest message + stamps last_seen. Idempotent.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const me = session.user.id;

  const convo = await getConversationForUser(id, me);
  if (!convo) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  // Read the newest message timestamp to advance the read mark to the head.
  const newest = await platformDb
    .select({ createdAt: dmMessages.createdAt })
    .from(dmMessages)
    .where(eq(dmMessages.conversationId, id))
    .orderBy(desc(dmMessages.createdAt))
    .limit(1)
    .get();

  const state = conversationState(convo, me);
  const now = new Date().toISOString();
  const readUpTo = nextLastRead(
    newest ? [{ createdAt: newest.createdAt }] : [],
    state.mine.lastRead
  );
  await markThreadRead(convo, me, now, readUpTo);
  await platformDb
    .update(dmMessages)
    .set({ read: 1 })
    .where(
      and(eq(dmMessages.conversationId, id), ne(dmMessages.senderId, me), eq(dmMessages.read, 0))
    )
    .catch(() => undefined);

  return NextResponse.json({ ok: true });
}
