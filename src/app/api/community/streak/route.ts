import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { profiles } from "@/server/db/platform-schema";
import { ensureProfile, getSession } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";
import { shareStreakSchema } from "@/features/community/schemas";

/**
 * Opt-in streak publishing. Streaks live in the user's own journal DB (private
 * by design) — the client computes them and publishes here only by choice.
 */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Sign in to share your streak" }, { status: 401 });

  const { allowed } = await rateLimit(`streak:${session.user.id}`, 30, 3600);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = shareStreakSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid streak" }, { status: 400 });

  await ensureProfile(session.user.id, session.user.name);
  await platformDb
    .update(profiles)
    .set({
      shareStreak: parsed.data.share ? 1 : 0,
      streakCurrent: parsed.data.share ? parsed.data.current : 0,
      streakBest: parsed.data.share ? parsed.data.best : 0,
      streakUpdatedAt: new Date().toISOString(),
    })
    .where(eq(profiles.userId, session.user.id));
  return NextResponse.json({ shared: parsed.data.share });
}
