import { NextResponse } from "next/server";
import { getSession } from "@/server/community";
import {
  getConversationForUser,
  isBlockedEitherWay,
  peerId as peerIdOf,
  setTyping,
} from "@/server/dm";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";

/**
 * Records the viewer's typing heartbeat for a thread (participant-only). The
 * client throttles these (see dm-v2.ts shouldSendTypingPing); the peer's thread
 * poll surfaces it and it expires after TYPING_TTL_MS. Ephemeral, no infra — a
 * single column write. Block-aware (a blocked pair sends no signals). Cheap +
 * generously rate-limited (one write per few seconds while typing).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const me = session.user.id;

  // 60/min comfortably covers a throttled (~one/3s) heartbeat while typing.
  const { allowed } = await rateLimit(`dm-typing:${me}`, 60, 60);
  if (!allowed) return NextResponse.json({ ok: true }); // silently no-op, never error the UI

  const convo = await getConversationForUser(id, me);
  if (!convo) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  const peerId = peerIdOf(convo, me)!;
  if (await isBlockedEitherWay(me, peerId)) return NextResponse.json({ ok: true });

  await setTyping(convo, me, new Date().toISOString());
  return NextResponse.json({ ok: true });
}
