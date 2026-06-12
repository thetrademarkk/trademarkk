import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { blocks, follows, posts, profiles, user } from "@/server/db/platform-schema";
import { getSession, queryFeed } from "@/server/community";

/** Public profile + their posts. */
export async function GET(req: Request, ctx: { params: Promise<{ username: string }> }) {
  const { username } = await ctx.params;
  const session = await getSession();

  const profile = await platformDb
    .select()
    .from(profiles)
    .where(eq(profiles.username, username.toLowerCase()))
    .get();
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const url = new URL(req.url);
  const [{ posts: userPosts, nextCursor }, countRow, followerRow, followingRow, myFollow] =
    await Promise.all([
      queryFeed(
        {
          sort: "latest",
          cursor: url.searchParams.get("cursor"),
          tag: null,
          authorUserId: profile.userId,
        },
        session?.user.id ?? null
      ),
      platformDb
        .select({ count: sql<number>`COUNT(*)` })
        .from(posts)
        .where(eq(posts.userId, profile.userId))
        .get(),
      platformDb
        .select({ count: sql<number>`COUNT(*)` })
        .from(follows)
        .where(eq(follows.followingId, profile.userId))
        .get(),
      platformDb
        .select({ count: sql<number>`COUNT(*)` })
        .from(follows)
        .where(eq(follows.followerId, profile.userId))
        .get(),
      session
        ? platformDb
            .select()
            .from(follows)
            .where(
              and(eq(follows.followerId, session.user.id), eq(follows.followingId, profile.userId))
            )
            .get()
        : Promise.resolve(undefined),
    ]);

  const myBlock = session
    ? await platformDb
        .select()
        .from(blocks)
        .where(and(eq(blocks.blockerId, session.user.id), eq(blocks.blockedId, profile.userId)))
        .get()
    : undefined;

  // "Joined" = account signup, not when the community profile row was created
  // (those can differ by days if the user signed up before first interacting).
  const account = await platformDb
    .select({ createdAt: user.createdAt })
    .from(user)
    .where(eq(user.id, profile.userId))
    .get();
  const joinedAt = account ? account.createdAt.toISOString() : profile.createdAt;

  return NextResponse.json({
    profile: {
      username: profile.username,
      displayName: profile.displayName,
      bio: profile.bio,
      website: profile.website,
      avatar: profile.avatar,
      streak:
        profile.shareStreak === 1
          ? { current: profile.streakCurrent, best: profile.streakBest }
          : null,
      createdAt: joinedAt,
      postCount: Number(countRow?.count ?? 0),
      followerCount: Number(followerRow?.count ?? 0),
      followingCount: Number(followingRow?.count ?? 0),
      followedByMe: Boolean(myFollow),
      blockedByMe: Boolean(myBlock),
      mine: session?.user.id === profile.userId,
    },
    posts: userPosts,
    nextCursor,
  });
}
