import "server-only";
import { headers } from "next/headers";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { newId } from "@/lib/id";
import { auth } from "./auth";
import { platformDb } from "./db/platform";
import { cached } from "./cache";
import {
  blocks,
  bookmarks,
  commentLikes,
  comments,
  followedTags,
  follows,
  likes,
  notifications,
  postImages,
  postSymbols,
  posts,
  profiles,
  reports,
  watchedSymbols,
} from "./db/platform-schema";
import type { AuthorView, PostView, QuotedPostView, TradeCard } from "@/features/community/types";
import {
  applyDiversityCap,
  normalizeReaction,
  resolveReactionCounts,
  topFeedScore,
} from "@/features/community/reactions";
import {
  buildInterestProfile,
  isColdStart,
  rankForYou,
  type ForYouCandidate,
} from "@/features/community/foryou";
import {
  buildStarterAuthors,
  buildStarterTags,
  shouldShowStarter,
  type SuggestedAuthor,
  type SuggestedTag,
} from "@/features/community/starter-suggestions";
import { parseEditHistory, type PostEditSnapshot } from "@/features/community/edit-window";
import { planSymbolSync } from "@/features/community/cashtags";
import { MAX_FOLLOWED_TAGS, normalizeTag } from "@/features/community/followed-tags";
import { MAX_WATCHED_SYMBOLS, normalizeWatchSymbol } from "@/features/community/watchlist";
import { normalizeQuoteBody, resolveReshareTarget } from "@/features/community/reshare";
import {
  rankTrending,
  windowHours,
  type TrendingEvent,
  type TrendingItem,
  type TrendingWindow,
} from "@/features/community/trending";
import {
  computeSentimentGauge,
  normalizeSentiment,
  sentimentWindowHours,
  type SentimentGauge,
  type SentimentWindow,
} from "@/features/community/sentiment";

/** Creates a notification (no-op when acting on your own content). */
export async function notify(input: {
  userId: string;
  actorId: string;
  type: "like" | "comment" | "reply" | "follow" | "mention" | "reshare";
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
 * Recent post bodies by a single user within `windowMs` (newest first, capped) —
 * the corpus the quality gate's near-duplicate check compares a new post against.
 * Excludes one post id when re-checking an edit (so a post never duplicates
 * itself). Cheap indexed scan on (user_id, created_at). Returns [] on any error
 * so the gate degrades open (a near-dup hiccup must never block a genuine post).
 */
export async function recentPostBodiesByUser(
  userId: string,
  windowMs: number,
  excludePostId?: string,
  limit = 20
): Promise<string[]> {
  try {
    const since = new Date(Date.now() - windowMs).toISOString();
    const rows = await platformDb
      .select({ id: posts.id, body: posts.body })
      .from(posts)
      .where(and(eq(posts.userId, userId), sql`${posts.createdAt} >= ${since}`))
      .orderBy(desc(posts.createdAt))
      .limit(limit);
    return rows.filter((r) => r.id !== excludePostId).map((r) => r.body);
  } catch {
    return [];
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
  sentiment: string | null;
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
      sentiment: normalizeSentiment(r.sentiment),
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
  /** "following" / "saved" / "watchlist" scope the feed to the viewer's graph. */
  scope?: "all" | "following" | "saved" | "watchlist" | null;
  authorUserId?: string;
  limit?: number;
}

/**
 * Builds the shared feed WHERE conditions — blocked-author exclusion, optional
 * single-author scope, tag/symbol filters, the following/watchlist/saved graph
 * scopes, and a free-text search — WITHOUT the sort-specific recency window or
 * pagination cursor. Lifted out of `queryFeed` so the "N new posts" count
 * endpoint (rank-15) applies the EXACT same visibility rules as the feed it
 * sits above; the only thing the count adds on top is `createdAt > since`.
 */
export function buildFeedConditions(q: FeedQuery, viewerId: string | null) {
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
    // The Following feed surfaces posts BY followed users OR carrying a followed
    // tag. The tag side matches the post's JSON tags array against each followed
    // tag via a correlated EXISTS over json_each — so one query returns each
    // post once (no JS union/dedupe needed), and the blocked-user filter above
    // still applies (it is a separate ANDed condition).
    conditions.push(
      sql`(${posts.userId} IN (SELECT following_id FROM follows WHERE follower_id = ${viewerId})
           OR EXISTS (
             SELECT 1 FROM followed_tags ft
             WHERE ft.user_id = ${viewerId}
               AND EXISTS (
                 SELECT 1 FROM json_each(${posts.tags}) je WHERE je.value = ft.tag
               )
           ))`
    );
  }
  if (q.scope === "watchlist" && viewerId) {
    // The Watchlist feed surfaces posts that TAG a watched symbol OR are BY a
    // followed user — the symbol-axis mirror of the Following union (rank-8).
    // The symbol side matches via a correlated EXISTS over post_symbols joined
    // to the viewer's watched_symbols, so one query returns each post once (no
    // JS union/dedupe needed); the followed-author side reuses the follows
    // subquery. The blocked-user filter above still applies (separate ANDed
    // condition). An empty watchlist with no follows yields nothing but the
    // viewer's own followed authors — exactly the honest empty/own state.
    conditions.push(
      sql`(${posts.userId} IN (SELECT following_id FROM follows WHERE follower_id = ${viewerId})
           OR EXISTS (
             SELECT 1 FROM post_symbols ps
             JOIN watched_symbols ws ON ws.symbol = ps.symbol
             WHERE ps.post_id = ${posts.id} AND ws.user_id = ${viewerId}
           ))`
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
  return conditions;
}

export async function queryFeed(q: FeedQuery, viewerId: string | null) {
  const limit = q.limit ?? 15;
  const conditions = buildFeedConditions(q, viewerId);

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
 * Counts posts strictly NEWER than `since` for the given feed query — the cheap
 * (count-only, no payload) backbone of the "N new posts" live pill (rank-15).
 * Reuses `buildFeedConditions` so the same visibility rules as the live feed
 * apply: blocked authors are excluded, the viewer's OWN brand-new posts are
 * excluded (they already prepend via the feed-list invalidation, so they must
 * never inflate the pill), and any active tag/symbol/scope filter is honored.
 * The pill is only ever shown on the recency-ordered Latest view, but the count
 * itself is correct for any query passed in. The result is clamped to `cap`.
 */
export async function countNewerPosts(
  q: FeedQuery,
  viewerId: string | null,
  since: string,
  cap = 50
): Promise<number> {
  const conditions = buildFeedConditions(q, viewerId);
  conditions.push(sql`${posts.createdAt} > ${since}`);
  // The viewer's own fresh posts already slide in via the feed cache
  // invalidation on create, so they must never be counted as "new".
  if (viewerId) conditions.push(sql`${posts.userId} <> ${viewerId}`);
  // A single cheap COUNT over the bounded `createdAt > since` window. We clamp
  // in JS rather than in SQL — the result is naturally tiny in steady state.
  const row = await platformDb
    .select({ c: sql<number>`COUNT(*)` })
    .from(posts)
    .where(and(...conditions))
    .get();
  return Math.min(Number(row?.c ?? 0), cap);
}

/* ── For You (interest feed + cold start) ──────────────────────────────────── */

/** How far back the For-You candidate scan reaches (recent posts only). */
const FORYOU_WINDOW_DAYS = 14;
/** Cap on engaged posts scanned for tag/symbol signals (cheapness guard). */
const FORYOU_ENGAGED_SCAN = 60;
/** Cap on the candidate window pulled for re-ranking (cheapness guard). */
const FORYOU_CANDIDATE_CAP = 150;

/**
 * Builds the viewer's weighted interest profile from cheap, indexed signals:
 *  - followed tags / watched symbols (explicit, strongest);
 *  - tags & symbols carried by posts the viewer liked / bookmarked / authored
 *    (implicit engagement) — scanned over a capped recent set;
 *  - authors the viewer follows (1st-degree) + authors followed by those they
 *    follow (2nd-degree, capped).
 * The heavy lifting is six small indexed reads; the pure `buildInterestProfile`
 * folds them into weighted maps with documented precedence.
 */
async function buildViewerInterestProfile(viewerId: string) {
  // The set of posts the viewer has engaged with (liked OR bookmarked OR
  // authored), capped — drives the implicit tag/symbol signals.
  const engagedPostIds = (
    await platformDb.all<{ id: string }>(
      sql`SELECT id FROM (
            SELECT post_id AS id, created_at FROM likes WHERE user_id = ${viewerId}
            UNION
            SELECT post_id AS id, created_at FROM bookmarks WHERE user_id = ${viewerId}
            UNION
            SELECT id, created_at FROM posts WHERE user_id = ${viewerId}
          )
          ORDER BY created_at DESC
          LIMIT ${FORYOU_ENGAGED_SCAN}`
    )
  ).map((r) => String(r.id));

  const [
    followedTagRows,
    watchedRows,
    followRows,
    secondDegreeRows,
    engagedSymbolRows,
    engagedTagRows,
  ] = await Promise.all([
    platformDb
      .select({ tag: followedTags.tag })
      .from(followedTags)
      .where(eq(followedTags.userId, viewerId)),
    platformDb
      .select({ symbol: watchedSymbols.symbol })
      .from(watchedSymbols)
      .where(eq(watchedSymbols.userId, viewerId)),
    platformDb
      .select({ followingId: follows.followingId })
      .from(follows)
      .where(eq(follows.followerId, viewerId)),
    // 2nd-degree: authors followed by the people the viewer follows, excluding
    // the viewer and anyone they already follow directly (those are 1st-degree).
    platformDb.all<{ id: string }>(
      sql`SELECT DISTINCT f2.following_id AS id
          FROM follows f1
          JOIN follows f2 ON f2.follower_id = f1.following_id
          WHERE f1.follower_id = ${viewerId}
            AND f2.following_id != ${viewerId}
            AND f2.following_id NOT IN (
              SELECT following_id FROM follows WHERE follower_id = ${viewerId}
            )
          LIMIT 200`
    ),
    engagedPostIds.length
      ? platformDb
          .select({ symbol: postSymbols.symbol })
          .from(postSymbols)
          .where(inArray(postSymbols.postId, engagedPostIds))
      : Promise.resolve([] as { symbol: string }[]),
    engagedPostIds.length
      ? platformDb.select({ tags: posts.tags }).from(posts).where(inArray(posts.id, engagedPostIds))
      : Promise.resolve([] as { tags: string | null }[]),
  ]);

  const engagedTags: string[] = [];
  for (const r of engagedTagRows) {
    const arr = parseJson<string[]>(r.tags);
    if (arr) for (const t of arr) engagedTags.push(t);
  }

  return buildInterestProfile({
    followedTags: followedTagRows.map((r) => r.tag),
    watchedSymbols: watchedRows.map((r) => r.symbol),
    followedAuthors: followRows.map((r) => r.followingId),
    secondDegreeAuthors: secondDegreeRows.map((r) => String(r.id)),
    engagedTags,
    engagedSymbols: engagedSymbolRows.map((r) => r.symbol),
  });
}

/**
 * Loads each candidate post's tag list + symbol list so they can be scored
 * against the interest profile. One indexed scan of `post_symbols` for the page
 * of candidate ids; tags come from the rows we already pulled.
 */
async function loadCandidateFacets(
  rows: PostRow[]
): Promise<Map<string, { tags: string[]; symbols: string[] }>> {
  const out = new Map<string, { tags: string[]; symbols: string[] }>();
  for (const r of rows) out.set(r.id, { tags: parseJson<string[]>(r.tags) ?? [], symbols: [] });
  if (rows.length === 0) return out;
  const symbolRows = await platformDb
    .select({ postId: postSymbols.postId, symbol: postSymbols.symbol })
    .from(postSymbols)
    .where(
      inArray(
        postSymbols.postId,
        rows.map((r) => r.id)
      )
    );
  for (const s of symbolRows) out.get(s.postId)?.symbols.push(s.symbol);
  return out;
}

/**
 * The "For You" feed: recent posts re-ranked by a transparent interest score
 * (see features/community/foryou.ts) that combines the viewer's engaged
 * tags/symbols, followed + 2nd-degree authors, and a recency-decayed global
 * hot-score prior. Block-aware, excludes the viewer's own posts, deduped (one
 * row per post), capped per author. A viewer with NO signals (`isColdStart`)
 * falls back to the global Top feed so the tab is never empty.
 *
 * For-You is single-page (no infinite cursor) — it returns the top `limit`
 * posts in one shot; deeper browsing belongs in Latest/Top. Requires a viewer.
 */
export async function queryForYou(
  viewerId: string,
  limit = 15
): Promise<{ posts: PostView[]; nextCursor: null }> {
  const profile = await buildViewerInterestProfile(viewerId);

  // Cold start: no signals at all → the global Top feed (block-aware) is the
  // honest, non-empty fallback. The onboarding starter suggestions (a separate
  // surface) nudge the viewer to build signals.
  if (isColdStart(profile)) {
    const top = await queryFeed(
      { sort: "top", cursor: null, tag: null, scope: "all", limit },
      viewerId
    );
    return { posts: top.posts, nextCursor: null };
  }

  const since = new Date(Date.now() - FORYOU_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
  const conditions = [
    sql`${posts.createdAt} >= ${since}`,
    // Exclude the viewer's own posts — For-You is for discovery, not a mirror.
    sql`${posts.userId} != ${viewerId}`,
    // Reshares with empty bodies add noise to a discovery feed; show originals.
    sql`${posts.quotePostId} IS NULL`,
    // Block-aware: blocked authors never enter the candidate set.
    sql`${posts.userId} NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ${viewerId})`,
  ];
  // Pull a recent candidate window cheaply (newest first), then re-rank in JS by
  // the interest score. Bounded by FORYOU_CANDIDATE_CAP for cost.
  const candidates = (await platformDb
    .select()
    .from(posts)
    .where(and(...conditions))
    .orderBy(desc(posts.createdAt))
    .limit(FORYOU_CANDIDATE_CAP)) as PostRow[];

  if (candidates.length === 0) {
    // Nothing recent to personalize → fall back to Top so the tab isn't empty.
    const top = await queryFeed(
      { sort: "top", cursor: null, tag: null, scope: "all", limit },
      viewerId
    );
    return { posts: top.posts, nextCursor: null };
  }

  const facets = await loadCandidateFacets(candidates);
  const now = Date.now();
  const forYouCandidates: ForYouCandidate[] = candidates.map((r) => {
    const f = facets.get(r.id) ?? { tags: [], symbols: [] };
    return {
      id: r.id,
      authorId: r.userId,
      tags: f.tags,
      symbols: f.symbols,
      hotScore: topFeedScore(
        resolveReactionCounts(r.reactions, r.likeCount),
        r.commentCount,
        (now - new Date(r.createdAt).getTime()) / 3_600_000
      ),
    };
  });

  const ranked = rankForYou(forYouCandidates, profile).slice(0, limit);
  const byId = new Map(candidates.map((r) => [r.id, r]));
  const page = ranked
    .map((s) => byId.get(s.candidate.id))
    .filter((r): r is PostRow => r !== undefined);

  return { posts: await hydratePosts(page, viewerId), nextCursor: null };
}

/* ── Cold-start starter suggestions ────────────────────────────────────────── */

/** The onboarding starter-follows surface: a few seed tags + popular authors. */
export interface StarterSuggestions {
  /** Whether the surface should be shown (thin social graph). */
  show: boolean;
  tags: SuggestedTag[];
  authors: SuggestedAuthor[];
}

/**
 * Derives cold-start "starter follows" for a low-signal viewer — seed tags from
 * the trending board (+ curated fallback) and popular authors from the
 * contributor leaderboard, both excluding what the viewer already follows / is.
 * NO new schema: everything is derived from existing trending + leaderboard data.
 * Returns `show:false` for a well-connected viewer (the UI then renders nothing).
 */
export async function getStarterSuggestions(viewerId: string): Promise<StarterSuggestions> {
  try {
    const [followedTagRows, followRows, watchedRows, me] = await Promise.all([
      platformDb
        .select({ tag: followedTags.tag })
        .from(followedTags)
        .where(eq(followedTags.userId, viewerId)),
      platformDb
        .select({ followingId: follows.followingId })
        .from(follows)
        .where(eq(follows.followerId, viewerId)),
      platformDb
        .select({ symbol: watchedSymbols.symbol })
        .from(watchedSymbols)
        .where(eq(watchedSymbols.userId, viewerId)),
      platformDb
        .select({ username: profiles.username })
        .from(profiles)
        .where(eq(profiles.userId, viewerId))
        .get(),
    ]);

    const followedTagList = followedTagRows.map((r) => r.tag);
    const show = shouldShowStarter({
      follows: followRows.length,
      followedTags: followedTagList.length,
      watchedSymbols: watchedRows.length,
    });
    if (!show) return { show: false, tags: [], authors: [] };

    // Resolve the usernames the viewer already follows (to exclude from author
    // suggestions) and the trending topics + leaderboard (the suggestion sources).
    const followingIds = followRows.map((r) => r.followingId);
    const [followedUsernameRows, trending, leaderboard] = await Promise.all([
      followingIds.length
        ? platformDb
            .select({ username: profiles.username })
            .from(profiles)
            .where(inArray(profiles.userId, followingIds))
        : Promise.resolve([] as { username: string }[]),
      // Trending topics over 7d as seed tags — block-unaware is fine here (this
      // is a curated discovery surface, not a personalized feed).
      queryTrending("7d", null),
      // Top contributors this month (reuse the leaderboard's contrib query).
      platformDb.all<{ username: string; displayName: string; avatar: string | null }>(
        sql`SELECT p.username AS username, p.display_name AS displayName, p.avatar AS avatar
            FROM profiles p
            JOIN (
              SELECT user_id, COUNT(*) AS posts FROM posts GROUP BY user_id
            ) po ON po.user_id = p.user_id
            ORDER BY po.posts DESC LIMIT 12`
      ),
    ]);

    const followedUsernames = followedUsernameRows.map((r) => r.username);
    return {
      show: true,
      tags: buildStarterTags(
        trending.topics.map((t) => ({ tag: t.key, count: t.posts })),
        followedTagList
      ),
      authors: buildStarterAuthors(
        leaderboard.map((r) => ({
          username: String(r.username),
          displayName: String(r.displayName),
          avatar: (r.avatar as string) ?? null,
        })),
        followedUsernames,
        me?.username ?? null
      ),
    };
  } catch {
    // A suggestions surface must never error the page — degrade to hidden.
    return { show: false, tags: [], authors: [] };
  }
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

/* ── Follow a tag ─────────────────────────────────────────────────────────── */

/**
 * Count of posts carrying a given tag — drives the tag page header. The tag is
 * matched against the post's JSON tags array (`tags LIKE '%"tag"%'`, LIKE-escaped
 * so a metacharacter can't broaden the scan). Returns 0 on any error.
 */
export async function countPostsForTag(tag: string): Promise<number> {
  const t = normalizeTag(tag);
  if (!t) return 0;
  try {
    const pattern = `%"${escapeLike(t)}"%`;
    const row = await platformDb
      .select({ n: sql<number>`count(*)` })
      .from(posts)
      .where(sql`${posts.tags} LIKE ${pattern} ESCAPE '\\'`)
      .get();
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

/** The tags a user follows, sorted. Empty for signed-out viewers / on error. */
export async function getFollowedTags(viewerId: string | null): Promise<string[]> {
  if (!viewerId) return [];
  try {
    const rows = await platformDb
      .select({ tag: followedTags.tag })
      .from(followedTags)
      .where(eq(followedTags.userId, viewerId))
      .orderBy(followedTags.tag);
    return rows.map((r) => r.tag);
  } catch {
    return [];
  }
}

/** Whether the viewer follows a specific tag. */
export async function isTagFollowed(viewerId: string | null, tag: string): Promise<boolean> {
  const t = normalizeTag(tag);
  if (!viewerId || !t) return false;
  try {
    const row = await platformDb
      .select({ tag: followedTags.tag })
      .from(followedTags)
      .where(and(eq(followedTags.userId, viewerId), eq(followedTags.tag, t)))
      .get();
    return Boolean(row);
  } catch {
    return false;
  }
}

/**
 * Toggles following a tag for the viewer. Idempotent via the (user_id, tag) PK.
 * Returns the new followed state. Caps the number of tags a user can follow.
 * Returns null when the tag is invalid (the caller 400s).
 */
export async function toggleFollowTag(
  viewerId: string,
  rawTag: string
): Promise<{ following: boolean } | null> {
  const tag = normalizeTag(rawTag);
  if (!tag) return null;

  const existing = await platformDb
    .select({ tag: followedTags.tag })
    .from(followedTags)
    .where(and(eq(followedTags.userId, viewerId), eq(followedTags.tag, tag)))
    .get();

  if (existing) {
    await platformDb
      .delete(followedTags)
      .where(and(eq(followedTags.userId, viewerId), eq(followedTags.tag, tag)));
    return { following: false };
  }

  // Enforce the per-user cap before inserting a new follow.
  const count = await platformDb
    .select({ n: sql<number>`count(*)` })
    .from(followedTags)
    .where(eq(followedTags.userId, viewerId))
    .get();
  if ((count?.n ?? 0) >= MAX_FOLLOWED_TAGS) return null;

  await platformDb
    .insert(followedTags)
    .values({ userId: viewerId, tag, createdAt: new Date().toISOString() })
    .onConflictDoNothing();
  return { following: true };
}

/* ── Watchlist (watched symbols) ───────────────────────────────────────────── */

/** The symbols a user watches, sorted. Empty for signed-out viewers / on error. */
export async function getWatchedSymbols(viewerId: string | null): Promise<string[]> {
  if (!viewerId) return [];
  try {
    const rows = await platformDb
      .select({ symbol: watchedSymbols.symbol })
      .from(watchedSymbols)
      .where(eq(watchedSymbols.userId, viewerId))
      .orderBy(watchedSymbols.symbol);
    return rows.map((r) => r.symbol);
  } catch {
    return [];
  }
}

/** Whether the viewer watches a specific symbol. */
export async function isSymbolWatched(viewerId: string | null, symbol: string): Promise<boolean> {
  const s = normalizeWatchSymbol(symbol);
  if (!viewerId || !s) return false;
  try {
    const row = await platformDb
      .select({ symbol: watchedSymbols.symbol })
      .from(watchedSymbols)
      .where(and(eq(watchedSymbols.userId, viewerId), eq(watchedSymbols.symbol, s)))
      .get();
    return Boolean(row);
  } catch {
    return false;
  }
}

/**
 * Toggles watching a symbol for the viewer. Idempotent via the (user_id, symbol)
 * PK. Returns the new watched state. Caps the number of symbols a user can watch.
 * Returns null when the symbol is invalid (the caller 400s).
 */
export async function toggleWatchSymbol(
  viewerId: string,
  rawSymbol: string
): Promise<{ watching: boolean } | null> {
  const symbol = normalizeWatchSymbol(rawSymbol);
  if (!symbol) return null;

  const existing = await platformDb
    .select({ symbol: watchedSymbols.symbol })
    .from(watchedSymbols)
    .where(and(eq(watchedSymbols.userId, viewerId), eq(watchedSymbols.symbol, symbol)))
    .get();

  if (existing) {
    await platformDb
      .delete(watchedSymbols)
      .where(and(eq(watchedSymbols.userId, viewerId), eq(watchedSymbols.symbol, symbol)));
    return { watching: false };
  }

  // Enforce the per-user cap before inserting a new watch.
  const count = await platformDb
    .select({ n: sql<number>`count(*)` })
    .from(watchedSymbols)
    .where(eq(watchedSymbols.userId, viewerId))
    .get();
  if ((count?.n ?? 0) >= MAX_WATCHED_SYMBOLS) return null;

  await platformDb
    .insert(watchedSymbols)
    .values({ userId: viewerId, symbol, createdAt: new Date().toISOString() })
    .onConflictDoNothing();
  return { watching: true };
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

/* ── Trending board (tickers & topics) ─────────────────────────────────────── */

/** A raw post→key engagement row pulled from the DB before scoring. */
interface TrendingRow {
  key: string;
  authorId: string;
  /** ISO post-creation timestamp. */
  createdAt: string;
}

/**
 * Loads raw $ticker engagement rows (one per post→symbol occurrence) in the
 * window. Block-aware: a signed-in viewer never sees posts from authors they've
 * blocked counted toward a trend. The join rides the indexed `post_symbols`.
 */
async function loadSymbolRows(since: string, viewerId: string | null): Promise<TrendingRow[]> {
  const rows = await platformDb.all<{ key: string; authorId: string; createdAt: string }>(
    sql`SELECT ps.symbol AS key, p.user_id AS authorId, p.created_at AS createdAt
        FROM post_symbols ps
        JOIN posts p ON p.id = ps.post_id
        WHERE p.created_at >= ${since}
          AND (${viewerId} IS NULL
               OR p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ${viewerId}))`
  );
  return rows.map((r) => ({
    key: String(r.key),
    authorId: String(r.authorId),
    createdAt: String(r.createdAt),
  }));
}

/**
 * Loads raw #topic engagement rows (one per post→tag occurrence) in the window
 * by unrolling each post's JSON `tags` array via `json_each`. Same block-aware
 * filter as the symbol rows.
 */
async function loadTagRows(since: string, viewerId: string | null): Promise<TrendingRow[]> {
  const rows = await platformDb.all<{ key: string; authorId: string; createdAt: string }>(
    sql`SELECT je.value AS key, p.user_id AS authorId, p.created_at AS createdAt
        FROM posts p, json_each(p.tags) AS je
        WHERE p.created_at >= ${since}
          AND p.tags IS NOT NULL
          AND (${viewerId} IS NULL
               OR p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ${viewerId}))`
  );
  return rows.map((r) => ({
    key: String(r.key),
    authorId: String(r.authorId),
    createdAt: String(r.createdAt),
  }));
}

/** Turns raw rows into scored TrendingEvents (computing each post's age now). */
function toEvents(rows: TrendingRow[], now: number): TrendingEvent[] {
  return rows.map((r) => ({
    key: r.key,
    authorId: r.authorId,
    ageHours: (now - new Date(r.createdAt).getTime()) / 3_600_000,
  }));
}

/** The ranked trending board for a window: tickers + topics, side by side. */
export interface TrendingBoard {
  window: TrendingWindow;
  tickers: TrendingItem[];
  topics: TrendingItem[];
}

/**
 * Computes the trending board on-read (no cron, no snapshot table). Tickers come
 * from the `post_symbols` join, topics from each post's JSON tags; both are
 * ranked by the spam-resistant `rankTrending` (distinct-author gate + recency
 * weighting). Block-aware for signed-in viewers.
 *
 * The ANONYMOUS board (viewerId === null) is wrapped in the 10-minute in-memory
 * `cached()` so a community of any size triggers at most one DB scan per window
 * per 10 minutes globally; the route layers a CDN `s-maxage` on top. A signed-in
 * viewer's board is personalized (their blocks) so it is computed per request —
 * cheap (two indexed scans of a short window) and never cached cross-user.
 */
export async function queryTrending(
  window: TrendingWindow,
  viewerId: string | null
): Promise<TrendingBoard> {
  const compute = async (): Promise<TrendingBoard> => {
    const now = Date.now();
    const since = new Date(now - windowHours(window) * 3_600_000).toISOString();
    const [symbolRows, tagRows] = await Promise.all([
      loadSymbolRows(since, viewerId),
      loadTagRows(since, viewerId),
    ]);
    return {
      window,
      tickers: rankTrending(toEvents(symbolRows, now)),
      topics: rankTrending(toEvents(tagRows, now)),
    };
  };

  try {
    if (viewerId) return await compute();
    return await cached(`trending:${window}`, 10 * 60_000, compute);
  } catch {
    // The board is a non-critical sidebar/landing surface — degrade to empty
    // rather than error the page (the empty state reads "not enough activity").
    return { window, tickers: [], topics: [] };
  }
}

/* ── Per-symbol community sentiment gauge ───────────────────────────────────── */

/**
 * Loads the bull/bear leans of posts that BOTH tagged `symbol` (via the indexed
 * `post_symbols` join) AND set a sentiment in the window. Block-aware: a
 * signed-in viewer never sees posts from authors they've blocked counted toward
 * the gauge. Only rows with a non-NULL `sentiment` are returned.
 */
async function loadSymbolSentimentRows(
  symbol: string,
  since: string,
  viewerId: string | null
): Promise<{ sentiment: string | null }[]> {
  const rows = await platformDb.all<{ sentiment: string | null }>(
    sql`SELECT p.sentiment AS sentiment
        FROM post_symbols ps
        JOIN posts p ON p.id = ps.post_id
        WHERE ps.symbol = ${symbol.toUpperCase()}
          AND p.sentiment IS NOT NULL
          AND p.created_at >= ${since}
          AND (${viewerId} IS NULL
               OR p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ${viewerId}))`
  );
  return rows;
}

/**
 * Computes the per-symbol community sentiment gauge on-read (no cron, no
 * snapshot). Counts bull vs bear among recent posts that tagged the symbol AND
 * set a sentiment; the pure `computeSentimentGauge` applies the min-sample gate
 * so a tiny sample reads "not enough signal" rather than a confident %.
 *
 * NEVER a recommendation — the UI carries a not-advice disclaimer. Block-aware
 * for signed-in viewers (computed per request); the ANONYMOUS gauge is wrapped
 * in the 10-minute in-memory `cached()` so it costs at most one indexed scan per
 * symbol/window per 10 minutes globally. Degrades to an empty (no-signal) gauge
 * on any error — a per-ticker sidebar must never error the page.
 */
export async function querySymbolSentiment(
  symbol: string,
  window: SentimentWindow,
  viewerId: string | null
): Promise<SentimentGauge> {
  const sym = symbol.toUpperCase();
  const compute = async (): Promise<SentimentGauge> => {
    const since = new Date(Date.now() - sentimentWindowHours(window) * 3_600_000).toISOString();
    const rows = await loadSymbolSentimentRows(sym, since, viewerId);
    const events = rows
      .map((r) => normalizeSentiment(r.sentiment))
      .filter((s): s is "bull" | "bear" => s !== null)
      .map((sentiment) => ({ sentiment }));
    return computeSentimentGauge(events);
  };

  try {
    if (viewerId) return await compute();
    return await cached(`sentiment:${sym}:${window}`, 10 * 60_000, compute);
  } catch {
    return computeSentimentGauge([]);
  }
}
