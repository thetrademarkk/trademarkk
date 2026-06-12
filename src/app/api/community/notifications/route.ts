import { NextResponse } from "next/server";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { notifications, profiles } from "@/server/db/platform-schema";
import { getSession } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import type { NotificationView } from "@/features/community/types";

/** The viewer's latest notifications + unread count. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await platformDb
    .select()
    .from(notifications)
    .where(eq(notifications.userId, session.user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(30);

  const actorIds = [...new Set(rows.map((r) => r.actorId))];
  const actors = actorIds.length
    ? await platformDb.select().from(profiles).where(inArray(profiles.userId, actorIds))
    : [];
  const actorMap = new Map(actors.map((a) => [a.userId, a]));

  const unread = await platformDb.get<{ c: number }>(
    sql`SELECT COUNT(*) AS c FROM notifications WHERE user_id = ${session.user.id} AND read = 0`
  );

  const items: NotificationView[] = rows.map((r) => {
    const a = actorMap.get(r.actorId);
    return {
      id: r.id,
      type: r.type as NotificationView["type"],
      actor: a
        ? { username: a.username, displayName: a.displayName, avatar: a.avatar }
        : { username: "deleted", displayName: "Someone" },
      postId: r.postId,
      read: r.read === 1,
      createdAt: r.createdAt,
    };
  });

  return NextResponse.json({ notifications: items, unread: Number(unread?.c ?? 0) });
}

/** Marks all notifications read. */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await platformDb
    .update(notifications)
    .set({ read: 1 })
    .where(eq(notifications.userId, session.user.id));
  return NextResponse.json({ read: true });
}
