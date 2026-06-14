import { NextResponse } from "next/server";
import { getSession, queryTrending } from "@/server/community";
import { parseWindow } from "@/features/community/trending";

/**
 * Trending tickers & topics board — what the community is actively discussing,
 * ranked by distinct-author breadth (NOT a buy/sell signal). Computed on-read
 * from the DB (no cron, no snapshot table); the server caches the anonymous
 * board in-memory for 10 minutes and a signed-in viewer's board is personalized
 * by their blocks per request.
 *
 * The anonymous board carries a CDN `s-maxage` so the public landing surface is
 * served from the edge; a signed-in viewer's board is `private, no-store`
 * because it reflects their personal block list.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const window = parseWindow(url.searchParams.get("window"));

  const session = await getSession();
  const viewerId = session?.user.id ?? null;

  try {
    const board = await queryTrending(window, viewerId);
    return NextResponse.json(board, {
      headers: viewerId
        ? { "Cache-Control": "private, no-store" }
        : { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1200" },
    });
  } catch {
    // The board is non-critical — never 500 a sidebar/landing surface.
    return NextResponse.json({ window, tickers: [], topics: [] });
  }
}
