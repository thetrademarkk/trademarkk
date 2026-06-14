import { NextResponse } from "next/server";
import { ensureProfile, getSession, toggleFollowTag } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";

/**
 * Toggles following a tag. Block-irrelevant (tags aren't users). Reuses the
 * follow rate-limit (10/h) — the same generous ceiling as following a trader.
 */
export async function POST(req: Request, ctx: { params: Promise<{ tag: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tag } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to follow tags" }, { status: 401 });

  const { allowed } = await rateLimit(`follow:${session.user.id}`, 10, 3600);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  await ensureProfile(session.user.id, session.user.name);
  const result = await toggleFollowTag(session.user.id, decodeURIComponent(tag));
  if (!result) return NextResponse.json({ error: "Invalid tag" }, { status: 400 });
  return NextResponse.json(result);
}
