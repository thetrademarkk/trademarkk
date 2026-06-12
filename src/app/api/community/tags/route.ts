import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { cached } from "@/server/cache";

/**
 * Trending topics — tag usage over the last 7 days. Viewer-independent, so it
 * caches at two layers: in-memory (warm instance) + CDN s-maxage. One DB scan
 * per 5 minutes globally instead of one per community visitor.
 */
export async function GET() {
  try {
    const rows = await cached("tags:trending", 5 * 60_000, async () => {
      const since = new Date(Date.now() - 7 * 864e5).toISOString();
      return platformDb.all(
        sql`SELECT je.value AS tag, COUNT(*) AS count
            FROM posts, json_each(posts.tags) AS je
            WHERE posts.created_at >= ${since} AND posts.tags IS NOT NULL
            GROUP BY je.value ORDER BY count DESC LIMIT 8`
      );
    });
    return NextResponse.json(
      { tags: rows },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
    );
  } catch {
    return NextResponse.json({ tags: [] });
  }
}
