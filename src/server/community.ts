import "server-only";
import { headers } from "next/headers";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { newId } from "@/lib/id";
import { auth } from "./auth";
import { platformDb } from "./db/platform";
import {
  bookmarks,
  comments,
  likes,
  notifications,
  postImages,
  posts,
  profiles,
} from "./db/platform-schema";
import type { AuthorView, PostView, TradeCard } from "@/features/community/types";

/** Creates a notification (no-op when acting on your own content). */
export async function notify(input: {
  userId: string;
  actorId: string;
  type: "like" | "comment" | "reply" | "follow" | "mention";
  postId?: string | null;
  commentId?: string | null;
}) {
  if (input.userId === input.actorId) return;
  await platformDb
    .insert(notifications)
    .values({
      id: newId(),
      userId: input.userId,
      actorId: input.actorId,
      type: input.type,
      postId: input.postId ?? null,
      commentId: input.commentId ?? null,
      createdAt: new Date().toISOString(),
    })
    .catch(() => undefined); // notifications must never break the action
}

/** Notifies every @mentioned handle that exists (excluding the actor). */
export async function notifyMentions(text: string, actorId: string, postId: string | null) {
  const handles = [...new Set([...text.matchAll(/@([a-z0-9_]{3,20})/g)].map((m) => m[1]!))].slice(
    0,
    5
  );
  if (handles.length === 0) return;
  const rows = await platformDb
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(inArray(profiles.username, handles));
  await Promise.all(
    rows.map((r) => notify({ userId: r.userId, actorId, type: "mention", postId }))
  );
}

const RESERVED_USERNAMES = new Set(["admin", "trademark", "api", "mod", "support", "system", "me"]);

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/** Gets-or-creates the user's public profile (auto-generates a unique handle). */
export async function ensureProfile(userId: string, name: string) {
  const existing = await platformDb
    .select()
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .get();
  if (existing) return existing;

  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 14) || "trader";
  // Widen the random space as attempts grow; final attempts use a base36 tail
  // derived from the userId so allocation can't fail under contention.
  for (let attempt = 0; attempt < 12; attempt++) {
    let suffix = "";
    if (attempt > 0 && attempt < 8) suffix = `_${Math.floor(1000 + Math.random() * 9000)}`;
    else if (attempt >= 8)
      suffix = `_${userId
        .replace(/[^a-z0-9]/gi, "")
        .slice(-6)
        .toLowerCase()}${attempt}`;
    const username = `${base}${suffix}`.slice(0, 20);
    if (RESERVED_USERNAMES.has(username)) continue;
    try {
      await platformDb.insert(profiles).values({
        userId,
        username,
        displayName: name || "Trader",
        createdAt: new Date().toISOString(),
      });
      return platformDb.select().from(profiles).where(eq(profiles.userId, userId)).get();
    } catch {
      // Another request may have created this profile concurrently — reuse it.
      const now = await platformDb.select().from(profiles).where(eq(profiles.userId, userId)).get();
      if (now) return now;
      /* else username collision — retry with a different suffix */
    }
  }
  throw new Error("Could not allocate a username");
}

export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.has(username);
}

interface PostRow {
  id: string;
  userId: string;
  title: string | null;
  body: string;
  tradeCard: string | null;
  tags: string | null;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  createdAt: string;
}

const parseJson = <T>(s: string | null): T | null => {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

/** Hydrates post rows into client views (authors, images, likedByMe) in 3 queries. */
export async function hydratePosts(rows: PostRow[], viewerId: string | null): Promise<PostView[]> {
  if (rows.length === 0) return [];
  const postIds = rows.map((r) => r.id);
  const userIds = [...new Set(rows.map((r) => r.userId))];

  const [authors, images, myLikes, myBookmarks] = await Promise.all([
    platformDb.select().from(profiles).where(inArray(profiles.userId, userIds)),
    platformDb
      .select()
      .from(postImages)
      .where(inArray(postImages.postId, postIds))
      .orderBy(postImages.position),
    viewerId
      ? platformDb
          .select({ postId: likes.postId })
          .from(likes)
          .where(and(eq(likes.userId, viewerId), inArray(likes.postId, postIds)))
      : Promise.resolve([] as { postId: string }[]),
    viewerId
      ? platformDb
          .select({ postId: bookmarks.postId })
          .from(bookmarks)
          .where(and(eq(bookmarks.userId, viewerId), inArray(bookmarks.postId, postIds)))
      : Promise.resolve([] as { postId: string }[]),
  ]);

  const authorMap = new Map<string, AuthorView>(
    authors.map((a) => [
      a.userId,
      { username: a.username, displayName: a.displayName, avatar: a.avatar },
    ])
  );
  const likedSet = new Set(myLikes.map((l) => l.postId));
  const bookmarkedSet = new Set(myBookmarks.map((b) => b.postId));
  const imageMap = new Map<string, string[]>();
  for (const img of images) {
    const arr = imageMap.get(img.postId) ?? [];
    arr.push(img.data);
    imageMap.set(img.postId, arr);
  }

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    tags: parseJson<string[]>(r.tags) ?? [],
    tradeCard: parseJson<TradeCard>(r.tradeCard),
    images: imageMap.get(r.id) ?? [],
    likeCount: r.likeCount,
    commentCount: r.commentCount,
    shareCount: r.shareCount,
    createdAt: r.createdAt,
    likedByMe: likedSet.has(r.id),
    bookmarkedByMe: bookmarkedSet.has(r.id),
    mine: viewerId === r.userId,
    author: authorMap.get(r.userId) ?? { username: "deleted", displayName: "Deleted user" },
  }));
}

export interface FeedQuery {
  sort: "latest" | "top";
  cursor: string | null;
  tag: string | null;
  search?: string | null;
  /** "following" / "saved" scope the feed to the viewer's graph. */
  scope?: "all" | "following" | "saved" | null;
  authorUserId?: string;
  limit?: number;
}

export async function queryFeed(q: FeedQuery, viewerId: string | null) {
  const limit = q.limit ?? 15;
  const conditions = [];
  if (viewerId) {
    // Blocked users vanish from the viewer's feeds entirely.
    conditions.push(
      sql`${posts.userId} NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ${viewerId})`
    );
  }
  if (q.authorUserId) conditions.push(eq(posts.userId, q.authorUserId));
  if (q.tag) conditions.push(sql`${posts.tags} LIKE ${`%"${q.tag}"%`}`);
  if (q.scope === "following" && viewerId) {
    conditions.push(
      sql`${posts.userId} IN (SELECT following_id FROM follows WHERE follower_id = ${viewerId})`
    );
  }
  if (q.scope === "saved" && viewerId) {
    conditions.push(
      sql`${posts.id} IN (SELECT post_id FROM bookmarks WHERE user_id = ${viewerId})`
    );
  }
  if (q.search) {
    const like = `%${q.search.slice(0, 60)}%`;
    conditions.push(sql`(${posts.body} LIKE ${like} OR ${posts.title} LIKE ${like})`);
  }

  let rows: PostRow[];
  if (q.sort === "top") {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    conditions.push(sql`${posts.createdAt} >= ${since}`);
    rows = await platformDb
      .select()
      .from(posts)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(posts.likeCount), desc(posts.createdAt))
      .limit(limit + 1);
  } else {
    if (q.cursor) conditions.push(lt(posts.createdAt, q.cursor));
    rows = await platformDb
      .select()
      .from(posts)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(posts.createdAt))
      .limit(limit + 1);
  }

  const page = rows.slice(0, limit);
  const nextCursor =
    q.sort === "latest" && rows.length > limit ? (page[page.length - 1]?.createdAt ?? null) : null;
  return { posts: await hydratePosts(page, viewerId), nextCursor };
}

export async function deletePostCascade(postId: string) {
  await platformDb.delete(comments).where(eq(comments.postId, postId));
  await platformDb.delete(likes).where(eq(likes.postId, postId));
  await platformDb.delete(postImages).where(eq(postImages.postId, postId));
  await platformDb.delete(posts).where(eq(posts.id, postId));
}
