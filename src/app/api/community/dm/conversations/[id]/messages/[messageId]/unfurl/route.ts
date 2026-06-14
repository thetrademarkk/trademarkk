import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { dmMessages } from "@/server/db/platform-schema";
import { getSession } from "@/server/community";
import { getConversationForUser } from "@/server/dm";
import { getUnfurl } from "@/server/unfurl";
import { rateLimit } from "@/server/rate-limit";
import { classifyAttachment } from "@/features/community/dm-v2";

/**
 * Lazy link-preview for a DM message — the EXACT same zero-infra mechanism as
 * the post unfurl route (src/app/api/community/unfurl): resolve the FIRST link
 * in the STORED message body server-side (never from the query string, so this
 * can't be turned into an SSRF proxy) and return its cached/fetched OG card.
 * Participant-only. Returns `{ unfurl: null }` whenever there's no link card to
 * show (no link, an image link, a deleted message, or an unsafe URL).
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; messageId: string }> }
) {
  const { id, messageId } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const me = session.user.id;

  const { allowed } = await rateLimit(`dm-unfurl:${me}`, 40, 60);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  try {
    const convo = await getConversationForUser(id, me);
    if (!convo) return NextResponse.json({ unfurl: null });

    const msg = await platformDb
      .select({ body: dmMessages.body, deletedAt: dmMessages.deletedAt })
      .from(dmMessages)
      .where(and(eq(dmMessages.id, messageId), eq(dmMessages.conversationId, id)))
      .get();
    if (!msg || msg.deletedAt) return NextResponse.json({ unfurl: null });

    const attachment = classifyAttachment(msg.body);
    // Only link cards are unfurled here; image URLs render directly via next/image.
    if (!attachment || attachment.kind !== "link") return NextResponse.json({ unfurl: null });

    const unfurl = await getUnfurl(attachment.url);
    return NextResponse.json({ unfurl });
  } catch {
    return NextResponse.json({ unfurl: null });
  }
}
