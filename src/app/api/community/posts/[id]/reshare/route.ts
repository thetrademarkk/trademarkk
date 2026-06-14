import { NextResponse } from "next/server";
import { ensureProfile, createReshare, getSession } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";
import { invalidateCached } from "@/server/cache";
import { createReshareSchema } from "@/features/community/schemas";
import { isUserBanned } from "@/server/moderation";

/**
 * Reshare (empty body) or quote (with commentary) the post `[id]`.
 *
 * Body: `{ body?: string }` — empty/omitted = a plain reshare, non-empty = a
 * quote. The path id is the target; the server collapses a reshare-of-a-reshare
 * to the root original, is block-aware both ways, allows resharing your own
 * post, bumps the original's reshare_count and notifies the original author.
 * Dedicated 30/h rate limit.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to reshare" }, { status: 401 });
  // Suspended accounts cannot create content (clear 403; existing content stays).
  if (await isUserBanned(session.user.id))
    return NextResponse.json(
      { error: "Your account is suspended and cannot post or comment." },
      { status: 403 }
    );

  const { allowed } = await rateLimit(`reshare:${session.user.id}`, 30, 3600);
  if (!allowed)
    return NextResponse.json({ error: "Resharing too fast — try later" }, { status: 429 });

  const parsed = createReshareSchema.safeParse({
    targetId: id,
    ...((await req.json().catch(() => ({}))) as Record<string, unknown>),
  });
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid reshare" },
      { status: 400 }
    );

  await ensureProfile(session.user.id, session.user.name);
  const result = await createReshare(session.user.id, id, parsed.data.body);
  if (!result) return NextResponse.json({ error: "That post isn't available" }, { status: 404 });

  invalidateCached("feed:"); // the new reshare must appear for anonymous readers
  return NextResponse.json(
    { id: result.id, rootId: result.rootId, quote: result.quote },
    { status: 201 }
  );
}
