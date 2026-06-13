import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { getSession } from "@/server/community";
import { cached } from "@/server/cache";
import { rateLimit } from "@/server/rate-limit";
import { SUGGESTED_TAGS } from "@/features/community/types";

/** LIKE-pattern metacharacters in user input must match literally. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const LIMIT = 8;

interface UserRow {
  username: string;
  displayName: string;
  avatar: string | null;
}
interface TagRow {
  tag: string;
  count: number;
}

export interface AutocompleteUser {
  username: string;
  displayName: string;
  avatar: string | null;
}
export interface AutocompleteTag {
  tag: string;
  count: number;
}

/** Block-aware @mention suggestions — username/displayName prefix, viewer's blockers excluded. */
async function suggestUsers(q: string, viewerId: string | null): Promise<AutocompleteUser[]> {
  const prefix = `${escapeLike(q)}%`;
  const rows = await platformDb.all<UserRow>(
    sql`SELECT username, display_name AS displayName, avatar
        FROM profiles
        WHERE (username LIKE ${prefix} ESCAPE '\\' OR display_name LIKE ${prefix} ESCAPE '\\')
          AND (${viewerId} IS NULL
               OR user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ${viewerId})
               -- exclude users who blocked the viewer (they shouldn't be reachable)
               AND user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ${viewerId}))
        ORDER BY CASE WHEN username LIKE ${prefix} ESCAPE '\\' THEN 0 ELSE 1 END, username
        LIMIT ${LIMIT}`
  );
  return rows.map((u) => ({ username: u.username, displayName: u.displayName, avatar: u.avatar }));
}

/**
 * #hashtag suggestions — existing post tags by prefix with their post counts,
 * merged with the curated SUGGESTED_TAGS so common topics surface before
 * anyone has used them. Counts come from posts.tags; suggested-only tags get 0.
 */
async function suggestTags(q: string): Promise<AutocompleteTag[]> {
  const prefix = `${escapeLike(q)}%`;
  const rows = await platformDb.all<TagRow>(
    sql`SELECT je.value AS tag, COUNT(*) AS count
        FROM posts, json_each(posts.tags) AS je
        WHERE posts.tags IS NOT NULL AND je.value LIKE ${prefix} ESCAPE '\\'
        GROUP BY je.value
        ORDER BY count DESC, tag
        LIMIT ${LIMIT}`
  );
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(String(r.tag), Number(r.count));
  // Fold in curated tags that match the prefix and aren't already present.
  for (const t of SUGGESTED_TAGS) {
    if (seen.size >= LIMIT) break;
    if (t.startsWith(q) && !seen.has(t)) seen.set(t, 0);
  }
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, LIMIT)
    .map(([tag, count]) => ({ tag, count }));
}

/**
 * Composer typeahead endpoint — `kind=user|tag`, `q=` prefix.
 *
 * $cashtags resolve entirely client-side from the curated symbol list, so they
 * never hit this route. Public like the feed; viewer-specific only through
 * blocks, so anonymous user/tag lookups share a short in-memory cache.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 20).toLowerCase();
  if (kind !== "user" && kind !== "tag") {
    return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
  }

  const session = await getSession();
  const ip = (req.headers.get("x-forwarded-for") ?? "anon").split(",")[0]!.trim();
  // Generous for a 200ms-debounced typeahead, hostile to scrapers.
  const { allowed } = await rateLimit(session ? `ac:${session.user.id}` : `ac:ip:${ip}`, 60, 10);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  try {
    if (kind === "tag") {
      // Tags are public — cache anonymously for everyone (no viewer dimension).
      const tags = await cached(`ac:tag:${q}`, 30_000, () => suggestTags(q));
      return NextResponse.json({ tags });
    }
    const viewerId = session?.user.id ?? null;
    // Users carry a block dimension for signed-in viewers — only cache the anon path.
    const users = viewerId
      ? await suggestUsers(q, viewerId)
      : await cached(`ac:user:${q}`, 30_000, () => suggestUsers(q, null));
    return NextResponse.json({ users });
  } catch {
    // Typeahead must degrade silently, never 500.
    return NextResponse.json(kind === "tag" ? { tags: [] } : { users: [] });
  }
}
