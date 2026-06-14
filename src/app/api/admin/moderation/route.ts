import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { commentLikes, comments, posts, reports } from "@/server/db/platform-schema";
import { deletePostCascade, getSession } from "@/server/community";
import { logModAction, queryModQueue, setUserBanned } from "@/server/moderation";
import { isAdmin } from "@/server/blog";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";
import { invalidateCached } from "@/server/cache";
import {
  MOD_ACTIONS,
  type ModSourceFilter,
  type ModStatusFilter,
} from "@/features/community/moderation";

/**
 * Admin moderation queue (rank-14). STRICTLY admin-only — every handler gates on
 * `isAdmin(session.user.email)` and returns 403 otherwise. GET returns the
 * unified queue (user reports + auto-flagged posts) with source/status filters,
 * sort and pagination; POST acts on an item (dismiss, delete-content, clear a
 * false-positive quality flag, ban or unban a user) and logs the action.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!isAdmin(session?.user.email))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { allowed } = await rateLimit(`admin:${session!.user.id}`, 60, 60);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const source = (url.searchParams.get("source") ?? "all") as ModSourceFilter;
  const status = (url.searchParams.get("status") ?? "open") as ModStatusFilter;
  const sort = url.searchParams.get("sort") === "oldest" ? "oldest" : "newest";
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "20");

  const result = await queryModQueue({
    source: ["all", "report", "flag"].includes(source) ? source : "all",
    status: ["open", "actioned", "all"].includes(status) ? status : "open",
    sort,
    page,
    pageSize,
  });
  return NextResponse.json(result);
}

const actionSchema = z.object({
  action: z.enum(MOD_ACTIONS),
  /** A report id (dismiss / delete a reported item) — required for report actions. */
  reportId: z.string().min(1).max(40).optional(),
  /** A post id (clear-flag, or delete an auto-flagged post). */
  postId: z.string().min(1).max(40).optional(),
  /** A user id (ban-user / unban-user). */
  userId: z.string().min(1).max(64).optional(),
});

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await getSession();
  if (!isAdmin(session?.user.email))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { allowed } = await rateLimit(`admin:${session!.user.id}`, 60, 60);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  const { action } = parsed.data;
  const actorId = session!.user.id;

  // ── Ban / unban a user ──────────────────────────────────────────────────
  if (action === "ban-user" || action === "unban-user") {
    if (!parsed.data.userId)
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    const banned = action === "ban-user";
    const ok = await setUserBanned(parsed.data.userId, banned);
    if (!ok) return NextResponse.json({ error: "User not found" }, { status: 404 });
    await logModAction({
      actorId,
      action,
      targetType: "user",
      targetId: parsed.data.userId,
    });
    return NextResponse.json({ done: true });
  }

  // ── Clear a false-positive quality flag (post stays, flag goes) ───────────
  if (action === "clear-flag") {
    if (!parsed.data.postId)
      return NextResponse.json({ error: "postId required" }, { status: 400 });
    const post = await platformDb
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.id, parsed.data.postId))
      .get();
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });
    await platformDb
      .update(posts)
      .set({ qualityFlag: null })
      .where(eq(posts.id, parsed.data.postId));
    await logModAction({
      actorId,
      action,
      targetType: "post",
      targetId: parsed.data.postId,
    });
    invalidateCached("feed:");
    return NextResponse.json({ done: true });
  }

  // ── Dismiss / delete a reported item ──────────────────────────────────────
  if (!parsed.data.reportId)
    return NextResponse.json({ error: "reportId required" }, { status: 400 });
  const report = await platformDb
    .select()
    .from(reports)
    .where(eq(reports.id, parsed.data.reportId))
    .get();
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  if (action === "delete-content") {
    if (report.targetType === "post") {
      await deletePostCascade(report.targetId);
    } else {
      const c = await platformDb
        .select()
        .from(comments)
        .where(eq(comments.id, report.targetId))
        .get();
      if (c) {
        // Remove the comment with its replies + likes, and purge every report
        // targeting any of those comments so the queue can't keep an
        // unactionable row pointing at deleted content.
        const replies = await platformDb
          .select({ id: comments.id })
          .from(comments)
          .where(eq(comments.parentId, c.id));
        const ids = [c.id, ...replies.map((r) => r.id)];
        await platformDb.delete(commentLikes).where(inArray(commentLikes.commentId, ids));
        await platformDb
          .delete(reports)
          .where(and(eq(reports.targetType, "comment"), inArray(reports.targetId, ids)));
        await platformDb.delete(comments).where(inArray(comments.id, ids));
        await platformDb
          .update(posts)
          .set({ commentCount: sql`MAX(0, ${posts.commentCount} - ${ids.length})` })
          .where(eq(posts.id, c.postId));
      }
    }
    // deletePostCascade / the comment branch already purged the underlying
    // report rows; mark any survivor (e.g. a comment-delete that found nothing)
    // actioned so it leaves the open queue.
    await platformDb
      .update(reports)
      .set({ status: "actioned" })
      .where(eq(reports.id, parsed.data.reportId));
    await logModAction({
      actorId,
      action,
      targetType: report.targetType === "comment" ? "comment" : "post",
      targetId: report.targetId,
      detail: parsed.data.reportId,
    });
    invalidateCached("feed:");
    return NextResponse.json({ done: true });
  }

  // dismiss: mark the report actioned (kept for history, leaves the open queue).
  await platformDb
    .update(reports)
    .set({ status: "actioned" })
    .where(eq(reports.id, parsed.data.reportId));
  await logModAction({
    actorId,
    action: "dismiss",
    targetType: "report",
    targetId: parsed.data.reportId,
    detail: report.targetId,
  });
  return NextResponse.json({ done: true });
}
