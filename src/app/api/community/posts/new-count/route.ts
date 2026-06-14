import { NextResponse } from "next/server";
import { countNewerPosts, getSession } from "@/server/community";
import { NEW_POSTS_CAP } from "@/features/community/new-posts";

/** Tag grammar — same as the feed route (lowercase, digits, dashes). */
const TAG_RE = /^[a-z0-9-]{2,20}$/;

/**
 * "N new posts" live pill (rank-15) — a CHEAP, count-only endpoint that returns
 * how many posts are newer than the `since` timestamp the client is currently
 * showing at the top of its feed. No post payloads are sent until the user
 * clicks the pill (which simply refetches the feed head). It is polled on a
 * gentle interval by the Latest feed and pauses while the tab is hidden — see
 * `useNewPostsCount` and `features/community/new-posts.ts` for the transport
 * rationale (poll over SSE on Vercel serverless).
 *
 * The count is block-aware and excludes the viewer's own posts, mirroring the
 * live feed's visibility rules exactly via the shared `buildFeedConditions`.
 * Public (readable logged-out); never cached — it is inherently time-sensitive.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const since = url.searchParams.get("since");
  // A bad/absent `since` can't bound the window — answer 0 rather than scan all.
  if (!since || Number.isNaN(Date.parse(since))) {
    return NextResponse.json({ count: 0 }, { headers: { "Cache-Control": "no-store" } });
  }

  const rawSymbol = url.searchParams.get("symbol");
  const rawTag = url.searchParams.get("tag");
  const tag = rawTag && TAG_RE.test(rawTag) ? rawTag : null;
  const scope = url.searchParams.get("scope") as "all" | "following" | "saved" | "watchlist" | null;

  const session = await getSession();
  const viewerId = session?.user.id ?? null;

  try {
    const count = await countNewerPosts(
      {
        // The pill is a recency surface — always the latest ordering.
        sort: "latest",
        cursor: null,
        tag,
        search: url.searchParams.get("q"),
        symbol: rawSymbol ? rawSymbol.toUpperCase().slice(0, 20) : null,
        scope,
      },
      viewerId,
      since,
      NEW_POSTS_CAP
    );
    return NextResponse.json({ count }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // A live pill is non-critical — never 500 the feed because of it.
    return NextResponse.json({ count: 0 }, { headers: { "Cache-Control": "no-store" } });
  }
}
