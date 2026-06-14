import "server-only";

/**
 * Best-effort client IP for rate-limiting keys.
 *
 * Trust boundary (Vercel): `x-forwarded-for` is a client-controllable list of
 * hops `client, proxy1, proxy2, …, edge`. The FIRST element is whatever the
 * caller chose to send, so it is fully spoofable — keying a rate limiter on it
 * lets an attacker rotate the header to mint unlimited buckets. We therefore:
 *   1. Prefer `x-real-ip`, which Vercel's edge injects with the true client IP
 *      (the platform overwrites any client-supplied value, so it is trusted).
 *   2. Fall back to the LAST `x-forwarded-for` hop — the entry the platform
 *      appended, i.e. the real edge-observed peer — never the spoofable first.
 *
 * A missing/whitespace-only value, or a list whose trusted hop is empty, all
 * normalize to "" — which `?? "anon"` does NOT catch (an empty string is not
 * nullish), so every anonymous caller would collapse onto a single shared
 * limiter key. Always normalize the empty case to "anon".
 */
export function clientIp(req: Request): string {
  const realIp = (req.headers.get("x-real-ip") ?? "").trim();
  if (realIp) return realIp;

  const forwarded = (req.headers.get("x-forwarded-for") ?? "").split(",");
  const lastHop = forwarded[forwarded.length - 1]!.trim();
  return lastHop || "anon";
}
