import "server-only";
import { serverEnv } from "./env";

/**
 * Sliding-window rate limiter. Uses Upstash Redis when configured;
 * falls back to in-memory (fine for dev / single-instance).
 */
const memory = new Map<string, number[]>();

export async function rateLimit(
  key: string,
  limit = 10,
  windowSec = 60
): Promise<{ allowed: boolean }> {
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
  const hits = (memory.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    memory.set(key, hits);
    return { allowed: false };
  }
  hits.push(now);
  memory.set(key, hits);
  return { allowed: true };
}
