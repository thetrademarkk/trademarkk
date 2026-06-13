import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { cached } from "@/server/cache";
import { rateLimit } from "@/server/rate-limit";
import { clientIp } from "@/server/client-ip";
import { shapePublicStats, type PublicStats } from "@/lib/public-stats";

/**
 * Public platform metrics for the landing page. No auth — aggregates only,
 * zero PII. Honest by construction: only numbers the platform DB can see
 * (per-user journals are not centrally readable, so no trade counts).
 * Cheap by construction: in-memory cache (10 min) + CDN s-maxage, so even a
 * traffic spike costs at most one DB round-trip per instance per 10 minutes.
 */
export async function GET(req: Request) {
  // The result is heavily cached, so a light per-IP cap is enough to keep a
  // scraper from churning cold-cache DB round-trips.
  const { allowed } = await rateLimit(`pubstats:ip:${clientIp(req)}`, 5, 60);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let stats: PublicStats;
  try {
    stats = await cached("public:stats", 600_000, async () => {
      const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
      const one = async (q: ReturnType<typeof sql>) =>
        Number(((await platformDb.get(q)) as { c?: number } | undefined)?.c ?? 0);
      const [traders, active30d, posts, longestStreak] = await Promise.all([
        one(sql`SELECT COUNT(*) AS c FROM user`),
        one(
          sql`SELECT COUNT(DISTINCT user_id) AS c FROM page_events
              WHERE user_id IS NOT NULL AND created_at >= ${since30}`
        ),
        one(sql`SELECT COUNT(*) AS c FROM posts`),
        one(sql`SELECT COALESCE(MAX(streak_best), 0) AS c FROM profiles WHERE share_streak = 1`),
      ]);
      return shapePublicStats({ traders, active30d, posts, longestStreak });
    });
  } catch {
    // Never cache a failure at the CDN; the landing strip degrades gracefully.
    return NextResponse.json(
      { error: "stats unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.json(stats, {
    headers: {
      "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400",
    },
  });
}
