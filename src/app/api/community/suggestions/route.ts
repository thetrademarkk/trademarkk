import { NextResponse } from "next/server";
import { getSession, getStarterSuggestions } from "@/server/community";

/**
 * Cold-start "starter follows" suggestions for a low-signal viewer: a few seed
 * tags (from trending + curated) and popular authors (from the leaderboard) to
 * follow so their For-You / Following feeds aren't empty. Returns `show:false`
 * for a well-connected viewer. Signed-out callers get a hidden surface.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ show: false, tags: [], authors: [] });
  return NextResponse.json(await getStarterSuggestions(session.user.id));
}
