import "server-only";

import { sql } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { cached } from "@/server/cache";
import {
  fillDailySeries,
  fillDailyViews,
  shapePulseTotals,
  summarizeVitals,
  safeCount,
  type PulseData,
} from "@/lib/pulse-stats";

/**
 * Aggregates for the public /pulse page. Aggregates only, zero PII — paths in
 * "top pages" are already normalized at write time (/u/* and /post/*). Cached
 * 10 minutes per instance via cached(); the page itself is ISR'd so the CDN
 * absorbs the traffic.
 */
export async function getPulseData(): Promise<PulseData> {
  return cached("public:pulse", 600_000, async () => {
    const now = new Date();
    const iso7 = new Date(now.getTime() - 7 * 864e5).toISOString();
    const iso30 = new Date(now.getTime() - 30 * 864e5).toISOString();
    const unix7 = Math.floor((now.getTime() - 7 * 864e5) / 1000);
    const unix30 = Math.floor((now.getTime() - 30 * 864e5) / 1000);

    const one = async (q: ReturnType<typeof sql>) =>
      Number(((await platformDb.get(q)) as { c?: number } | undefined)?.c ?? 0);

    const [
      traders,
      traders7d,
      active7d,
      active30d,
      posts,
      posts7d,
      comments,
      likes,
      views30d,
      longestStreak,
    ] = await Promise.all([
      one(sql`SELECT COUNT(*) AS c FROM user`),
      one(sql`SELECT COUNT(*) AS c FROM user WHERE created_at >= ${unix7}`),
      one(
        sql`SELECT COUNT(DISTINCT user_id) AS c FROM page_events
            WHERE user_id IS NOT NULL AND created_at >= ${iso7}`
      ),
      one(
        sql`SELECT COUNT(DISTINCT user_id) AS c FROM page_events
            WHERE user_id IS NOT NULL AND created_at >= ${iso30}`
      ),
      one(sql`SELECT COUNT(*) AS c FROM posts`),
      one(sql`SELECT COUNT(*) AS c FROM posts WHERE created_at >= ${iso7}`),
      one(sql`SELECT COUNT(*) AS c FROM comments`),
      one(sql`SELECT COUNT(*) AS c FROM likes`),
      one(sql`SELECT COUNT(*) AS c FROM page_events WHERE created_at >= ${iso30}`),
      one(sql`SELECT COALESCE(MAX(streak_best), 0) AS c FROM profiles WHERE share_streak = 1`),
    ]);

    const [signupRows, viewRows, postRows, topPageRows, vitalRows] = await Promise.all([
      platformDb.all(
        sql`SELECT date(created_at, 'unixepoch') AS day, COUNT(*) AS count
            FROM user WHERE created_at >= ${unix30} GROUP BY day`
      ) as Promise<{ day: string; count: number }[]>,
      platformDb.all(
        sql`SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS views,
                   COUNT(DISTINCT user_id) AS actives
            FROM page_events WHERE created_at >= ${iso30} GROUP BY day`
      ) as Promise<{ day: string; views: number; actives: number }[]>,
      platformDb.all(
        sql`SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
            FROM posts WHERE created_at >= ${iso30} GROUP BY day`
      ) as Promise<{ day: string; count: number }[]>,
      platformDb.all(
        sql`SELECT path, COUNT(*) AS views FROM page_events
            WHERE created_at >= ${iso7} GROUP BY path ORDER BY views DESC LIMIT 8`
      ) as Promise<{ path: string; views: number }[]>,
      // Newest 5000 samples keep the scan bounded; P75 is computed in JS.
      platformDb.all(
        sql`SELECT metric, value FROM web_vitals
            WHERE created_at >= ${iso30} ORDER BY created_at DESC LIMIT 5000`
      ) as Promise<{ metric: string; value: number }[]>,
    ]);

    const samplesByMetric: Record<string, number[]> = {};
    for (const row of vitalRows) {
      (samplesByMetric[row.metric] ??= []).push(Number(row.value));
    }

    return {
      totals: shapePulseTotals({
        traders,
        traders7d,
        active7d,
        active30d,
        posts,
        posts7d,
        comments,
        likes,
        views30d,
        longestStreak,
      }),
      signupsDaily: fillDailySeries(signupRows, 30, now),
      viewsDaily: fillDailyViews(viewRows, 30, now),
      postsDaily: fillDailySeries(postRows, 30, now),
      topPages: topPageRows
        .filter((r) => typeof r.path === "string")
        .map((r) => ({ path: r.path.slice(0, 80), views: safeCount(r.views) })),
      vitals: summarizeVitals(samplesByMetric),
      generatedAt: now.toISOString(),
    };
  });
}
