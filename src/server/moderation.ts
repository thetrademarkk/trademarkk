import "server-only";
import { desc, eq, inArray, isNotNull } from "drizzle-orm";
import { newId } from "@/lib/id";
import { platformDb } from "./db/platform";
import { comments, modActions, posts, profiles, reports, user } from "./db/platform-schema";
import {
  buildModQueue,
  buildPreview,
  countOpen,
  splitReason,
  type ModAction,
  type ModQueueItem,
  type ModQueueQuery,
} from "@/features/community/moderation";

/** True when the user is currently suspended/banned (status = 'banned'). */
export async function isUserBanned(userId: string): Promise<boolean> {
  const row = await platformDb
    .select({ status: user.status })
    .from(user)
    .where(eq(user.id, userId))
    .get();
  return row?.status === "banned";
}

/** Sets or clears a user's banned status. Returns false if the user is missing. */
export async function setUserBanned(userId: string, banned: boolean): Promise<boolean> {
  const row = await platformDb.select({ id: user.id }).from(user).where(eq(user.id, userId)).get();
  if (!row) return false;
  await platformDb
    .update(user)
    .set({ status: banned ? "banned" : null })
    .where(eq(user.id, userId));
  return true;
}

/** Appends a row to the moderation audit log. Best-effort context in `detail`. */
export async function logModAction(input: {
  actorId: string;
  action: ModAction;
  targetType: "post" | "comment" | "user" | "report";
  targetId: string;
  detail?: string | null;
}): Promise<void> {
  await platformDb.insert(modActions).values({
    id: newId(),
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    detail: input.detail ?? null,
    createdAt: new Date().toISOString(),
  });
}

/** The most recent moderation-log entries, with the actor's handle resolved. */
export async function recentModActions(limit = 20): Promise<
  {
    id: string;
    action: string;
    targetType: string;
    targetId: string;
    detail: string | null;
    actor: string;
    createdAt: string;
  }[]
> {
  const rows = await platformDb
    .select()
    .from(modActions)
    .orderBy(desc(modActions.createdAt))
    .limit(Math.min(50, Math.max(1, limit)));
  const actorIds = [...new Set(rows.map((r) => r.actorId))];
  const actors = actorIds.length
    ? await platformDb.select().from(profiles).where(inArray(profiles.userId, actorIds))
    : [];
  const actorMap = new Map(actors.map((p) => [p.userId, p.username]));
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    detail: r.detail,
    actor: actorMap.get(r.actorId) ?? "admin",
    createdAt: r.createdAt,
  }));
}

/**
 * Loads both moderation streams from the platform DB, normalizes them into
 * `ModQueueItem`s, and runs the pure filter/sort/paginate core.
 *
 *  - reports: every row (capped), with the target preview + reporter handle.
 *  - flagged: posts carrying a non-null `quality_flag` (the rank-13 gate).
 *
 * Author ban status rides along so the UI can disable a redundant ban button.
 */
export async function queryModQueue(query: ModQueueQuery): Promise<{
  items: ModQueueItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  openCounts: { reports: number; flags: number };
}> {
  const [reportRows, flaggedRows] = await Promise.all([
    platformDb.select().from(reports).orderBy(desc(reports.createdAt)).limit(200),
    platformDb
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
      .limit(200),
  ]);

  const postIds = reportRows.filter((r) => r.targetType === "post").map((r) => r.targetId);
  const commentIds = reportRows.filter((r) => r.targetType === "comment").map((r) => r.targetId);
  const reporterIds = [...new Set(reportRows.map((r) => r.reporterId))];

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

  // Resolve every content-author handle + their ban status, across both streams.
  const authorIds = [
    ...new Set([
      ...targetPosts.map((p) => p.userId),
      ...targetComments.map((c) => c.userId),
      ...flaggedRows.map((p) => p.userId),
    ]),
  ];
  const [authors, bannedUsers] = await Promise.all([
    authorIds.length
      ? platformDb.select().from(profiles).where(inArray(profiles.userId, authorIds))
      : Promise.resolve([]),
    authorIds.length
      ? platformDb
          .select({ id: user.id, status: user.status })
          .from(user)
          .where(inArray(user.id, authorIds))
      : Promise.resolve([] as { id: string; status: string | null }[]),
  ]);
  const authorMap = new Map(authors.map((a) => [a.userId, a.username]));
  const bannedSet = new Set(bannedUsers.filter((u) => u.status === "banned").map((u) => u.id));

  const reportItems: ModQueueItem[] = reportRows.map((r) => {
    const target = r.targetType === "post" ? postMap.get(r.targetId) : commentMap.get(r.targetId);
    const authorId = target?.userId ?? null;
    const { label, note } = splitReason(r.reason);
    return {
      key: r.id,
      source: "report",
      status: r.status === "actioned" ? "actioned" : "open",
      targetType: r.targetType === "comment" ? "comment" : "post",
      targetId: r.targetId,
      postId: target ? ("postId" in target ? target.postId : target.id) : null,
      label,
      note,
      preview: target ? buildPreview("title" in target ? target.title : null, target.body) : null,
      author: authorId ? (authorMap.get(authorId) ?? "unknown") : null,
      authorId,
      authorBanned: authorId ? bannedSet.has(authorId) : false,
      reporter: reporterMap.get(r.reporterId) ?? "unknown",
      createdAt: r.createdAt,
    };
  });

  const flagItems: ModQueueItem[] = flaggedRows.map((p) => ({
    key: `flag:${p.id}`,
    source: "flag",
    status: "open", // a flag is open until the post is deleted or the flag cleared
    targetType: "post",
    targetId: p.id,
    postId: p.id,
    label: p.qualityFlag ?? "flagged",
    note: null,
    preview: buildPreview(p.title, p.body),
    author: authorMap.get(p.userId) ?? "unknown",
    authorId: p.userId,
    authorBanned: bannedSet.has(p.userId),
    reporter: null,
    createdAt: p.createdAt,
  }));

  const all = [...reportItems, ...flagItems];
  const paged = buildModQueue(all, query);
  return { ...paged, openCounts: countOpen(all) };
}
