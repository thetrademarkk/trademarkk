import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { dmMessages } from "@/server/db/platform-schema";
import { getSession } from "@/server/community";
import {
  getConversationForUser,
  isBlockedEitherWay,
  peerId as peerIdOf,
  toMessageView,
} from "@/server/dm";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";
import { reactDmSchema } from "@/features/community/schemas";
import {
  parseMessageReactions,
  serializeMessageReactions,
  toggleMessageReaction,
} from "@/features/community/dm-v2";

/**
 * Toggles the viewer's reaction on a message (either participant may react to
 * any non-deleted message in their own conversation). One reaction per user per
 * message: same kind removes, different kind switches. Block-aware (a blocked
 * pair can no longer interact at all). Idempotent + rate-limited.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; messageId: string }> }
) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, messageId } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const me = session.user.id;

  const { allowed } = await rateLimit(`dm-react:${me}`, 120, 3600);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = reactDmSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid reaction" },
      { status: 400 }
    );
  }

  const convo = await getConversationForUser(id, me);
  if (!convo) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  const peerId = peerIdOf(convo, me)!;
  if (await isBlockedEitherWay(me, peerId))
    return NextResponse.json({ error: "You can't message this trader" }, { status: 403 });

  const msg = await platformDb
    .select()
    .from(dmMessages)
    .where(and(eq(dmMessages.id, messageId), eq(dmMessages.conversationId, id)))
    .get();
  if (!msg) return NextResponse.json({ error: "Message not found" }, { status: 404 });
  if (msg.deletedAt) return NextResponse.json({ error: "Message deleted" }, { status: 410 });

  const next = toggleMessageReaction(
    parseMessageReactions(msg.reactions),
    me,
    parsed.data.reaction
  );
  const serialized = serializeMessageReactions(next);
  await platformDb
    .update(dmMessages)
    .set({ reactions: serialized })
    .where(eq(dmMessages.id, messageId));

  const view = toMessageView({ ...msg, reactions: serialized }, me);
  return NextResponse.json({ message: view });
}
