/**
 * Public platform metrics — the landing page's "live numbers" strip.
 *
 * Honesty contract: every number is an aggregate the platform can actually
 * see (auth users, first-party page events, community content, opt-in shared
 * streaks). Per-user journals live in the user's own database and are NOT
 * centrally readable — so there is no "total trades logged" metric here, and
 * there never should be unless users explicitly opt in to sharing it.
 */

export interface PublicStats {
  /** Registered accounts on the platform. */
  traders: number;
  /** Distinct signed-in users with activity in the last 30 days. */
  active30d: number;
  /** Community posts, all time. */
  posts: number;
  /** Longest journaling streak among users who opted in to sharing it (days). */
  longestStreak: number;
  /** ISO timestamp the aggregates were computed at. */
  generatedAt: string;
}

export interface RawPublicStats {
  traders?: unknown;
  active30d?: unknown;
  posts?: unknown;
  longestStreak?: unknown;
}

/** Floor to a safe non-negative integer; anything unparseable becomes 0. */
const count = (v: unknown): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Shapes raw aggregate rows into the public payload. Pure — unit-tested.
 * Guards: no negatives/NaN, and active users can never exceed registered
 * users (both are platform-account counts, so the invariant must hold).
 */
export function shapePublicStats(raw: RawPublicStats, now: Date = new Date()): PublicStats {
  const traders = count(raw.traders);
  return {
    traders,
    active30d: Math.min(count(raw.active30d), traders),
    posts: count(raw.posts),
    longestStreak: count(raw.longestStreak),
    generatedAt: now.toISOString(),
  };
}
