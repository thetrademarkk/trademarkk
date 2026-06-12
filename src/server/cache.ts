import "server-only";

/**
 * Tiny in-memory TTL cache for hot read paths (leaderboard aggregates,
 * anonymous feed first pages). Per-instance only — serverless instances are
 * ephemeral, but warm instances absorb the vast majority of repeat reads.
 * Never cache anything viewer-specific; personalize per request instead.
 */
const store = new Map<string, { value: unknown; expires: number }>();

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await fn();
  store.set(key, { value, expires: Date.now() + ttlMs });
  if (store.size > 200) {
    // cheap sweep — drop expired entries
    const now = Date.now();
    for (const [k, v] of store) if (v.expires <= now) store.delete(k);
  }
  return value;
}

/** Invalidate keys by prefix (e.g. after a write that affects cached reads). */
export function invalidateCached(prefix: string) {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
