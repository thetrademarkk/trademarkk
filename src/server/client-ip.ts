import "server-only";

/**
 * Best-effort client IP for rate-limiting keys, from the `x-forwarded-for`
 * header (first hop). A missing header, a header with a leading empty hop, or a
 * whitespace-only value all trim to "" — which `?? "anon"` does NOT catch (an
 * empty string is not nullish), so every anonymous caller would collapse onto a
 * single shared limiter key. Always normalize the empty case to "anon".
 */
export function clientIp(req: Request): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim();
  return ip || "anon";
}
