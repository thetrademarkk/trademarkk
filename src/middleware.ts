import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * SEO host-canonicalization.
 *
 * Only the primary domain (thetrademarkk.com) should be indexed. Vercel's
 * production *.vercel.app alias is otherwise crawlable and would split search
 * authority away from the real domain. Preview deployments are already
 * noindexed by Vercel, but this also covers the production alias and any
 * other host. Canonical/OG URLs already point at the primary domain via
 * `metadataBase` (NEXT_PUBLIC_APP_URL); this adds the matching header so
 * crawlers never index a non-canonical host.
 */
const CANONICAL_HOST = "thetrademarkk.com";

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  // Hot path: the canonical production host (the overwhelming majority of
  // traffic) does no header work at all. Everything here is synchronous — no
  // await, DB or fetch — so middleware never adds latency to TTFB.
  const host = ((req.headers.get("host") ?? "").split(":")[0] ?? "").toLowerCase();
  if (host === CANONICAL_HOST) return res;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
  if (!isLocal) {
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return res;
}

export const config = {
  // Pages only — skip Next internals and static assets (anything with a dot).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
