import { NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { comments, posts, profiles, reports } from "@/server/db/platform-schema";
import { deletePostCascade, getSession } from "@/server/community";
import { isAdmin } from "@/server/blog";
import { isAllowedOrigin } from "@/server/origin-check";

/** Admin: report queue with a preview of the reported content. */
export async function GET() {
  const session = await getSession();
  if (!isAdmin(session?.user.email))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  return NextResponse.json({
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
        await platformDb.delete(comments).where(eq(comments.id, report.targetId));
        await platformDb
          .update(posts)
          .set({ commentCount: sql`MAX(0, ${posts.commentCount} - 1)` })
          .where(eq(posts.id, c.postId));
      }
    }
  }
  await platformDb.delete(reports).where(eq(reports.id, body.reportId));
  return NextResponse.json({ done: true });
}
