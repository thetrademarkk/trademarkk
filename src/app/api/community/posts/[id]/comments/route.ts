import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { newId } from "@/lib/id";
import { platformDb } from "@/server/db/platform";
import { comments, posts } from "@/server/db/platform-schema";
import { ensureProfile, getSession, notify, notifyMentions } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";
import { createCommentSchema } from "@/features/community/schemas";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to comment" }, { status: 401 });

  const { allowed } = await rateLimit(`comment:${session.user.id}`, 20, 3600);
  if (!allowed) return NextResponse.json({ error: "Commenting too fast" }, { status: 429 });

  const parsed = createCommentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid comment" },
      { status: 400 }
    );
  }

  const post = await platformDb
    .select({ id: posts.id, userId: posts.userId })
    .from(posts)
    .where(eq(posts.id, id))
    .get();
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });
  const profile = await ensureProfile(session.user.id, session.user.name);

  // One-level threading: replying to a reply attaches to the top-level parent.
  let parentId: string | null = null;
  let parentAuthor: string | null = null;
  if (parsed.data.parentId) {
    const parent = await platformDb
      .select({
        id: comments.id,
        parentId: comments.parentId,
        userId: comments.userId,
        postId: comments.postId,
      })
      .from(comments)
      .where(eq(comments.id, parsed.data.parentId))
      .get();
    // The parent must live on this post — otherwise a crafted request could
    // thread a reply across posts (and notify the wrong author).
    if (parent && parent.postId !== id)
      return NextResponse.json({ error: "Parent comment not on this post" }, { status: 400 });
    if (!parent || parent.parentId) {
      parentId = parent?.parentId ?? null;
    } else {
      parentId = parent.id;
    }
    parentAuthor = parent?.userId ?? null;
  }

  const body = parsed.data.body.trim();
  const commentId = newId();
  await platformDb.insert(comments).values({
    id: commentId,
    postId: id,
    userId: session.user.id,
    body,
    parentId,
    createdAt: new Date().toISOString(),
  });
  await platformDb
    .update(posts)
    .set({ commentCount: sql`${posts.commentCount} + 1` })
    .where(eq(posts.id, id));

  // Notifications: post author (comment) or parent author (reply) + mentions.
  if (parentAuthor) {
    await notify({
      userId: parentAuthor,
      actorId: session.user.id,
      type: "reply",
      postId: id,
      commentId,
    });
  } else {
    await notify({
      userId: post.userId,
      actorId: session.user.id,
      type: "comment",
      postId: id,
      commentId,
    });
  }
  await notifyMentions(body, session.user.id, id);

  return NextResponse.json(
    {
      id: commentId,
      body,
      parentId,
      likeCount: 0,
      likedByMe: false,
      createdAt: new Date().toISOString(),
      editedAt: null,
      editHistory: [],
      mine: true,
      author: { username: profile!.username, displayName: profile!.displayName },
    },
    { status: 201 }
  );
}
