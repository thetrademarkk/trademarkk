import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { getSession } from "@/server/community";
import { isAdmin } from "@/server/blog";
import { rateLimit } from "@/server/rate-limit";

/** Admin: whole-platform analytics + latest feedback, from first-party data. */
export async function GET() {
  const session = await getSession();
  if (!isAdmin(session?.user.email))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { allowed } = await rateLimit(`admin:${session!.user.id}`, 60, 60);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const since7 = new Date(Date.now() - 7 * 864e5).toISOString();
  const since14 = new Date(Date.now() - 14 * 864e5).toISOString();
  const one = async (q: ReturnType<typeof sql>) =>
    Number(((await platformDb.get(q)) as { c?: number } | undefined)?.c ?? 0);

  const [
    totalUsers,
    newUsers7d,
    hostedDbs,
    byodUsers,
    posts7d,
    totalPosts,
    totalComments,
    totalLikes,
    blogPending,
    feedbackCount,
    activeUsers7d,
    views7d,
  ] = await Promise.all([
    one(sql`SELECT COUNT(*) AS c FROM user`),
    one(
      sql`SELECT COUNT(*) AS c FROM user WHERE created_at >= ${Math.floor((Date.now() - 7 * 864e5) / 1000)}`
    ),
    one(sql`SELECT COUNT(*) AS c FROM user_databases WHERE storage_mode = 'hosted'`),
    one(sql`SELECT COUNT(*) AS c FROM user_databases WHERE storage_mode = 'byod'`),
    one(sql`SELECT COUNT(*) AS c FROM posts WHERE created_at >= ${since7}`),
    one(sql`SELECT COUNT(*) AS c FROM posts`),
    one(sql`SELECT COUNT(*) AS c FROM comments`),
    one(sql`SELECT COUNT(*) AS c FROM likes`),
    one(sql`SELECT COUNT(*) AS c FROM blog_submissions WHERE status = 'pending'`),
    one(sql`SELECT COUNT(*) AS c FROM feedback`),
    one(
      sql`SELECT COUNT(DISTINCT user_id) AS c FROM page_events WHERE user_id IS NOT NULL AND created_at >= ${since7}`
    ),
    one(sql`SELECT COUNT(*) AS c FROM page_events WHERE created_at >= ${since7}`),
  ]);

  const [recentUsers, topPages, dailyViews, recentFeedback] = await Promise.all([
    platformDb.all(
      sql`SELECT email, name, created_at AS createdAt FROM user ORDER BY created_at DESC LIMIT 10`
    ),
    platformDb.all(
      sql`SELECT path, COUNT(*) AS views FROM page_events WHERE created_at >= ${since7} GROUP BY path ORDER BY views DESC LIMIT 10`
    ),
    platformDb.all(
      sql`SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS views FROM page_events WHERE created_at >= ${since14} GROUP BY day ORDER BY day`
    ),
    platformDb.all(
      sql`SELECT id, category, message, email, path, created_at AS createdAt FROM feedback ORDER BY created_at DESC LIMIT 50`
    ),
  ]);

  return NextResponse.json({
    stats: {
      totalUsers,
      newUsers7d,
      hostedDbs,
      byodUsers,
      totalPosts,
      posts7d,
      totalComments,
      totalLikes,
      blogPending,
      feedbackCount,
      activeUsers7d,
      views7d,
    },
    recentUsers,
    topPages,
    dailyViews,
    feedback: recentFeedback,
  });
}
