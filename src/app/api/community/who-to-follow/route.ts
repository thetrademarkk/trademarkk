import { NextResponse } from "next/server";
import { getSession, queryFollowSuggestions } from "@/server/community";
import { rateLimit } from "@/server/rate-limit";

/**
 * "Who to follow" — relevant, non-spammy follow recommendations for the signed-in
 * viewer (2nd-degree mutuals + shared followed-tags/watched-symbols + recent
 * genuine activity, with community standing as a bounded tie-break; see
 * features/community/follow-suggestions.ts). A cold-start viewer with no signals
 * gets popular recent contributors. Viewer-personalized → never cached. Signed-
 * out callers get a hidden surface (this is a signed-in discovery rail).
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ show: false, suggestions: [] });
  // queryFollowSuggestions is uncached and recomputed per request — modest
  // per-user cap, mirroring the leaderboard route's anti-abuse precedent.
  const { allowed } = await rateLimit(`who-to-follow:${session.user.id}`, 60, 60);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  return NextResponse.json(await queryFollowSuggestions(session.user.id));
}
