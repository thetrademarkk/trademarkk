import { NextResponse } from "next/server";
import { getSession, querySymbolSentiment } from "@/server/community";
import { parseSentimentWindow } from "@/features/community/sentiment";
import { normalizeSymbol } from "@/features/community/symbols";

/**
 * Per-symbol community sentiment gauge — the bull/bear split among recent posts
 * that tagged the symbol AND set a lean. Computed on-read from the DB (no cron,
 * no snapshot table). NEVER a recommendation: the gauge withholds itself below a
 * minimum sample, and the UI carries a prominent not-advice disclaimer.
 *
 * The anonymous gauge is CDN-cached (it's the same for everyone); a signed-in
 * viewer's gauge is `private, no-store` because it reflects their block list.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawSymbol = url.searchParams.get("symbol");
  const symbol = rawSymbol ? normalizeSymbol(rawSymbol).slice(0, 20) : "";
  const window = parseSentimentWindow(url.searchParams.get("window"));
  if (!symbol) return NextResponse.json({ error: "Missing symbol" }, { status: 400 });

  const session = await getSession();
  const viewerId = session?.user.id ?? null;

  try {
    const gauge = await querySymbolSentiment(symbol, window, viewerId);
    return NextResponse.json(
      { symbol, window, gauge },
      {
        headers: viewerId
          ? { "Cache-Control": "private, no-store" }
          : { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1200" },
      }
    );
  } catch {
    // Non-critical sidebar surface — never 500.
    return NextResponse.json({
      symbol,
      window,
      gauge: { bull: 0, bear: 0, total: 0, bullPct: 0, bearPct: 0, hasSignal: false },
    });
  }
}
