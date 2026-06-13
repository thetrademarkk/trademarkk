import { NextResponse } from "next/server";
import { eq, asc, and, desc, inArray, ne, sql } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import {
  blocks,
  commentLikes,
  comments,
  follows,
  posts,
  profiles,
} from "@/server/db/platform-schema";
import { deletePostCascade, getSession, hydratePosts, notifyNewMentions } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";
import { invalidateCached } from "@/server/cache";
import { rankRelated } from "@/features/community/related";
import { editPostSchema } from "@/features/community/schemas";
import {
  appendEditSnapshot,
  isWithinEditWindow,
  parseEditHistory,
  type CommentEditSnapshot,
  type PostEditSnapshot,
} from "@/features/community/edit-window";
import type { AuthorView, CommentView, RelatedPostView } from "@/features/community/types";

const parseTags = (s: string | null): string[] => {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s) as unknown;
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
};

/** Up to 4 compact related posts: tag overlap → engagement → recency. Block-aware. */
async function queryRelated(
  postId: string,
  tags: string[],
  viewerId: string | null
): Promise<{ related: RelatedPostView[]; relatedByTag: boolean }> {
  const conditions = [ne(posts.id, postId)];
  if (viewerId) {
    conditions.push(
      sql`${posts.userId} NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ${viewerId})`
    );
  }
  const candidates = await platformDb
    .select({
      id: posts.id,
      userId: posts.userId,
      title: posts.title,
      body: posts.body,
      tags: posts.tags,
      likeCount: posts.likeCount,
      commentCount: posts.commentCount,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .where(and(...conditions))
    .orderBy(desc(posts.createdAt))
    .limit(60); // recent window — plenty at current scale, bounded forever

  const ranked = rankRelated(
    { id: postId, tags },
    candidates.map((c) => ({ ...c, tags: parseTags(c.tags) }))
  );

  const authorIds = [...new Set(ranked.posts.map((p) => p.userId))];
  const authors = authorIds.length
    ? await platformDb.select().from(profiles).where(inArray(profiles.userId, authorIds))
    : [];
  const authorMap = new Map<string, AuthorView>(
    authors.map((a) => [
      a.userId,
      { username: a.username, displayName: a.displayName, avatar: a.avatar },
    ])
  );

  return {
    related: ranked.posts.map((p) => ({
      id: p.id,
      title: p.title,
      body: p.body,
      tags: p.tags,
      likeCount: p.likeCount,
      commentCount: p.commentCount,
      createdAt: p.createdAt,
      author: authorMap.get(p.userId) ?? { username: "deleted", displayName: "Deleted user" },
    })),
    relatedByTag: ranked.byTag,
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSession();
  const row = await platformDb.select().from(posts).where(eq(posts.id, id)).get();
  if (!row) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  const [post] = await hydratePosts([row], session?.user.id ?? null);
  const [{ related, relatedByTag }, followRow] = await Promise.all([
    queryRelated(id, post?.tags ?? [], session?.user.id ?? null),
    session && session.user.id !== row.userId
      ? platformDb
          .select({ followerId: follows.followerId })
          .from(follows)
          .where(and(eq(follows.followerId, session.user.id), eq(follows.followingId, row.userId)))
          .get()
      : Promise.resolve(undefined),
  ]);
  let commentRows = await platformDb
    .select()
    .from(comments)
    .where(eq(comments.postId, id))
    .orderBy(asc(comments.createdAt))
    .limit(500); // hard cap — keeps a hot thread from becoming an unbounded scan
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
      editedAt: c.editedAt,
      editHistory: parseEditHistory<CommentEditSnapshot>(c.editHistory),
      mine: session?.user.id === c.userId,
      author: a
        ? { username: a.username, displayName: a.displayName, avatar: a.avatar }
        : { username: "deleted", displayName: "Deleted user" },
    };
  });

  return NextResponse.json({
    post,
    comments: commentViews,
    related,
    relatedByTag,
    authorFollowedByMe: Boolean(followRow),
  });
}

const parseTagList = (s: string | null): string[] => parseTags(s);

/**
 * Edit a post's title/body/tags. Author-only, and only within the 15-minute
 * edit window — both enforced here, server-side. The pre-edit content is
 * snapshotted into an append-only history (nobody can silently rewrite a bad
 * call), and the same zod validation + @mention re-extraction as creation runs.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const row = await platformDb.select().from(posts).where(eq(posts.id, id)).get();
  if (!row) return NextResponse.json({ error: "Post not found" }, { status: 404 });
  // Author-only authz — checked before the window so a non-author always gets 403.
  if (row.userId !== session.user.id)
    return NextResponse.json({ error: "Only the author can edit this" }, { status: 403 });
  // Window closed → 410 Gone (the resource's editability is permanently gone).
  if (!isWithinEditWindow(row.createdAt))
    return NextResponse.json(
      { error: "The 15-minute edit window for this post has passed" },
      { status: 410 }
    );

  const { allowed } = await rateLimit(`edit:${session.user.id}`, 30, 3600);
  if (!allowed)
    return NextResponse.json({ error: "Editing too fast — try later" }, { status: 429 });

  const parsed = editPostSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid edit" },
      { status: 400 }
    );
  const input = parsed.data;

  const nextTitle = input.title?.trim() || null;
  const nextBody = input.body.trim();
  const nextTags = input.tags;

  // Snapshot the PRE-edit content into the append-only history before writing.
  const snapshot: PostEditSnapshot = {
    editedAt: new Date().toISOString(),
    title: row.title,
    body: row.body,
    tags: parseTagList(row.tags),
  };
  const editedAt = snapshot.editedAt;
  const history = appendEditSnapshot<PostEditSnapshot>(row.editHistory, snapshot);

  await platformDb
    .update(posts)
    .set({
      title: nextTitle,
      body: nextBody,
      tags: nextTags.length ? JSON.stringify(nextTags) : null,
      editedAt,
      editHistory: history,
    })
    .where(eq(posts.id, id));

  // Re-extract @mentions: notify only handles newly introduced by the edit
  // (re-notifying everyone on every edit would spam already-mentioned users).
  await notifyNewMentions(row.body, nextBody, session.user.id, id);
  invalidateCached("feed:"); // anonymous cached feed must reflect the edit

  return NextResponse.json({ edited: true, editedAt });
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
