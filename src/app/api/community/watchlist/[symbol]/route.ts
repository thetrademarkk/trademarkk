import { NextResponse } from "next/server";
import { ensureProfile, getSession, toggleWatchSymbol } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";

/**
 * Toggles watching a symbol. Block-irrelevant (a symbol isn't a user). A
 * dedicated `watch:` limiter at the same generous 30/h ceiling as the follow
 * family — own key so a quick watch add/remove burst can't starve (or be
 * starved by) the user's tag/trader follow budget.
 */
export async function POST(req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { symbol } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to watch symbols" }, { status: 401 });

  const { allowed } = await rateLimit(`watch:${session.user.id}`, 30, 3600);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  await ensureProfile(session.user.id, session.user.name);
  const result = await toggleWatchSymbol(session.user.id, decodeURIComponent(symbol));
  if (!result) return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  return NextResponse.json(result);
}
