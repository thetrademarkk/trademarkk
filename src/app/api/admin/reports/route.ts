import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { commentLikes, comments, posts, profiles, reports } from "@/server/db/platform-schema";
import { deletePostCascade, getSession } from "@/server/community";
import { isAdmin } from "@/server/blog";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";

/** Admin: report queue with a preview of the reported content. */
export async function GET() {
  const session = await getSession();
  if (!isAdmin(session?.user.email))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { allowed } = await rateLimit(`admin:${session!.user.id}`, 60, 60);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const rows = await platformDb.select().from(reports).orderBy(desc(reports.createdAt)).limit(100);
  const postIds = rows.filter((r) => r.targetType === "post").map((r) => r.targetId);
  const commentIds = rows.filter((r) => r.targetType === "comment").map((r) => r.targetId);
  const reporterIds = [...new Set(rows.map((r) => r.reporterId))];

  const [targetPosts, targetComments, reporters] = await Promise.all([
    postIds.length
      ? platformDb.select().from(posts).where(inArray(posts.id, postIds))
      : Promise.resolve([]),
    commentIds.length
      ? platformDb.select().from(comments).where(inArray(comments.id, commentIds))
      : Promise.resolve([]),
    reporterIds.length
      ? platformDb.select().from(profiles).where(inArray(profiles.userId, reporterIds))
      : Promise.resolve([]),
  ]);
  const postMap = new Map(targetPosts.map((p) => [p.id, p]));
  const commentMap = new Map(targetComments.map((c) => [c.id, c]));
  const reporterMap = new Map(reporters.map((p) => [p.userId, p.username]));

  // Auto-flagged posts (the content-quality gate's soft `quality_flag`) the
  // community hasn't reported yet — surfaced so the moderation queue can review
  // borderline tip/all-caps posts proactively (rank-14 consumes this). Newest
  // first, capped; the author handle rides along for context. Posts ALSO present
  // in the report list above are excluded (no double entry).
  const reportedPostIds = new Set(postIds);
  const flaggedRows = await platformDb
    .select({
      id: posts.id,
      userId: posts.userId,
      title: posts.title,
      body: posts.body,
      qualityFlag: posts.qualityFlag,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .where(isNotNull(posts.qualityFlag))
    .orderBy(desc(posts.createdAt))
    .limit(50);
  const flaggedAuthorIds = [...new Set(flaggedRows.map((p) => p.userId))];
  const flaggedAuthors = flaggedAuthorIds.length
    ? await platformDb.select().from(profiles).where(inArray(profiles.userId, flaggedAuthorIds))
    : [];
  const flaggedAuthorMap = new Map(flaggedAuthors.map((p) => [p.userId, p.username]));

  return NextResponse.json({
    flagged: flaggedRows
      .filter((p) => !reportedPostIds.has(p.id))
      .map((p) => ({
        id: p.id,
        flag: p.qualityFlag,
        createdAt: p.createdAt,
        author: flaggedAuthorMap.get(p.userId) ?? "unknown",
        preview: (p.title ? `${p.title} — ` : "") + p.body.slice(0, 160),
      })),
    reports: rows.map((r) => {
      const target = r.targetType === "post" ? postMap.get(r.targetId) : commentMap.get(r.targetId);
      return {
        id: r.id,
        targetType: r.targetType,
        targetId: r.targetId,
        reason: r.reason,
        createdAt: r.createdAt,
        reporter: reporterMap.get(r.reporterId) ?? "unknown",
        targetPreview: target
          ? ("title" in target && target.title ? `${target.title} — ` : "") +
            target.body.slice(0, 160)
          : null, // already deleted
        postId: target ? ("postId" in target ? target.postId : target.id) : null,
      };
    }),
  });
}

/** Admin: act on a report — dismiss it, or delete the reported content. */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await getSession();
  if (!isAdmin(session?.user.email))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { allowed } = await rateLimit(`admin:${session!.user.id}`, 60, 60);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = z
    .object({ reportId: z.string().min(1).max(40), action: z.enum(["dismiss", "delete-content"]) })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  const body = parsed.data;

  const report = await platformDb.select().from(reports).where(eq(reports.id, body.reportId)).get();
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  if (body.action === "delete-content") {
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
  }
  await platformDb.delete(reports).where(eq(reports.id, body.reportId));
  return NextResponse.json({ done: true });
}
