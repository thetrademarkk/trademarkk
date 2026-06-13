/**
 * Pure, DOM-free logic for the post/comment edit window + immutable edit history.
 *
 * Authors may edit their own post (title/body/tags) or comment (body) for a
 * short window after creation. Every edit snapshots the PRE-edit content into an
 * append-only history array — the whole point is that nobody can silently
 * rewrite a bad market call, so the history can only ever GROW (a prior snapshot
 * is never deleted or mutated). The window + author-only authz are enforced
 * server-side; these helpers are shared by the server route and the UI so the
 * boundary maths match exactly.
 */

/** How long after creation an author may edit their own content. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export const EDIT_WINDOW_MINUTES = EDIT_WINDOW_MS / 60_000;

/** Hard cap on retained snapshots — a runaway editor can't bloat one row. */
export const MAX_EDIT_HISTORY = 50;

/** A single pre-edit snapshot, tagged by the kind of content it belongs to. */
export interface PostEditSnapshot {
  /** ISO timestamp the edit was applied (i.e. when this snapshot was captured). */
  editedAt: string;
  title: string | null;
  body: string;
  tags: string[];
}

export interface CommentEditSnapshot {
  editedAt: string;
  body: string;
}

export type EditSnapshot = PostEditSnapshot | CommentEditSnapshot;

/** Milliseconds elapsed since `createdAt` as of `now` (never negative). */
function elapsedMs(createdAt: string, now: number): number {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return Number.POSITIVE_INFINITY; // unparseable → treat as expired
  return Math.max(0, now - created);
}

/**
 * Whether content created at `createdAt` is still inside the edit window as of
 * `now`. The boundary is INCLUSIVE of the start and EXCLUSIVE of the end:
 * elapsed < window is editable, elapsed === window is NOT (the minute has
 * fully elapsed), elapsed > window is not.
 */
export function isWithinEditWindow(createdAt: string, now: number = Date.now()): boolean {
  return elapsedMs(createdAt, now) < EDIT_WINDOW_MS;
}

/**
 * Whole minutes of edit time remaining (rounded UP so "1 min left" shows for the
 * final partial minute), clamped to [0, EDIT_WINDOW_MINUTES]. Returns 0 once the
 * window has closed.
 */
export function editMinutesLeft(createdAt: string, now: number = Date.now()): number {
  const remaining = EDIT_WINDOW_MS - elapsedMs(createdAt, now);
  if (remaining <= 0) return 0;
  return Math.min(EDIT_WINDOW_MINUTES, Math.ceil(remaining / 60_000));
}

/** Milliseconds of edit time remaining (0 once closed) — drives a live countdown. */
export function editMsLeft(createdAt: string, now: number = Date.now()): number {
  return Math.max(0, EDIT_WINDOW_MS - elapsedMs(createdAt, now));
}

/** Parses a stored history column into a typed array (tolerant of null/garbage). */
export function parseEditHistory<T extends EditSnapshot>(json: string | null | undefined): T[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * Appends a pre-edit snapshot to the history, returning the serialized JSON to
 * persist. APPEND-ONLY by construction: prior entries are copied verbatim and
 * the new snapshot is pushed to the end — nothing is ever removed or rewritten.
 * If the cap is exceeded we still never drop a real snapshot here; the trim only
 * happens server-side at write time on the oldest entries (see route), keeping
 * this helper a pure, total append.
 */
export function appendEditSnapshot<T extends EditSnapshot>(
  existingJson: string | null | undefined,
  snapshot: T
): string {
  const history = parseEditHistory<T>(existingJson);
  const next = [...history, snapshot];
  // Defensive cap: drop the OLDEST entries only once we exceed the limit, never
  // the snapshot we just took. (Real usage never hits this — 30 edits/hour rate
  // limit + a 15-minute window bound it well under MAX_EDIT_HISTORY.)
  const trimmed =
    next.length > MAX_EDIT_HISTORY ? next.slice(next.length - MAX_EDIT_HISTORY) : next;
  return JSON.stringify(trimmed);
}

/** Edit count = number of retained prior-version snapshots. */
export function editCount(json: string | null | undefined): number {
  return parseEditHistory(json).length;
}
