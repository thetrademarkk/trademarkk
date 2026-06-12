import { NextResponse } from "next/server";
import { eq, asc, and, inArray } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { blocks, commentLikes, comments, posts, profiles } from "@/server/db/platform-schema";
import { deletePostCascade, getSession, hydratePosts } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import type { CommentView } from "@/features/community/types";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSession();
  const row = await platformDb.select().from(posts).where(eq(posts.id, id)).get();
  if (!row) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  const [post] = await hydratePosts([row], session?.user.id ?? null);
  let commentRows = await platformDb
    .select()
    .from(comments)
    .where(eq(comments.postId, id))
    .orderBy(asc(comments.createdAt));
  if (session && commentRows.length) {
    // Blocked users' comments are hidden from the viewer.
    const myBlocks = await platformDb
      .select({ blockedId: blocks.blockedId })
      .from(blocks)
      .where(eq(blocks.blockerId, session.user.id));
    if (myBlocks.length) {
      const blocked = new Set(myBlocks.map((b) => b.blockedId));
      commentRows = commentRows.filter((c) => !blocked.has(c.userId));
    }
  }
  const authorIds = [...new Set(commentRows.map((c) => c.userId))];
  const commentIds = commentRows.map((c) => c.id);
  const [authors, myCommentLikes] = await Promise.all([
    authorIds.length
      ? platformDb.select().from(profiles).where(inArray(profiles.userId, authorIds))
      : Promise.resolve([]),
    session && commentIds.length
      ? platformDb
          .select({ commentId: commentLikes.commentId })
          .from(commentLikes)
          .where(
            and(
              eq(commentLikes.userId, session.user.id),
              inArray(commentLikes.commentId, commentIds)
            )
          )
      : Promise.resolve([] as { commentId: string }[]),
  ]);
  const authorMap = new Map(authors.map((a) => [a.userId, a]));
  const likedSet = new Set(myCommentLikes.map((l) => l.commentId));

  const commentViews: CommentView[] = commentRows.map((c) => {
    const a = authorMap.get(c.userId);
    return {
      id: c.id,
      body: c.body,
      parentId: c.parentId,
      likeCount: c.likeCount,
      likedByMe: likedSet.has(c.id),
      createdAt: c.createdAt,
      mine: session?.user.id === c.userId,
      author: a
        ? { username: a.username, displayName: a.displayName, avatar: a.avatar }
        : { username: "deleted", displayName: "Deleted user" },
    };
  });

  return NextResponse.json({ post, comments: commentViews });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const row = await platformDb.select().from(posts).where(eq(posts.id, id)).get();
  if (!row) return NextResponse.json({ error: "Post not found" }, { status: 404 });
  if (row.userId !== session.user.id)
    return NextResponse.json({ error: "Only the author can delete this" }, { status: 403 });
  await deletePostCascade(id);
  return NextResponse.json({ deleted: true });
}
