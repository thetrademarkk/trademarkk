import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { blogSubmissions, profiles, user } from "@/server/db/platform-schema";
import { getSession } from "@/server/community";
import { isAdmin } from "@/server/blog";

/** Admin: list submissions by status (default pending). */
export async function GET(req: Request) {
  const session = await getSession();
  if (!isAdmin(session?.user.email))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const raw = new URL(req.url).searchParams.get("status") ?? "pending";
  const status = ["pending", "approved", "rejected"].includes(raw) ? raw : "pending";
  const rows = await platformDb
    .select()
    .from(blogSubmissions)
    .where(eq(blogSubmissions.status, status))
    .orderBy(desc(blogSubmissions.createdAt))
    .limit(200);

  const authorIds = [...new Set(rows.map((r) => r.authorId))];
  const [people, handles] = authorIds.length
    ? await Promise.all([
        platformDb.select().from(user).where(inArray(user.id, authorIds)),
        platformDb.select().from(profiles).where(inArray(profiles.userId, authorIds)),
      ])
    : [[], []];
  const nameMap = new Map(people.map((u) => [u.id, u.name]));
  const handleMap = new Map(handles.map((p) => [p.userId, p.username]));

  return NextResponse.json({
    submissions: rows.map((r) => ({
      id: r.id,
      title: r.title,
      excerpt: r.excerpt,
      contentHtml: r.contentHtml,
      status: r.status,
      createdAt: r.createdAt,
      authorName: nameMap.get(r.authorId) ?? "Unknown",
      authorHandle: handleMap.get(r.authorId) ?? null,
    })),
  });
}
