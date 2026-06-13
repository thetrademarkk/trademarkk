/**
 * Pure moderation-queue logic (no DB, no React) for the admin report queue.
 *
 * The admin moderation surface aggregates two streams into one ordered queue:
 *  - user **reports** (the `reports` table) — content a community member flagged;
 *  - **auto-flagged** posts (the rank-13 content-quality gate's `quality_flag`)
 *    that nobody has reported yet.
 *
 * Everything here is deterministic and unit-tested; the server module
 * (`src/server/moderation.ts`) feeds it raw rows and renders the result.
 */

/** A moderation queue item, normalized across reports and auto-flags. */
export interface ModQueueItem {
  /** Stable key. For a report this is the report id; for a flag, `flag:<postId>`. */
  key: string;
  /** Where the item came from. */
  source: "report" | "flag";
  /** 'open' = needs review, 'actioned' = already dismissed/resolved. */
  status: "open" | "actioned";
  targetType: "post" | "comment";
  /** The reported/flagged content id (post or comment id). */
  targetId: string;
  /** The post id to link to in context (a comment links to its post). */
  postId: string | null;
  /** Short reason (report reason) or flag kind ('tip' | 'all-caps'). */
  label: string;
  /** Optional free-text note attached to a report. */
  note: string | null;
  /** Content preview (trimmed), or null when the content is already deleted. */
  preview: string | null;
  /** The content author's handle, when known. */
  author: string | null;
  /** The author's user id (needed for a ban action), when known. */
  authorId: string | null;
  /** Whether the content author is currently banned. */
  authorBanned: boolean;
  /** The reporter's handle (reports only). */
  reporter: string | null;
  /** ISO timestamp the item was created (report time, or post time for a flag). */
  createdAt: string;
}

export type ModSourceFilter = "all" | "report" | "flag";
export type ModStatusFilter = "open" | "actioned" | "all";
export type ModSort = "newest" | "oldest";

export interface ModQueueQuery {
  source?: ModSourceFilter;
  status?: ModStatusFilter;
  sort?: ModSort;
  /** 1-based page. */
  page?: number;
  /** Items per page (clamped). */
  pageSize?: number;
}

export const MOD_PAGE_SIZE_DEFAULT = 20;
export const MOD_PAGE_SIZE_MAX = 50;

/** The moderator actions the admin API accepts. */
export const MOD_ACTIONS = [
  "dismiss",
  "delete-content",
  "clear-flag",
  "ban-user",
  "unban-user",
] as const;
export type ModAction = (typeof MOD_ACTIONS)[number];

/** Clamp an incoming page size to a sane bound. */
export function clampPageSize(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return MOD_PAGE_SIZE_DEFAULT;
  return Math.min(MOD_PAGE_SIZE_MAX, Math.max(1, Math.floor(n)));
}

/** Clamp a 1-based page index. */
export function clampPage(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return 1;
  return Math.max(1, Math.floor(n));
}

/**
 * Splits a stored report reason ("<reason>" or "<reason>: <note>") into the
 * short label and the optional note, mirroring how `/api/community/report`
 * persists it.
 */
export function splitReason(reason: string | null): { label: string; note: string | null } {
  if (!reason) return { label: "reported", note: null };
  const i = reason.indexOf(":");
  if (i === -1) return { label: reason.trim() || "reported", note: null };
  return {
    label: reason.slice(0, i).trim() || "reported",
    note: reason.slice(i + 1).trim() || null,
  };
}

/** Builds a trimmed preview from an optional title + body. */
export function buildPreview(title: string | null, body: string, max = 160): string {
  const head = title ? `${title} — ` : "";
  return (head + body).slice(0, max);
}

/**
 * Merges the report and auto-flag streams into one queue, then applies the
 * source/status filter, the sort, and pagination.
 *
 * De-dup rule: a post that is BOTH reported and auto-flagged appears only as the
 * report (the stronger signal — a human flagged it), never twice. This function
 * is the deterministic filter/sort/paginate core so it can be unit-tested
 * without a DB.
 */
export function buildModQueue(
  items: ModQueueItem[],
  query: ModQueueQuery = {}
): { items: ModQueueItem[]; total: number; page: number; pageSize: number; pageCount: number } {
  const source = query.source ?? "all";
  const status = query.status ?? "open";
  const sort = query.sort ?? "newest";
  const pageSize = clampPageSize(query.pageSize);
  const page = clampPage(query.page);

  // Drop a flag whose post is already represented by a report (no double entry).
  const reportedPostIds = new Set(
    items.filter((i) => i.source === "report" && i.targetType === "post").map((i) => i.targetId)
  );
  let filtered = items.filter((i) => !(i.source === "flag" && reportedPostIds.has(i.targetId)));

  if (source !== "all") filtered = filtered.filter((i) => i.source === source);
  if (status !== "all") filtered = filtered.filter((i) => i.status === status);

  filtered = filtered.slice().sort((a, b) => {
    const cmp = a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    return sort === "newest" ? -cmp : cmp;
  });

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    pageCount,
  };
}

/** Counts open items per source for the queue's tab badges (before pagination). */
export function countOpen(items: ModQueueItem[]): { reports: number; flags: number } {
  const reportedPostIds = new Set(
    items.filter((i) => i.source === "report" && i.targetType === "post").map((i) => i.targetId)
  );
  let reports = 0;
  let flags = 0;
  for (const i of items) {
    if (i.status !== "open") continue;
    if (i.source === "report") reports++;
    else if (!reportedPostIds.has(i.targetId)) flags++;
  }
  return { reports, flags };
}
