import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import {
  blocks,
  comments,
  follows,
  likes,
  posts,
  profiles,
  user,
} from "@/server/db/platform-schema";
import { getReputation, getSession, hydratePosts, queryFeed } from "@/server/community";

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
  const [
    { posts: userPosts, nextCursor },
    countRow,
    commentCountRow,
    likeCountRow,
    followerRow,
    followingRow,
    myFollow,
  ] = await Promise.all([
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
      .from(comments)
      .where(eq(comments.userId, profile.userId))
      .get(),
    platformDb
      .select({ count: sql<number>`COUNT(*)` })
      .from(likes)
      .where(eq(likes.userId, profile.userId))
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

  // Community reputation STANDING (participation/credibility — NOT trading skill
  // or P&L). Computed from earned, anti-gaming signals + a transparent breakdown.
  // Degrades to a "New" stub if the standing can't be computed (never fails the
  // profile). Skips banned authors' positive framing — the score floors anyway.
  const reputation = await getReputation(profile.userId).catch(() => null);

  // Pinned post rides separately so the client can hoist it above the list
  // (with a "Pinned" marker) regardless of pagination. Hidden when the viewer
  // blocked this user — same rule queryFeed applies to the list itself.
  let pinnedPost: (typeof userPosts)[number] | null = null;
  if (profile.pinnedPostId && !myBlock) {
    const row = await platformDb
      .select()
      .from(posts)
      .where(and(eq(posts.id, profile.pinnedPostId), eq(posts.userId, profile.userId)))
      .get();
    if (row) pinnedPost = (await hydratePosts([row], session?.user.id ?? null))[0] ?? null;
  }
  const pinnedId = pinnedPost?.id;

  return NextResponse.json({
    profile: {
      username: profile.username,
      displayName: profile.displayName,
      bio: profile.bio,
      website: profile.website,
      avatar: profile.avatar,
      accent: profile.accentColor,
      streak:
        profile.shareStreak === 1
          ? { current: profile.streakCurrent, best: profile.streakBest }
          : null,
      createdAt: joinedAt,
      postCount: Number(countRow?.count ?? 0),
      commentCount: Number(commentCountRow?.count ?? 0),
      likeCount: Number(likeCountRow?.count ?? 0),
      followerCount: Number(followerRow?.count ?? 0),
      followingCount: Number(followingRow?.count ?? 0),
      followedByMe: Boolean(myFollow),
      blockedByMe: Boolean(myBlock),
      mine: session?.user.id === profile.userId,
      reputation: reputation
        ? {
            score: reputation.score,
            tier: reputation.tier,
            tierLabel: reputation.tierLabel,
            tierBlurb: reputation.tierBlurb,
            components: reputation.components,
          }
        : null,
      // Earned achievement-AWARD ids (rank-20) — same pass as reputation. Empty
      // for a member whose standing couldn't be computed or who earned none.
      awards: reputation?.awards ?? [],
    },
    pinnedPost,
    posts: pinnedId ? userPosts.filter((p) => p.id !== pinnedId) : userPosts,
    nextCursor,
  });
}
