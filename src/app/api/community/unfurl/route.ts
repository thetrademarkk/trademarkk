import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { posts } from "@/server/db/platform-schema";
import { getSession } from "@/server/community";
import { getUnfurl } from "@/server/unfurl";
import { rateLimit } from "@/server/rate-limit";
import { extractFirstLink } from "@/features/community/unfurl";

/**
 * Lazy link-preview endpoint. Given a `postId`, resolves the FIRST link in that
 * post's body server-side and returns its cached (or freshly fetched) OG/twitter
 * unfurl. The URL is taken from the STORED post — never from the query string —
 * so this route can't be turned into an open SSRF proxy for arbitrary URLs; the
 * SSRF guard in src/server/ssrf.ts is the final backstop regardless.
 *
 * Returns `{ unfurl: null }` (200) whenever there's no link, nothing worth
 * showing, or the link is unsafe — the card simply doesn't render. Public like
 * the feed (signed-out readers see previews too); rate-limited per IP/user.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const postId = (url.searchParams.get("postId") ?? "").slice(0, 40);
  if (!postId) return NextResponse.json({ error: "Missing postId" }, { status: 400 });

  const session = await getSession();
  const ip = (req.headers.get("x-forwarded-for") ?? "anon").split(",")[0]!.trim();
  // A fetch can hit the network — keep this hostile to scrapers but fine for a
  // handful of cards per feed page.
  const { allowed } = await rateLimit(
    session ? `unfurl:${session.user.id}` : `unfurl:ip:${ip}`,
    40,
    60
  );
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  try {
    const post = await platformDb
      .select({ body: posts.body })
      .from(posts)
      .where(eq(posts.id, postId))
      .get();
    if (!post) return NextResponse.json({ unfurl: null });

    const link = extractFirstLink(post.body);
    if (!link) return NextResponse.json({ unfurl: null });

    const unfurl = await getUnfurl(link);
    return NextResponse.json({ unfurl });
  } catch {
    // Unfurls are non-essential — degrade silently, never 500.
    return NextResponse.json({ unfurl: null });
  }
}
