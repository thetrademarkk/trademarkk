import { NextResponse } from "next/server";
import { newId } from "@/lib/id";
import { platformDb } from "@/server/db/platform";
import { pageEvents, webVitals } from "@/server/db/platform-schema";
import { getSession } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";
import { VITAL_METRICS, type VitalMetric } from "@/lib/pulse-stats";

/**
 * First-party analytics intake — accepts a BATCH of queued page-view events
 * (the client flushes once per session/tab-hide instead of per page view) and
 * an optional batch of field web-vitals samples, inserted in one statement
 * each. Events carry their real client timestamps, clamped to a sane window.
 * Legacy single-event payloads still accepted. Page views store path +
 * (optional) user id only; vitals store metric + value + path only — no IP,
 * no fingerprinting.
 */
const normalize = (p: string) =>
  p.replace(/\/(post|u)\/[^/]+$/, "/$1/*").replace(/\/trades\/[^/]+$/, "/trades/*");

/** Upper bounds per metric — anything above is a broken clock, not a visit. */
const VITAL_MAX: Record<VitalMetric, number> = {
  LCP: 120_000,
  INP: 60_000,
  FCP: 120_000,
  TTFB: 60_000,
  CLS: 10,
};

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Anonymous write endpoint — cap batches per client so it can't flood the
  // platform DB (the client flushes at most once per page-hide).
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
  const { allowed } = await rateLimit(`track:${ip}`, 60, 3600);
  if (!allowed) return NextResponse.json({ ok: false }, { status: 429 });

  const body = (await req.json().catch(() => null)) as {
    path?: string;
    events?: { path?: string; ts?: number }[];
    vitals?: { metric?: string; value?: number; path?: string; ts?: number }[];
  } | null;

  const now = Date.now();
  const weekAgo = now - 7 * 864e5;
  const clampTs = (ts: unknown) =>
    typeof ts === "number" && ts > weekAgo && ts <= now + 60_000 ? ts : now;

  const events: { path: string; ts: number }[] = [];
  if (Array.isArray(body?.events)) {
    for (const e of body.events.slice(0, 100)) {
      if (typeof e?.path === "string" && e.path.length > 0 && e.path.length <= 200) {
        events.push({ path: e.path, ts: clampTs(e.ts) });
      }
    }
  } else if (typeof body?.path === "string" && body.path.length <= 200) {
    events.push({ path: body.path, ts: now }); // legacy single-event clients
  }

  const vitals: { metric: VitalMetric; value: number; path: string; ts: number }[] = [];
  if (Array.isArray(body?.vitals)) {
    for (const v of body.vitals.slice(0, 25)) {
      const metric = v?.metric as VitalMetric;
      if (!VITAL_METRICS.includes(metric)) continue;
      if (typeof v.value !== "number" || !Number.isFinite(v.value)) continue;
      if (v.value < 0 || v.value > VITAL_MAX[metric]) continue;
      const path = typeof v.path === "string" && v.path.length <= 200 ? v.path : "/";
      vitals.push({ metric, value: v.value, path, ts: clampTs(v.ts) });
    }
  }

  if (events.length === 0 && vitals.length === 0) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const session = await getSession().catch(() => null);
  const writes: Promise<unknown>[] = [];
  if (events.length > 0) {
    writes.push(
      platformDb.insert(pageEvents).values(
        events.map((e) => ({
          id: newId(),
          path: normalize(e.path),
          userId: session?.user.id ?? null,
          createdAt: new Date(e.ts).toISOString(),
        }))
      )
    );
  }
  if (vitals.length > 0) {
    writes.push(
      platformDb.insert(webVitals).values(
        vitals.map((v) => ({
          id: newId(),
          metric: v.metric,
          value: v.value,
          path: normalize(v.path),
          createdAt: new Date(v.ts).toISOString(),
        }))
      )
    );
  }
  await Promise.all(writes).catch(() => undefined); // analytics must never break the app
  return NextResponse.json({ ok: true, received: events.length + vitals.length });
}
