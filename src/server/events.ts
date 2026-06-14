import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { newId } from "@/lib/id";
import { platformDb } from "./db/platform";
import { eventThreads, posts, profiles, user } from "./db/platform-schema";
import {
  isMarketClosed,
  istDateKey,
  resolveActiveEvents,
  type ActiveEvent,
  type EventType,
} from "@/features/community/events";
import { syncPostSymbols } from "./community";

/**
 * Server-side lazy materialization of recurring event/market-session threads
 * (rank-18). Threads are created on FIRST VISIT of an active day (no cron),
 * idempotently (INSERT OR IGNORE on the (event_type,event_date) unique key so
 * concurrent first visits yield exactly one thread), authored by a clearly-
 * labelled HOUSE / system account.
 *
 * The house account is NOT a real user — it has a reserved handle, a fixed id
 * that can never collide with a real signup, and is explicitly marked automated
 * in the UI. It posts no opinions/tips; each thread is a neutral, dated prompt.
 */

/**
 * Fixed id + reserved handle for the automated house account. The id is a
 * literal (not a ULID) so it is stable across deploys and can never be minted by
 * Better Auth for a real user. The handle is in the community RESERVED_USERNAMES
 * set, so no human can register it.
 */
export const HOUSE_USER_ID = "system-trademark-events";
export const HOUSE_USERNAME = "trademark";
export const HOUSE_DISPLAY_NAME = "TradeMarkk";

/**
 * Ensures the house user + profile rows exist. Idempotent — safe to call on
 * every materialization. The `user` row uses a non-routable email under the
 * reserved `trademark.app` brand domain so it can never clash with a signup
 * (emails are UNIQUE) and is obviously not a person.
 */
async function ensureHouseAccount(): Promise<void> {
  const existing = await platformDb
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(eq(profiles.userId, HOUSE_USER_ID))
    .get();
  if (existing) return;

  const nowIso = new Date().toISOString();
  const nowDate = new Date();
  // The auth `user` row first (FK target for posts/profiles). Best-effort: a
  // concurrent caller may have inserted it — ignore the conflict.
  await platformDb
    .insert(user)
    .values({
      id: HOUSE_USER_ID,
      name: HOUSE_DISPLAY_NAME,
      email: "events@system.trademark.app",
      emailVerified: true,
      createdAt: nowDate,
      updatedAt: nowDate,
    })
    .onConflictDoNothing();
  await platformDb
    .insert(profiles)
    .values({
      userId: HOUSE_USER_ID,
      username: HOUSE_USERNAME,
      displayName: HOUSE_DISPLAY_NAME,
      bio: "Automated market-session threads — auto-posted by TradeMarkk, not a person.",
      createdAt: nowIso,
    })
    .onConflictDoNothing();
}

/** A materialized event thread the UI links to. */
export interface EventThreadView {
  type: EventType;
  date: string;
  title: string;
  badge: string;
  postId: string;
  /** Comment count on the thread post (live discussion size). */
  commentCount: number;
}

/** The active-events surface payload. */
export interface ActiveEventsResult {
  /** YYYY-MM-DD (IST) the events were resolved for. */
  date: string;
  /** True on a weekend/holiday → the UI shows "Markets closed today". */
  marketClosed: boolean;
  /** The materialized threads for today's active events (ordered). */
  threads: EventThreadView[];
}

/**
 * Creates (idempotently) the post + event_threads row for a single active
 * event, returning the post id. Race-safe: the event_threads UNIQUE
 * (event_type,event_date) means a second concurrent caller's INSERT is ignored
 * and we re-read the winning row's post_id. The post is authored by the house
 * account and carries the event's tags ($cashtag sync runs too for expiry
 * threads that mention indices).
 */
async function materializeEvent(ev: ActiveEvent): Promise<string> {
  // Fast path: the thread already exists.
  const existing = await platformDb
    .select({ postId: eventThreads.postId })
    .from(eventThreads)
    .where(and(eq(eventThreads.eventType, ev.type), eq(eventThreads.eventDate, ev.date)))
    .get();
  if (existing) return existing.postId;

  const postId = newId();
  const nowIso = new Date().toISOString();
  // The thread post — pinned/tagged, authored by the house account.
  await platformDb
    .insert(posts)
    .values({
      id: postId,
      userId: HOUSE_USER_ID,
      title: ev.title,
      body: ev.body,
      tags: ev.tags.length ? JSON.stringify(ev.tags) : null,
      createdAt: nowIso,
    })
    .onConflictDoNothing();

  // Claim the natural key. INSERT OR IGNORE: if another visit won the race, our
  // insert is a no-op and we fall through to re-read the winner.
  await platformDb
    .insert(eventThreads)
    .values({
      id: newId(),
      eventType: ev.type,
      eventDate: ev.date,
      postId,
      createdAt: nowIso,
    })
    .onConflictDoNothing();

  const winner = await platformDb
    .select({ postId: eventThreads.postId })
    .from(eventThreads)
    .where(and(eq(eventThreads.eventType, ev.type), eq(eventThreads.eventDate, ev.date)))
    .get();

  // If we LOST the race, our orphan post is unreferenced — clean it up so a
  // duplicate thread never lingers in the feed.
  if (winner && winner.postId !== postId) {
    await platformDb
      .delete(posts)
      .where(eq(posts.id, postId))
      .catch(() => undefined);
    return winner.postId;
  }

  // We won — index any $cashtags in the body (expiry threads name indices).
  await syncPostSymbols(postId, ev.body);
  return postId;
}

/**
 * Resolves today's active events (IST, deterministic from the injected `now`)
 * and lazily materializes a thread for each, returning the surface payload.
 * Idempotent + race-safe. Degrades to an empty (no-threads) payload on any DB
 * error so the events surface never errors the page. On a weekend/holiday it
 * materializes nothing and reports `marketClosed: true`.
 *
 * @param now  injectable clock — tests pass a fixed instant; the route passes
 *             `new Date()`. NEVER read the clock inside the engine.
 */
export async function ensureActiveEventThreads(now: Date): Promise<ActiveEventsResult> {
  const date = istDateKey(now);
  const marketClosed = isMarketClosed(now);
  try {
    const events = resolveActiveEvents(now);
    if (events.length === 0) {
      return { date, marketClosed, threads: [] };
    }
    await ensureHouseAccount();

    const threads: EventThreadView[] = [];
    for (const ev of events) {
      const postId = await materializeEvent(ev);
      threads.push({
        type: ev.type,
        date: ev.date,
        title: ev.title,
        badge: ev.badge,
        postId,
        commentCount: 0,
      });
    }

    // One cheap batched read of the live comment counts for the rendered cards.
    const postIds = threads.map((t) => t.postId);
    if (postIds.length) {
      const counts = await platformDb
        .select({ id: posts.id, commentCount: posts.commentCount })
        .from(posts)
        .where(inArray(posts.id, postIds));
      const byId = new Map(counts.map((c) => [c.id, c.commentCount]));
      for (const t of threads) t.commentCount = byId.get(t.postId) ?? 0;
    }

    return { date, marketClosed, threads };
  } catch {
    // The events surface is a non-critical focal point — degrade to empty.
    return { date, marketClosed, threads: [] };
  }
}

/**
 * Whether a post is an auto-created event thread (so the post-detail page can
 * render the pinned/automated header). Cheap indexed read; returns the event
 * metadata or null. Never throws.
 */
export async function getEventThreadForPost(postId: string): Promise<{
  type: EventType;
  date: string;
} | null> {
  try {
    const row = await platformDb
      .select({ eventType: eventThreads.eventType, eventDate: eventThreads.eventDate })
      .from(eventThreads)
      .where(eq(eventThreads.postId, postId))
      .get();
    if (!row) return null;
    return { type: row.eventType as EventType, date: row.eventDate };
  } catch {
    return null;
  }
}

/** The most recent N materialized event threads (for an archive/empty-day link). */
export async function recentEventThreads(limit = 5): Promise<EventThreadView[]> {
  try {
    const rows = await platformDb
      .select({
        eventType: eventThreads.eventType,
        eventDate: eventThreads.eventDate,
        postId: eventThreads.postId,
        title: posts.title,
        commentCount: posts.commentCount,
      })
      .from(eventThreads)
      .innerJoin(posts, eq(posts.id, eventThreads.postId))
      .orderBy(desc(eventThreads.eventDate))
      .limit(Math.min(20, Math.max(1, limit)));
    return rows.map((r) => ({
      type: r.eventType as EventType,
      date: r.eventDate,
      title: r.title ?? "Event thread",
      badge: "",
      postId: r.postId,
      commentCount: r.commentCount ?? 0,
    }));
  } catch {
    return [];
  }
}
