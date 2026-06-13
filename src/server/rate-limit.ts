import "server-only";
import { sql } from "drizzle-orm";
import { serverEnv } from "./env";

/**
 * Rate limiter with three tiers, in priority order:
 *
 *  1. Upstash Redis sliding window — used automatically whenever
 *     UPSTASH_REDIS_REST_URL/TOKEN are set (best for high-volume multi-region).
 *  2. Durable platform-DB fixed-window counter — the default on this serverless
 *     deployment. An in-memory Map resets on every lambda cold start, so it can
 *     never actually enforce a limit across requests; the `rate_limits` table
 *     does. Atomic read-modify-write via a single conditional UPSERT.
 *  3. In-memory micro-cache — last resort only, used when the platform DB is
 *     unreachable so a transient DB blip can't disable limiting entirely.
 */

type MemEntry = { count: number; windowStart: number };
const memory = new Map<string, MemEntry>();

/** Best-effort in-memory fixed-window fallback (last resort). */
function memoryFixedWindow(key: string, limit: number, windowMs: number, now: number): boolean {
  const e = memory.get(key);
  if (!e || now - e.windowStart >= windowMs) {
    memory.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (e.count < limit) {
    e.count += 1;
    return true;
  }
  return false;
}

// Prune rows that haven't been touched within roughly a day, run at most once
// per process every few minutes so it never piles onto a hot path.
const PRUNE_EVERY_MS = 5 * 60 * 1000;
const PRUNE_OLDER_THAN_MS = 24 * 60 * 60 * 1000;
let lastPruneAt = 0;

async function maybePrune(db: typeof import("./db/platform").platformDb, now: number) {
  if (now - lastPruneAt < PRUNE_EVERY_MS) return;
  lastPruneAt = now;
  try {
    await db.run(sql`DELETE FROM rate_limits WHERE window_start < ${now - PRUNE_OLDER_THAN_MS}`);
  } catch {
    /* best-effort — never let pruning break a request */
  }
}

export async function rateLimit(
  key: string,
  limit = 10,
  windowSec = 60
): Promise<{ allowed: boolean }> {
  // ── 1. Upstash (if configured) ──
  if (serverEnv.upstashUrl && serverEnv.upstashToken) {
    const { Ratelimit } = await import("@upstash/ratelimit");
    const { Redis } = await import("@upstash/redis");
    const rl = new Ratelimit({
      redis: new Redis({ url: serverEnv.upstashUrl, token: serverEnv.upstashToken }),
      limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
      prefix: "tm-rl",
    });
    const res = await rl.limit(key);
    return { allowed: res.success };
  }

  const now = Date.now();
  const windowMs = windowSec * 1000;

  // ── 2. Durable platform-DB fixed-window counter ──
  try {
    const { platformDb } = await import("./db/platform");

    // Atomic upsert: a brand-new key starts a fresh window at count 1; an
    // existing key whose window has expired resets to count 1, otherwise the
    // count is incremented. Doing this in one statement avoids lost-update
    // races between the read and the write.
    const row = (await platformDb.get(sql`
      INSERT INTO rate_limits (key, count, window_start)
      VALUES (${key}, 1, ${now})
      ON CONFLICT(key) DO UPDATE SET
        count = CASE
          WHEN rate_limits.window_start <= ${now - windowMs} THEN 1
          ELSE rate_limits.count + 1
        END,
        window_start = CASE
          WHEN rate_limits.window_start <= ${now - windowMs} THEN ${now}
          ELSE rate_limits.window_start
        END
      RETURNING count AS count, window_start AS window_start
    `)) as { count?: number } | undefined;

    void maybePrune(platformDb, now);

    const count = Number(row?.count ?? 1);
    return { allowed: count <= limit };
  } catch {
    // ── 3. In-memory last resort (platform DB unavailable) ──
    return { allowed: memoryFixedWindow(key, limit, windowMs, now) };
  }
}
