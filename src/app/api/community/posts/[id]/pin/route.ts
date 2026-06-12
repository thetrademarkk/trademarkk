import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { posts, profiles } from "@/server/db/platform-schema";
import { ensureProfile, getSession } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";

/**
 * Toggles pinning one of YOUR OWN posts to the top of your profile.
 * One pin per profile — pinning a second post replaces the first.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { allowed } = await rateLimit(`pin:${session.user.id}`, 30, 3600);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const post = await platformDb.select().from(posts).where(eq(posts.id, id)).get();
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });
  if (post.userId !== session.user.id)
    return NextResponse.json({ error: "Only the author can pin this" }, { status: 403 });

  const profile = await ensureProfile(session.user.id, session.user.name);
  const pinned = profile!.pinnedPostId !== id; // toggling off when already pinned
  await platformDb
    .update(profiles)
    .set({ pinnedPostId: pinned ? id : null })
    .where(eq(profiles.userId, session.user.id));

  return NextResponse.json({ pinned });
}
