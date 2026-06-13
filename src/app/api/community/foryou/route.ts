import { NextResponse } from "next/server";
import { getSession, queryForYou } from "@/server/community";

/**
 * The signed-in viewer's "For You" interest feed — recent posts re-ranked by a
 * transparent interest score (engaged tags/symbols + followed & 2nd-degree
 * authors + a recency-decayed global hot-score prior; see foryou.ts). Cold-start
 * viewers fall back to the global Top feed. Viewer-personalized, so never cached.
 * Signed-out callers get the global Top feed (anonymous) so the tab still paints.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    // No viewer to personalize for — degrade to the same shape as the cold-start
    // fallback by returning an empty page; the client surfaces the Latest/Top
    // tabs instead. (For-You is a signed-in tab.)
    return NextResponse.json({ posts: [], nextCursor: null });
  }
  return NextResponse.json(await queryForYou(session.user.id));
}
