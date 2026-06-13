import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { likes, posts } from "@/server/db/platform-schema";
import { ensureProfile, getSession, notify } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";
import {
  applyReaction,
  isReactionKind,
  normalizeReaction,
  resolveReactionCounts,
  serializeReactionCounts,
  totalReactions,
  type ReactionKind,
} from "@/features/community/reactions";

/**
 * Adds / switches / removes the viewer's reaction on a post.
 *
 * Body: `{ reaction?: "like"|"insightful"|"respect"|"celebrate" }`. A missing
 * or unknown reaction defaults to `like` (keeps the old binary-like clients
 * working). Clicking the reaction you already have removes it; a different one
 * switches in place (total unchanged). `posts.likeCount` stays the TOTAL across
 * all kinds; `posts.reactions` holds the denormalized per-kind breakdown.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to react to posts" }, { status: 401 });

  const { allowed } = await rateLimit(`like:${session.user.id}`, 60, 3600);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { reaction?: unknown };
  const clicked: ReactionKind = isReactionKind(body.reaction) ? body.reaction : "like";

  const post = await platformDb
    .select({ id: posts.id, userId: posts.userId, reactions: posts.reactions })
    .from(posts)
    .where(eq(posts.id, id))
    .get();
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });
  await ensureProfile(session.user.id, session.user.name);

  const existing = await platformDb
    .select()
    .from(likes)
    .where(and(eq(likes.postId, id), eq(likes.userId, session.user.id)))
    .get();
  const current = existing ? normalizeReaction(existing.reaction) : null;

  // Authoritative count of THIS post's reactions, back-filled from likeCount for
  // legacy posts that predate the denormalized breakdown.
  const countRow = await platformDb
    .select({ likeCount: posts.likeCount })
    .from(posts)
    .where(eq(posts.id, id))
    .get();
  const before = resolveReactionCounts(post.reactions, countRow?.likeCount ?? 0);

  const { counts, next } = applyReaction(before, current, clicked);
  const now = new Date().toISOString();

  if (next === null) {
    // remove
    await platformDb
      .delete(likes)
      .where(and(eq(likes.postId, id), eq(likes.userId, session.user.id)));
  } else {
    // add or switch — upsert so a stale/concurrent row can never 500 on the
    // (post_id, user_id) unique key. On insert we also notify the author.
    await platformDb
      .insert(likes)
      .values({ postId: id, userId: session.user.id, reaction: next, createdAt: now })
      .onConflictDoUpdate({
        target: [likes.postId, likes.userId],
        set: { reaction: next },
      });
    if (current === null)
      await notify({ userId: post.userId, actorId: session.user.id, type: "like", postId: id });
  }

  const total = totalReactions(counts);
  await platformDb
    .update(posts)
    .set({ likeCount: total, reactions: serializeReactionCounts(counts) })
    .where(eq(posts.id, id));

  return NextResponse.json({
    liked: next !== null,
    reaction: next,
    likeCount: total,
    reactionCounts: counts,
  });
}
