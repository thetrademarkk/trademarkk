import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { dmMessages } from "@/server/db/platform-schema";
import { getSession } from "@/server/community";
import { getConversationForUser, toMessageView } from "@/server/dm";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";
import { editDmSchema } from "@/features/community/schemas";
import {
  appendEditSnapshot,
  isWithinEditWindow,
  MAX_EDIT_HISTORY,
  parseEditHistory,
  type CommentEditSnapshot,
} from "@/features/community/edit-window";

/** Loads a message that belongs to `conversationId` and authorizes the viewer. */
async function loadOwnMessage(conversationId: string, messageId: string, userId: string) {
  const convo = await getConversationForUser(conversationId, userId);
  if (!convo) return { error: "Conversation not found", status: 404 as const };
  const msg = await platformDb
    .select()
    .from(dmMessages)
    .where(and(eq(dmMessages.id, messageId), eq(dmMessages.conversationId, conversationId)))
    .get();
  if (!msg) return { error: "Message not found", status: 404 as const };
  if (msg.senderId !== userId) return { error: "Not your message", status: 403 as const };
  if (msg.deletedAt) return { error: "Message deleted", status: 410 as const };
  return { convo, msg };
}

/** Edits a message within the 15-min window (author-only; appends history). */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; messageId: string }> }
) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, messageId } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const me = session.user.id;

  const { allowed } = await rateLimit(`dm-edit:${me}`, 30, 3600);
  if (!allowed) return NextResponse.json({ error: "Too many edits" }, { status: 429 });

  const loaded = await loadOwnMessage(id, messageId, me);
  if ("error" in loaded)
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  const { msg } = loaded;

  if (!isWithinEditWindow(msg.createdAt)) {
    return NextResponse.json({ error: "Edit window has closed" }, { status: 410 });
  }

  const parsed = editDmSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid message" },
      { status: 400 }
    );
  }
  const body = parsed.data.body.trim();
  const now = new Date().toISOString();

  // Append the PRE-edit body to the immutable history (reuses the post helper).
  const snapshot: CommentEditSnapshot = { editedAt: now, body: msg.body };
  let nextHistory = appendEditSnapshot<CommentEditSnapshot>(msg.editHistory, snapshot);
  // Defensive cap (matches the post route): trim oldest if somehow over the cap.
  const parsedHistory = parseEditHistory<CommentEditSnapshot>(nextHistory);
  if (parsedHistory.length > MAX_EDIT_HISTORY) {
    nextHistory = JSON.stringify(parsedHistory.slice(parsedHistory.length - MAX_EDIT_HISTORY));
  }

  await platformDb
    .update(dmMessages)
    .set({ body, editedAt: now, editHistory: nextHistory })
    .where(eq(dmMessages.id, messageId));

  const view = toMessageView({ ...msg, body, editedAt: now, editHistory: nextHistory }, me);
  return NextResponse.json({ message: view });
}

/** Soft-deletes a message (author-only) — leaves a "message deleted" tombstone. */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; messageId: string }> }
) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, messageId } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const me = session.user.id;

  const loaded = await loadOwnMessage(id, messageId, me);
  if ("error" in loaded) {
    // A re-delete of an already-deleted message is idempotent-OK from the UI's
    // perspective; surface 410 so the client just refreshes to the tombstone.
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }
  const { msg } = loaded;

  const now = new Date().toISOString();
  // Soft-delete: blank the body + reactions, keep the row as a tombstone so the
  // thread keeps its ordering/continuity. Nothing of the original is leaked.
  await platformDb
    .update(dmMessages)
    .set({ deletedAt: now, body: "", reactions: null })
    .where(eq(dmMessages.id, messageId));

  const view = toMessageView({ ...msg, deletedAt: now, body: "", reactions: null }, me);
  return NextResponse.json({ message: view });
}
