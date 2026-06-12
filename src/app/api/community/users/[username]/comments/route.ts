import { NextResponse } from "next/server";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { comments, posts, profiles } from "@/server/db/platform-schema";
import { getSession } from "@/server/community";
import type { ProfileCommentView } from "@/features/community/types";

const ISO_CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * A user's comments with their post context (profile "Comments" tab).
 * Public read, cursor-paginated, capped — and block-aware: comments left on
 * posts whose author the viewer has blocked stay hidden.
 */
export async function GET(req: Request, ctx: { params: Promise<{ username: string }> }) {
  const { username } = await ctx.params;
  const session = await getSession();

  const profile = await platformDb
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(eq(profiles.username, username.toLowerCase()))
    .get();
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 50);
  const cursor = url.searchParams.get("cursor");

  const conditions = [eq(comments.userId, profile.userId)];
  if (cursor && ISO_CURSOR.test(cursor)) conditions.push(lt(comments.createdAt, cursor));
  if (session) {
    conditions.push(
      sql`${posts.userId} NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ${session.user.id})`
    );
  }

  const rows = await platformDb
    .select({
      id: comments.id,
      body: comments.body,
      likeCount: comments.likeCount,
      createdAt: comments.createdAt,
      postId: posts.id,
      postTitle: posts.title,
      postBody: posts.body,
    })
    .from(comments)
    .innerJoin(posts, eq(comments.postId, posts.id))
    .where(and(...conditions))
    .orderBy(desc(comments.createdAt))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const views: ProfileCommentView[] = page.map((r) => ({
    id: r.id,
    body: r.body,
    likeCount: r.likeCount,
    createdAt: r.createdAt,
    // Context only — clamp the post body so the tab never ships full articles.
    post: { id: r.postId, title: r.postTitle, body: r.postBody.slice(0, 140) },
  }));

  return NextResponse.json({
    comments: views,
    nextCursor: rows.length > limit ? (page[page.length - 1]?.createdAt ?? null) : null,
  });
}
