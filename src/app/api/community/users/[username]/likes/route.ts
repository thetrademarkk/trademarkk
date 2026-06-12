import { NextResponse } from "next/server";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { likes, posts, profiles } from "@/server/db/platform-schema";
import { getSession, hydratePosts } from "@/server/community";

const ISO_CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Posts a user liked, newest like first (profile "Likes" tab).
 * Public read, cursor-paginated on the like timestamp, capped — and
 * block-aware: posts by authors the viewer has blocked stay hidden.
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
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 15, 1), 50);
  const cursor = url.searchParams.get("cursor");

  const conditions = [eq(likes.userId, profile.userId)];
  if (cursor && ISO_CURSOR.test(cursor)) conditions.push(lt(likes.createdAt, cursor));
  if (session) {
    conditions.push(
      sql`${posts.userId} NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ${session.user.id})`
    );
  }

  const rows = await platformDb
    .select({ post: posts, likedAt: likes.createdAt })
    .from(likes)
    .innerJoin(posts, eq(likes.postId, posts.id))
    .where(and(...conditions))
    .orderBy(desc(likes.createdAt))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  return NextResponse.json({
    posts: await hydratePosts(
      page.map((r) => r.post),
      session?.user.id ?? null
    ),
    nextCursor: rows.length > limit ? (page[page.length - 1]?.likedAt ?? null) : null,
  });
}
