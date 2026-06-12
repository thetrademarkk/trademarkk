import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { profiles } from "@/server/db/platform-schema";
import { ensureProfile, getSession, isReservedUsername } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";
import { updateProfileSchema } from "@/features/community/schemas";

/** The signed-in user's own community profile (creates it on first call). */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const profile = await ensureProfile(session.user.id, session.user.name);
  return NextResponse.json({
    username: profile!.username,
    displayName: profile!.displayName,
    bio: profile!.bio,
    website: profile!.website,
    avatar: profile!.avatar,
    accent: profile!.accentColor,
    shareStreak: profile!.shareStreak === 1,
  });
}

export async function PUT(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { allowed } = await rateLimit(`profile:${session.user.id}`, 20, 3600);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = updateProfileSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid profile" },
      { status: 400 }
    );
  }
  const input = parsed.data;
  await ensureProfile(session.user.id, session.user.name);

  if (input.username) {
    if (isReservedUsername(input.username))
      return NextResponse.json({ error: "That username is reserved" }, { status: 409 });
    const taken = await platformDb
      .select({ userId: profiles.userId })
      .from(profiles)
      .where(eq(profiles.username, input.username))
      .get();
    if (taken && taken.userId !== session.user.id)
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
  }

  await platformDb
    .update(profiles)
    .set({
      ...(input.username ? { username: input.username } : {}),
      ...(input.displayName ? { displayName: input.displayName.trim() } : {}),
      ...(input.bio !== undefined ? { bio: input.bio.trim() || null } : {}),
      ...(input.website !== undefined ? { website: input.website.trim() || null } : {}),
      ...(input.avatar !== undefined ? { avatar: input.avatar || null } : {}),
      ...(input.accent !== undefined ? { accentColor: input.accent || null } : {}),
    })
    .where(eq(profiles.userId, session.user.id));

  return NextResponse.json({ updated: true });
}
