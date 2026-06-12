import { NextResponse } from "next/server";
import { newId } from "@/lib/id";
import { platformDb } from "@/server/db/platform";
import { pageEvents } from "@/server/db/platform-schema";
import { getSession } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";

/**
 * First-party page-view tracking — accepts a BATCH of queued events (the
 * client flushes once per session/tab-hide instead of per page view) and
 * inserts them in a single statement. Events carry their real client
 * timestamps, clamped to a sane window. Legacy single-event payloads still
 * accepted. Stores path + (optional) user id only — no IP, no fingerprinting.
 */
const normalize = (p: string) =>
  p.replace(/\/(post|u)\/[^/]+$/, "/$1/*").replace(/\/trades\/[^/]+$/, "/trades/*");

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
  } | null;

  const now = Date.now();
  const weekAgo = now - 7 * 864e5;
  const events: { path: string; ts: number }[] = [];
  if (Array.isArray(body?.events)) {
    for (const e of body.events.slice(0, 100)) {
      if (typeof e?.path === "string" && e.path.length > 0 && e.path.length <= 200) {
        const ts = typeof e.ts === "number" && e.ts > weekAgo && e.ts <= now + 60_000 ? e.ts : now;
        events.push({ path: e.path, ts });
      }
    }
  } else if (typeof body?.path === "string" && body.path.length <= 200) {
    events.push({ path: body.path, ts: now }); // legacy single-event clients
  }
  if (events.length === 0) return NextResponse.json({ ok: false }, { status: 400 });

  const session = await getSession().catch(() => null);
  await platformDb
    .insert(pageEvents)
    .values(
      events.map((e) => ({
        id: newId(),
        path: normalize(e.path),
        userId: session?.user.id ?? null,
        createdAt: new Date(e.ts).toISOString(),
      }))
    )
    .catch(() => undefined); // analytics must never break the app
  return NextResponse.json({ ok: true, received: events.length });
}
