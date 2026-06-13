import "server-only";
import { headers } from "next/headers";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { newId } from "@/lib/id";
import { auth } from "./auth";
import { platformDb } from "./db/platform";
import {
  blocks,
  bookmarks,
  commentLikes,
  comments,
  likes,
  notifications,
  postImages,
  postSymbols,
  posts,
  profiles,
  reports,
} from "./db/platform-schema";
import type { AuthorView, PostView, QuotedPostView, TradeCard } from "@/features/community/types";
import {
  applyDiversityCap,
  normalizeReaction,
  resolveReactionCounts,
  topFeedScore,
} from "@/features/community/reactions";
import { parseEditHistory, type PostEditSnapshot } from "@/features/community/edit-window";
import { planSymbolSync } from "@/features/community/cashtags";
import { normalizeQuoteBody, resolveReshareTarget } from "@/features/community/reshare";

/**
 * The notification type union. Community kinds first; BT-09 (D6) adds
 * `backtest_done` / `backtest_failed`. Additive — existing callers pass the
 * same string literals and keep type-checking.
 */
export type NotificationType =
  | "like"
  | "comment"
  | "reply"
  | "follow"
  | "mention"
  | "reshare"
  | "backtest_done"
  | "backtest_failed";

/** Creates a notification (no-op when acting on your own content). */
export async function notify(input: {
  userId: string;
  actorId: string;
  type: NotificationType;
  postId?: string | null;
  commentId?: string | null;
  /** Set for backtest_done / backtest_failed → the backtest_runs.id (D6). */
  backtestId?: string | null;
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
      backtestId: input.backtestId ?? null,
      createdAt: new Date().toISOString(),
    })
    .catch(() => undefined); // notifications must never break the action
}

/** Extracts up to 5 unique @handles from text (mention grammar [a-z0-9_]{3,20}). */
function extractHandles(text: string): string[] {
  return [...new Set([...text.matchAll(/@([a-z0-9_]{3,20})/g)].map((m) => m[1]!))].slice(0, 5);
}

/** Notifies every @mentioned handle that exists (excluding the actor). */
export async function notifyMentions(text: string, actorId: string, postId: string | null) {
  const handles = extractHandles(text);
  if (handles.length === 0) return;
  const rows = await platformDb
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(inArray(profiles.username, handles));
  await Promise.all(
    rows.map((r) => notify({ userId: r.userId, actorId, type: "mention", postId }))
  );
}

/**
 * On an edit, notifies only handles NEWLY introduced (present in the new text
 * but not the old) — re-notifying already-mentioned users on every keystroke
 * fix would be spam.
 */
export async function notifyNewMentions(
  oldText: string,
  newText: string,
  actorId: string,
  postId: string | null
) {
  const before = new Set(extractHandles(oldText));
  const added = extractHandles(newText).filter((h) => !before.has(h));
  if (added.length === 0) return;
  const rows = await platformDb
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(inArray(profiles.username, added));
  await Promise.all(
    rows.map((r) => notify({ userId: r.userId, actorId, type: "mention", postId }))
  );
}

/**
 * Re-syncs a post's $cashtag → symbol join rows to match the given body.
 * Idempotent: extracts the (normalized, deduped, capped) cashtags from the
 * body, deletes any join rows no longer present, and inserts the new ones.
 * Used on BOTH create and edit (on create there are simply no existing rows).
 * Never throws into the caller — a tag-sync hiccup must not fail the post.
 */
export async function syncPostSymbols(postId: string, body: string): Promise<void> {
  try {
    const existing = await platformDb
      .select({ symbol: postSymbols.symbol })
      .from(postSymbols)
      .where(eq(postSymbols.postId, postId));
    const { toAdd, toRemove } = planSymbolSync(
      existing.map((r) => r.symbol),
      body
    );

    if (toRemove.length) {
      await platformDb
        .delete(postSymbols)
        .where(and(eq(postSymbols.postId, postId), inArray(postSymbols.symbol, toRemove)));
    }
    if (toAdd.length) {
      const now = new Date().toISOString();
      await platformDb
        .insert(postSymbols)
        .values(toAdd.map((symbol) => ({ postId, symbol, createdAt: now })))
        .onConflictDoNothing();
    }
  } catch {
    // Cashtag indexing is best-effort — never break the post create/edit.
  }
}

/**
 * Escapes LIKE-pattern metacharacters so user input matches literally. Pair
 * with `ESCAPE '\\'` on the SQL side. Matches the form used by the search and
 * autocomplete routes (escape char is a single backslash). Exported for tests.
 */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const RESERVED_USERNAMES = new Set([
  "admin",
  "trademark",
  "trademarkk",
  "api",
  "mod",
  "support",
  "system",
  "me",
]);

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
  reactions: string | null;
  commentCount: number;
  shareCount: number;
  reshareCount: number;
  quotePostId: string | null;
  createdAt: string;
  editedAt: string | null;
  editHistory: string | null;
}

const parseJson = <T>(s: string | null): T | null => {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

/** A short, snippet-only preview of an original embedded inside a reshare. */
const QUOTE_SNIPPET_MAX = 280;

/**
 * Builds the embedded-original map for a page of posts. For every post that is a
 * reshare (has a `quotePostId`), fetches the referenced original and projects a
 * trimmed `QuotedPostView`. Block-aware: an original whose author the VIEWER has
 * blocked is hidden (the reshare carries `quoted: null`); a deleted original
 * yields an `unavailable` placeholder. One extra query per page at most.
 */
async function hydrateQuoted(
  rows: PostRow[],
  viewerId: string | null
): Promise<Map<string, QuotedPostView | null>> {
  const out = new Map<string, QuotedPostView | null>();
  const quotedIds = [...new Set(rows.map((r) => r.quotePostId).filter((x): x is string => !!x))];
  if (quotedIds.length === 0) return out;

  const [originals, blockedRows] = await Promise.all([
    platformDb
      .select({
        id: posts.id,
        userId: posts.userId,
        title: posts.title,
        body: posts.body,
        tradeCard: posts.tradeCard,
        createdAt: posts.createdAt,
      })
      .from(posts)
      .where(inArray(posts.id, quotedIds)),
    viewerId
      ? platformDb
          .select({ blockedId: blocks.blockedId })
          .from(blocks)
          .where(eq(blocks.blockerId, viewerId))
      : Promise.resolve([] as { blockedId: string }[]),
  ]);
  const blocked = new Set(blockedRows.map((b) => b.blockedId));

  const origAuthorIds = [...new Set(originals.map((o) => o.userId))];
  const origAuthors = origAuthorIds.length
    ? await platformDb.select().from(profiles).where(inArray(profiles.userId, origAuthorIds))
    : [];
  const origAuthorMap = new Map<string, AuthorView>(
    origAuthors.map((a) => [
      a.userId,
      { username: a.username, displayName: a.displayName, avatar: a.avatar },
    ])
  );
  const originalById = new Map(originals.map((o) => [o.id, o]));

  for (const id of quotedIds) {
    const o = originalById.get(id);
    if (!o) {
      // The original was deleted — render a placeholder rather than dropping it.
      out.set(id, {
        id,
        title: null,
        body: "",
        tradeCard: null,
        createdAt: "",
        author: { username: "deleted", displayName: "Deleted user" },
        unavailable: true,
      });
      continue;
    }
    // Hide originals from authors the viewer has blocked (the reshare itself
    // stays, but its embedded card is suppressed).
    if (blocked.has(o.userId)) {
      out.set(id, null);
      continue;
    }
    const full = o.body;
    const body =
      full.length > QUOTE_SNIPPET_MAX ? full.slice(0, QUOTE_SNIPPET_MAX).trimEnd() + "…" : full;
    out.set(id, {
      id: o.id,
      title: o.title,
      body,
      tradeCard: parseJson<TradeCard>(o.tradeCard),
      createdAt: o.createdAt,
      author: origAuthorMap.get(o.userId) ?? { username: "deleted", displayName: "Deleted user" },
      unavailable: false,
    });
  }
  return out;
}

/** Hydrates post rows into client views (authors, images, likedByMe) in 3 queries. */
export async function hydratePosts(rows: PostRow[], viewerId: string | null): Promise<PostView[]> {
  if (rows.length === 0) return [];
  const postIds = rows.map((r) => r.id);
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const quotedMap = await hydrateQuoted(rows, viewerId);

  const [authors, images, myLikes, myBookmarks] = await Promise.all([
    platformDb.select().from(profiles).where(inArray(profiles.userId, userIds)),
    platformDb
      .select()
      .from(postImages)
      .where(inArray(postImages.postId, postIds))
      .orderBy(postImages.position),
    viewerId
      ? platformDb
          .select({ postId: likes.postId, reaction: likes.reaction })
          .from(likes)
          .where(and(eq(likes.userId, viewerId), inArray(likes.postId, postIds)))
      : Promise.resolve([] as { postId: string; reaction: string | null }[]),
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
  // The author's pin rides along with the profile rows we already fetched.
  const pinnedByAuthor = new Map(authors.map((a) => [a.userId, a.pinnedPostId]));
  // Map the viewer's reaction per post (NULL → legacy "like").
  const myReactionMap = new Map(myLikes.map((l) => [l.postId, normalizeReaction(l.reaction)]));
  const bookmarkedSet = new Set(myBookmarks.map((b) => b.postId));
  const imageMap = new Map<string, string[]>();
  for (const img of images) {
    const arr = imageMap.get(img.postId) ?? [];
    arr.push(img.data);
    imageMap.set(img.postId, arr);
  }

  return rows.map((r) => {
    const myReaction = myReactionMap.get(r.id) ?? null;
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      tags: parseJson<string[]>(r.tags) ?? [],
      tradeCard: parseJson<TradeCard>(r.tradeCard),
      images: imageMap.get(r.id) ?? [],
      likeCount: r.likeCount,
      reactionCounts: resolveReactionCounts(r.reactions, r.likeCount),
      commentCount: r.commentCount,
      shareCount: r.shareCount,
      reshareCount: r.reshareCount,
      quotePostId: r.quotePostId,
      quoted: r.quotePostId ? (quotedMap.get(r.quotePostId) ?? null) : undefined,
      createdAt: r.createdAt,
      editedAt: r.editedAt,
      editHistory: parseEditHistory<PostEditSnapshot>(r.editHistory),
      likedByMe: myReaction !== null,
      myReaction,
      bookmarkedByMe: bookmarkedSet.has(r.id),
      mine: viewerId === r.userId,
      pinned: pinnedByAuthor.get(r.userId) === r.id,
      author: authorMap.get(r.userId) ?? { username: "deleted", displayName: "Deleted user" },
    };
  });
}

export interface FeedQuery {
  sort: "latest" | "top";
  cursor: string | null;
  tag: string | null;
  search?: string | null;
  /** Per-symbol stream scope — only posts tagged with this $cashtag (uppercase). */
  symbol?: string | null;
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
  if (q.tag) {
    // tags is a JSON array string; match the quoted element. The tag is escaped
    // for LIKE metacharacters (and the route validates its grammar) so a value
    // like `%` or `_` can't broaden the match into a wildcard scan.
    const tagPattern = `%"${escapeLike(q.tag)}"%`;
    conditions.push(sql`${posts.tags} LIKE ${tagPattern} ESCAPE '\\'`);
  }
  if (q.symbol) {
    // Per-symbol stream: only posts joined to this cashtag (uppercase).
    const symbol = q.symbol.toUpperCase();
    conditions.push(
      sql`${posts.id} IN (SELECT post_id FROM post_symbols WHERE symbol = ${symbol})`
    );
  }
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
    // Pull a wider candidate window cheaply (total reactions + comments give a
    // sound SQL pre-filter), then re-rank in JS with the kind-weighted,
    // recency-decayed hot-score so reaction *type* and freshness both count.
    const candidates = await platformDb
      .select()
      .from(posts)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(sql`${posts.likeCount} + ${posts.commentCount}`), desc(posts.createdAt))
      .limit(Math.min(120, (limit + 1) * 4));
    const now = Date.now();
    const scored = candidates
      .map((r) => ({
        row: r as PostRow,
        score: topFeedScore(
          resolveReactionCounts((r as PostRow).reactions, r.likeCount),
          r.commentCount,
          (now - new Date(r.createdAt).getTime()) / 3_600_000
        ),
      }))
      .sort((a, b) => b.score - a.score || (a.row.createdAt < b.row.createdAt ? 1 : -1));
    // Per-author diversity cap so one prolific poster can't dominate the Top
    // window. Skipped when the feed is already pinned to a single author (a
    // profile's Top view) where capping would be meaningless. Applied over the
    // whole scored window BEFORE slicing so capped authors yield to others.
    const diversified = q.authorUserId ? scored : applyDiversityCap(scored, (s) => s.row.userId);
    rows = diversified.slice(0, limit + 1).map((s) => s.row);
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

/**
 * Count of distinct posts tagged with a $cashtag — drives the per-symbol stream
 * header. Cheap COUNT over the indexed join (idx_post_symbols_symbol). Returns
 * 0 on any error (the page degrades to the client-fetched feed regardless).
 */
export async function countPostsForSymbol(symbol: string): Promise<number> {
  try {
    const row = await platformDb
      .select({ n: sql<number>`count(*)` })
      .from(postSymbols)
      .where(eq(postSymbols.symbol, symbol.toUpperCase()))
      .get();
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Deletes a post and EVERYTHING that hangs off it — comments (and their likes),
 * post likes, images, bookmarks, $cashtag join rows, notifications referencing
 * it, and any abuse reports targeting the post or its comments — atomically.
 * Previously bookmarks, notifications and reports were left behind (orphaned
 * rows: a deleted post could still surface in someone's saved feed or keep an
 * unactionable report in the admin queue), and the multi-statement delete was
 * non-transactional so a mid-cascade failure left the data half-deleted.
 */
export async function deletePostCascade(postId: string) {
  await platformDb.transaction(async (tx) => {
    // If this post is itself a reshare, decrement the ORIGINAL's reshare tally so
    // the count stays honest when a reshare is removed.
    const self = await tx
      .select({ quotePostId: posts.quotePostId })
      .from(posts)
      .where(eq(posts.id, postId))
      .get();
    if (self?.quotePostId) {
      await tx
        .update(posts)
        .set({ reshareCount: sql`MAX(0, ${posts.reshareCount} - 1)` })
        .where(eq(posts.id, self.quotePostId));
    }

    // Comment ids on this post — needed to purge their likes and reports too.
    const commentRows = await tx
      .select({ id: comments.id })
      .from(comments)
      .where(eq(comments.postId, postId));
    const commentIds = commentRows.map((c) => c.id);

    if (commentIds.length) {
      await tx.delete(commentLikes).where(inArray(commentLikes.commentId, commentIds));
      await tx
        .delete(reports)
        .where(and(eq(reports.targetType, "comment"), inArray(reports.targetId, commentIds)));
    }
    await tx.delete(comments).where(eq(comments.postId, postId));
    await tx.delete(likes).where(eq(likes.postId, postId));
    await tx.delete(postImages).where(eq(postImages.postId, postId));
    await tx.delete(postSymbols).where(eq(postSymbols.postId, postId));
    await tx.delete(bookmarks).where(eq(bookmarks.postId, postId));
    await tx.delete(notifications).where(eq(notifications.postId, postId));
    await tx
      .delete(reports)
      .where(and(eq(reports.targetType, "post"), eq(reports.targetId, postId)));
    // A deleted post must not linger as anyone's profile pin.
    await tx.update(profiles).set({ pinnedPostId: null }).where(eq(profiles.pinnedPostId, postId));
    await tx.delete(posts).where(eq(posts.id, postId));
  });
}

interface CreateReshareResult {
  /** The new reshare/quote post's id. */
  id: string;
  /** The root original it references (after collapsing any reshare-of-reshare). */
  rootId: string;
  /** True when the resharer added commentary (a quote), false for a plain reshare. */
  quote: boolean;
}

/**
 * Creates a reshare (empty body) or quote (with commentary) of `targetId`.
 *
 * Rules enforced here:
 *  - The target must exist and be visible to the resharer (block-aware BOTH ways:
 *    a target whose author blocked the resharer, or whom the resharer blocked, is
 *    treated as not found).
 *  - Resharing your OWN post is allowed.
 *  - A reshare-of-a-reshare collapses to the ROOT original (no nesting chains).
 *  - Increments the ROOT original's `reshareCount` and notifies its author.
 *
 * Reuses the same post row shape as createPost; the new row carries
 * `quotePostId` set and the (trimmed) commentary as its body.
 *
 * @returns the new post id + the root original id, or null when the target is
 *          missing / not visible.
 */
export async function createReshare(
  resharerId: string,
  targetId: string,
  rawBody: string | null | undefined
): Promise<CreateReshareResult | null> {
  const target = await platformDb
    .select({ id: posts.id, userId: posts.userId, quotePostId: posts.quotePostId })
    .from(posts)
    .where(eq(posts.id, targetId))
    .get();
  if (!target) return null;

  // Block-aware BOTH directions: hide the target if either side has blocked the
  // other (mirrors the feed's one-way block, applied symmetrically for safety).
  if (resharerId !== target.userId) {
    const block = await platformDb
      .select({ blockerId: blocks.blockerId })
      .from(blocks)
      .where(
        sql`(${blocks.blockerId} = ${resharerId} AND ${blocks.blockedId} = ${target.userId})
            OR (${blocks.blockerId} = ${target.userId} AND ${blocks.blockedId} = ${resharerId})`
      )
      .get();
    if (block) return null;
  }

  // Collapse a reshare-of-a-reshare to the root original so chains never form.
  const rootId = resolveReshareTarget(target.id, target.quotePostId);
  // The root must still exist (the immediate target might reference a deleted
  // original); if it's gone we can't attribute the reshare, so refuse.
  let rootAuthorId = target.userId;
  if (rootId !== target.id) {
    const root = await platformDb
      .select({ id: posts.id, userId: posts.userId })
      .from(posts)
      .where(eq(posts.id, rootId))
      .get();
    if (!root) return null;
    rootAuthorId = root.userId;
  }

  const body = normalizeQuoteBody(rawBody);
  const id = newId();
  const now = new Date().toISOString();
  await platformDb.insert(posts).values({
    id,
    userId: resharerId,
    title: null,
    body,
    quotePostId: rootId,
    createdAt: now,
  });
  // Bump the root original's denormalized reshare tally.
  await platformDb
    .update(posts)
    .set({ reshareCount: sql`${posts.reshareCount} + 1` })
    .where(eq(posts.id, rootId));

  // A quote's commentary can itself mention people / tag tickers.
  if (body) {
    await notifyMentions(body, resharerId, id);
    await syncPostSymbols(id, body);
  }
  // Notify the ROOT author (no-op when resharing your own post).
  await notify({ userId: rootAuthorId, actorId: resharerId, type: "reshare", postId: rootId });

  return { id, rootId, quote: body.length > 0 };
}
