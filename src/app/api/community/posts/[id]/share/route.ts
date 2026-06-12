import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { posts } from "@/server/db/platform-schema";
import { getSession } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";

/**
 * Records a share (native share sheet or copy-link). Counter-only — shares are
 * anonymous by design, so signed-out readers count too (rate-limited per IP).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const session = await getSession();
  const ip = (req.headers.get("x-forwarded-for") ?? "anon").split(",")[0]!.trim();
  const key = session ? `share:${session.user.id}` : `share:ip:${ip}`;
  const { allowed } = await rateLimit(key, 30, 3600);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const post = await platformDb.select({ id: posts.id }).from(posts).where(eq(posts.id, id)).get();
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  await platformDb
    .update(posts)
    .set({ shareCount: sql`${posts.shareCount} + 1` })
    .where(eq(posts.id, id));
  const updated = await platformDb
    .select({ shareCount: posts.shareCount })
    .from(posts)
    .where(eq(posts.id, id))
    .get();
  return NextResponse.json({ shareCount: updated?.shareCount ?? 0 });
}
