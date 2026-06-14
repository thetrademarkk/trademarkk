import { NextResponse } from "next/server";
import { and, eq, gte, like } from "drizzle-orm";
import { newId } from "@/lib/id";
import { platformDb } from "@/server/db/platform";
import { comments, posts, reports } from "@/server/db/platform-schema";
import { getSession } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";
import { reportSchema } from "@/features/community/schemas";

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to report" }, { status: 401 });

  const { allowed } = await rateLimit(`report:${session.user.id}`, 10, 3600);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = reportSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid report" }, { status: 400 });

  // Resolve the target so we never queue a report for content that doesn't
  // exist (or whose kind was spoofed: a comment id sent as targetType "post").
  // zod only constrains the SHAPE — it can't know whether the id is real.
  const target =
    parsed.data.targetType === "post"
      ? await platformDb
          .select({ authorId: posts.userId })
          .from(posts)
          .where(eq(posts.id, parsed.data.targetId))
          .get()
      : await platformDb
          .select({ authorId: comments.userId })
          .from(comments)
          .where(eq(comments.id, parsed.data.targetId))
          .get();
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // You can't report your own content.
  if (target.authorId === session.user.id)
    return NextResponse.json({ error: "Can't report your own content" }, { status: 403 });

  // De-dupe: the same reporter reporting the same target for the same reason
  // within 24h is idempotent — don't pile identical rows into the admin queue.
  // (reason is stored as "<reason>" or "<reason>: <note>", so match the prefix.)
  const since24h = new Date(Date.now() - 86_400_000).toISOString();
  const dup = await platformDb
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.reporterId, session.user.id),
        eq(reports.targetType, parsed.data.targetType),
        eq(reports.targetId, parsed.data.targetId),
        like(reports.reason, `${parsed.data.reason}%`),
        gte(reports.createdAt, since24h)
      )
    )
    .get();
  if (dup) return NextResponse.json({ reported: true, deduped: true }, { status: 200 });

  await platformDb.insert(reports).values({
    id: newId(),
    reporterId: session.user.id,
    targetType: parsed.data.targetType,
    targetId: parsed.data.targetId,
    reason: `${parsed.data.reason}${parsed.data.note ? `: ${parsed.data.note}` : ""}`,
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ reported: true }, { status: 201 });
}
