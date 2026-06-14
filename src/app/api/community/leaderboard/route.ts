import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { getSession } from "@/server/community";
import { cached } from "@/server/cache";
import { rateLimit } from "@/server/rate-limit";
import { clientIp } from "@/server/client-ip";
import { normalizeTier } from "@/features/community/reputation";
import type { LeaderboardRow } from "@/features/community/types";

/**
 * Community leaderboards.
 * - contrib: posts×4 + comments×2 + likes-received×1 (transparent, server-computed)
 * - streak: opt-in published journal streaks (privacy-first — journals are the
 *   user's own DB; only voluntarily shared numbers appear here)
 */
export async function GET(req: Request) {
  // Light per-IP cap on a cached, public endpoint — enough to deter scraping.
  const { allowed } = await rateLimit(`leaderboard:ip:${clientIp(req)}`, 10, 60);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const board = url.searchParams.get("board") === "streak" ? "streak" : "contrib";
  const period = url.searchParams.get("period") === "all" ? "all" : "month";
  const session = await getSession();
  const me = session?.user.id ?? "";

  if (board === "streak") {
    // Aggregates cached 2 min per instance; "me" personalization stays per-request.
    const rows = await cached("lb:streak", 120_000, () =>
      platformDb.all(
        sql`SELECT user_id AS userId, username, display_name AS displayName, avatar,
                   streak_current AS current, streak_best AS best
            FROM profiles WHERE share_streak = 1 AND streak_best > 0
            ORDER BY streak_current DESC, streak_best DESC LIMIT 50`
      )
    );
    const out: LeaderboardRow[] = (rows as Record<string, unknown>[]).map((r, i) => ({
      rank: i + 1,
      username: String(r.username),
      displayName: String(r.displayName),
      avatar: (r.avatar as string) ?? null,
      current: Number(r.current),
      best: Number(r.best),
      me: r.userId === me,
    }));
    return NextResponse.json({ board, period: "current", rows: out });
  }

  const since = period === "month" ? new Date(Date.now() - 30 * 864e5).toISOString() : "1970";
  const rows = await cached(`lb:contrib:${period}`, 120_000, () =>
    platformDb.all(
      sql`SELECT p.user_id AS userId, p.username, p.display_name AS displayName, p.avatar,
               p.reputation_tier AS reputationTier,
               COALESCE(po.cnt, 0) AS posts,
               COALESCE(co.cnt, 0) AS comments,
               COALESCE(lr.cnt, 0) AS likesReceived,
               COALESCE(po.cnt, 0) * 4 + COALESCE(co.cnt, 0) * 2 + COALESCE(lr.cnt, 0) AS score
        FROM profiles p
        LEFT JOIN (SELECT user_id, COUNT(*) AS cnt FROM posts WHERE created_at >= ${since} GROUP BY user_id) po
          ON po.user_id = p.user_id
        LEFT JOIN (SELECT user_id, COUNT(*) AS cnt FROM comments WHERE created_at >= ${since} GROUP BY user_id) co
          ON co.user_id = p.user_id
        LEFT JOIN (
          SELECT posts.user_id AS user_id, COUNT(*) AS cnt
          FROM likes JOIN posts ON posts.id = likes.post_id
          WHERE likes.created_at >= ${since} GROUP BY posts.user_id
        ) lr ON lr.user_id = p.user_id
        WHERE COALESCE(po.cnt, 0) + COALESCE(co.cnt, 0) + COALESCE(lr.cnt, 0) > 0
        ORDER BY score DESC LIMIT 50`
    )
  );
  const out: LeaderboardRow[] = (rows as Record<string, unknown>[]).map((r, i) => ({
    rank: i + 1,
    username: String(r.username),
    displayName: String(r.displayName),
    avatar: (r.avatar as string) ?? null,
    reputationTier: normalizeTier(r.reputationTier as string | null),
    posts: Number(r.posts),
    comments: Number(r.comments),
    likesReceived: Number(r.likesReceived),
    score: Number(r.score),
    me: r.userId === me,
  }));
  return NextResponse.json({ board, period, rows: out });
}
