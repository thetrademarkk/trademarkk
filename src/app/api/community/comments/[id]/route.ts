import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { commentLikes, comments, posts, reports } from "@/server/db/platform-schema";
import { getSession, notifyNewMentions } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";
import { editCommentSchema } from "@/features/community/schemas";
import {
  appendEditSnapshot,
  isWithinEditWindow,
  type CommentEditSnapshot,
} from "@/features/community/edit-window";

/**
 * Edit a comment's body. Author-only, only within the 15-minute window (both
 * enforced server-side), pre-edit body snapshotted into an append-only history,
 * same body validation + newly-added @mention notifications as creating one.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const row = await platformDb.select().from(comments).where(eq(comments.id, id)).get();
  if (!row) return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  if (row.userId !== session.user.id)
    return NextResponse.json({ error: "Only the author can edit this" }, { status: 403 });
  if (!isWithinEditWindow(row.createdAt))
    return NextResponse.json(
      { error: "The 15-minute edit window for this comment has passed" },
      { status: 410 }
    );

  const { allowed } = await rateLimit(`edit:${session.user.id}`, 30, 3600);
  if (!allowed)
    return NextResponse.json({ error: "Editing too fast — try later" }, { status: 429 });

  const parsed = editCommentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid edit" },
      { status: 400 }
    );
  const nextBody = parsed.data.body.trim();

  const snapshot: CommentEditSnapshot = { editedAt: new Date().toISOString(), body: row.body };
  const editedAt = snapshot.editedAt;
  const history = appendEditSnapshot<CommentEditSnapshot>(row.editHistory, snapshot);

  await platformDb
    .update(comments)
    .set({ body: nextBody, editedAt, editHistory: history })
    .where(eq(comments.id, id));

  await notifyNewMentions(row.body, nextBody, session.user.id, row.postId);

  return NextResponse.json({ edited: true, editedAt });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const row = await platformDb.select().from(comments).where(eq(comments.id, id)).get();
  if (!row) return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  if (row.userId !== session.user.id)
    return NextResponse.json({ error: "Only the author can delete this" }, { status: 403 });

  // Deleting a top-level comment removes its replies too (and all their likes).
  const replies = await platformDb
    .select({ id: comments.id })
    .from(comments)
    .where(eq(comments.parentId, id));
  const ids = [id, ...replies.map((r) => r.id)];
  await platformDb.delete(commentLikes).where(inArray(commentLikes.commentId, ids));
  // Purge any abuse reports targeting these comments — a deleted comment must
  // not leave an unactionable row in the admin moderation queue.
  await platformDb
    .delete(reports)
    .where(and(eq(reports.targetType, "comment"), inArray(reports.targetId, ids)));
  await platformDb.delete(comments).where(inArray(comments.id, ids));
  await platformDb
    .update(posts)
    .set({ commentCount: sql`MAX(0, ${posts.commentCount} - ${ids.length})` })
    .where(eq(posts.id, row.postId));
  return NextResponse.json({ deleted: true });
}
