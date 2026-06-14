import { NextResponse } from "next/server";
import { getSession, getStarterSuggestions } from "@/server/community";
import { rateLimit } from "@/server/rate-limit";

/**
 * Cold-start "starter follows" suggestions for a low-signal viewer: a few seed
 * tags (from trending + curated) and popular authors (from the leaderboard) to
 * follow so their For-You / Following feeds aren't empty. Returns `show:false`
 * for a well-connected viewer. Signed-out callers get a hidden surface.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ show: false, tags: [], authors: [] });
  // getStarterSuggestions is uncached and recomputed per request — modest
  // per-user cap, mirroring the leaderboard route's anti-abuse precedent.
  const { allowed } = await rateLimit(`suggestions:${session.user.id}`, 60, 60);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  return NextResponse.json(await getStarterSuggestions(session.user.id));
}
