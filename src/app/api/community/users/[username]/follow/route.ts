import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { follows, profiles } from "@/server/db/platform-schema";
import { ensureProfile, getSession, notify } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";

/** Toggles following a user. */
export async function POST(req: Request, ctx: { params: Promise<{ username: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { username } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to follow traders" }, { status: 401 });

  const { allowed } = await rateLimit(`follow:${session.user.id}`, 10, 3600);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const target = await platformDb
    .select()
    .from(profiles)
    .where(eq(profiles.username, username.toLowerCase()))
    .get();
  if (!target) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  if (target.userId === session.user.id)
    return NextResponse.json({ error: "You can't follow yourself" }, { status: 400 });
  await ensureProfile(session.user.id, session.user.name);

  const existing = await platformDb
    .select()
    .from(follows)
    .where(and(eq(follows.followerId, session.user.id), eq(follows.followingId, target.userId)))
    .get();

  if (existing) {
    await platformDb
      .delete(follows)
      .where(and(eq(follows.followerId, session.user.id), eq(follows.followingId, target.userId)));
    return NextResponse.json({ following: false });
  }
  await platformDb.insert(follows).values({
    followerId: session.user.id,
    followingId: target.userId,
    createdAt: new Date().toISOString(),
  });
  await notify({ userId: target.userId, actorId: session.user.id, type: "follow" });
  return NextResponse.json({ following: true });
}
