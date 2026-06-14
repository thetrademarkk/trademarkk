import { NextResponse } from "next/server";
import { ensureActiveEventThreads } from "@/server/events";
import { serverEnv } from "@/server/env";

/**
 * Active event / market-session threads for TODAY (rank-18). On a trading day
 * this lazily materializes (idempotent, race-safe) the daily "Market Open"
 * thread and any "Expiry Day" thread, returning links into them. On a weekend /
 * holiday it returns `marketClosed: true` and no threads (the UI shows the
 * graceful closed state). No cron — purely visit-triggered.
 *
 * Viewer-independent (the threads are the same for everyone), so the response is
 * CDN-cacheable for a short window. The materialization is idempotent so a cache
 * miss across visitors still produces exactly one thread per day.
 *
 * `?date=YYYY-MM-DD` is honored ONLY when EVENTS_TEST_DATE_OVERRIDE=1 (e2e), so
 * tests can deterministically simulate a trading/expiry/holiday day without
 * touching the real clock. Ignored in production.
 */
export async function GET(req: Request) {
  let now = new Date();
  if (serverEnv.allowEventsDateOverride) {
    const raw = new URL(req.url).searchParams.get("date");
    if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      // Anchor at 10:00 IST (04:30 UTC) on the requested IST date — well clear
      // of any timezone boundary, so the engine resolves exactly that day.
      const t = Date.parse(`${raw}T04:30:00Z`);
      if (!Number.isNaN(t)) now = new Date(t);
    }
  }

  try {
    const result = await ensureActiveEventThreads(now);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch {
    // A focal-point surface must never 500.
    return NextResponse.json({ date: "", marketClosed: false, threads: [] });
  }
}
