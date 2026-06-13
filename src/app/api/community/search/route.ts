import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { getSession } from "@/server/community";
import { cached } from "@/server/cache";
import { rateLimit } from "@/server/rate-limit";
import { clientIp } from "@/server/client-ip";
import { searchSnippet, SEARCH_MAX_CHARS, SEARCH_MIN_CHARS } from "@/features/community/search";
import type { SearchResponse } from "@/features/community/types";

const EMPTY: SearchResponse = { users: [], tags: [], posts: [] };

/** LIKE-pattern metacharacters in user input must match literally. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

interface UserRow {
  username: string;
  displayName: string;
  avatar: string | null;
  bio: string | null;
}
interface TagRow {
  tag: string;
  count: number;
}
interface PostRow {
  id: string;
  title: string | null;
  body: string;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  username: string;
  authorName: string;
  avatar: string | null;
}

async function runSearch(q: string, viewerId: string | null): Promise<SearchResponse> {
  const like = `%${escapeLike(q)}%`;
  const prefix = `${escapeLike(q)}%`;

  const [users, tags, posts] = await Promise.all([
    // Traders — handle or display name; prefix matches surface first.
    platformDb.all<UserRow>(
      sql`SELECT username, display_name AS displayName, avatar, bio
          FROM profiles
          WHERE (username LIKE ${like} ESCAPE '\\' OR display_name LIKE ${like} ESCAPE '\\')
            AND (${viewerId} IS NULL
                 OR user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ${viewerId}))
          ORDER BY CASE
              WHEN username LIKE ${prefix} ESCAPE '\\' THEN 0
              WHEN display_name LIKE ${prefix} ESCAPE '\\' THEN 1
              ELSE 2 END,
            username
          LIMIT 4`
    ),
    // Topics — tag names with their global post counts (most used first).
    platformDb.all<TagRow>(
      sql`SELECT je.value AS tag, COUNT(*) AS count
          FROM posts, json_each(posts.tags) AS je
          WHERE posts.tags IS NOT NULL AND je.value LIKE ${like} ESCAPE '\\'
          GROUP BY je.value
          ORDER BY count DESC, tag
          LIMIT 4`
    ),
    // Posts — title hits outrank body hits, then engagement, then recency.
    // Block-aware like every feed; intentionally image-free (payload stays tiny).
    platformDb.all<PostRow>(
      sql`SELECT p.id, p.title, p.body,
                 p.like_count AS likeCount, p.comment_count AS commentCount,
                 p.created_at AS createdAt,
                 pr.username, pr.display_name AS authorName, pr.avatar
          FROM posts p JOIN profiles pr ON pr.user_id = p.user_id
          WHERE (p.title LIKE ${like} ESCAPE '\\' OR p.body LIKE ${like} ESCAPE '\\')
            AND (${viewerId} IS NULL
                 OR p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ${viewerId}))
          ORDER BY CASE WHEN p.title LIKE ${like} ESCAPE '\\' THEN 0 ELSE 1 END,
            (p.like_count + p.comment_count) DESC,
            p.created_at DESC
          LIMIT 5`
    ),
  ]);

  return {
    users: users.map((u) => ({
      username: u.username,
      displayName: u.displayName,
      avatar: u.avatar,
      bio: u.bio,
    })),
    tags: tags.map((t) => ({ tag: String(t.tag), count: Number(t.count) })),
    posts: posts.map((p) => ({
      id: p.id,
      title: p.title,
      snippet: searchSnippet(p.body, q),
      likeCount: Number(p.likeCount),
      commentCount: Number(p.commentCount),
      createdAt: p.createdAt,
      author: { username: p.username, displayName: p.authorName, avatar: p.avatar },
    })),
  };
}

/**
 * Unified typeahead behind the header search — traders, topics and posts in
 * one round trip. Public like the feed; viewer-specific only through blocks,
 * so anonymous lookups share a short in-memory cache.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("q") ?? "";
  const q = raw.trim().slice(0, SEARCH_MAX_CHARS);
  if (q.length < SEARCH_MIN_CHARS) return NextResponse.json(EMPTY);

  const session = await getSession();
  // Generous for a 250ms-debounced typeahead, hostile to scrapers. Signed-in
  // users get a roomier budget; anonymous scrapers are held to 20/10s.
  const { allowed } = session
    ? await rateLimit(`search:${session.user.id}`, 40, 10)
    : await rateLimit(`search:ip:${clientIp(req)}`, 20, 10);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  try {
    const viewerId = session?.user.id ?? null;
    const results = viewerId
      ? await runSearch(q, viewerId)
      : await cached(`search:v1:${q.toLowerCase()}`, 30_000, () => runSearch(q, null));
    return NextResponse.json(results);
  } catch {
    return NextResponse.json(EMPTY); // typeahead must degrade, never 500
  }
}
