import { NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { newId } from "@/lib/id";
import { platformDb } from "@/server/db/platform";
import { posts, postImages } from "@/server/db/platform-schema";
import {
  ensureProfile,
  getSession,
  notifyMentions,
  queryFeed,
  syncPostSymbols,
} from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";
import { cached, invalidateCached } from "@/server/cache";
import { createPostSchema } from "@/features/community/schemas";

/** Tag grammar — same as the post-creation schema (lowercase, digits, dashes). */
const TAG_RE = /^[a-z0-9-]{2,20}$/;

/** Public feed — readable logged-out. */
export async function GET(req: Request) {
  const session = await getSession();
  const url = new URL(req.url);
  const rawSymbol = url.searchParams.get("symbol");
  // A malformed tag can't reach the feed query (defence-in-depth alongside the
  // LIKE-escaping in queryFeed); an invalid value is simply ignored.
  const rawTag = url.searchParams.get("tag");
  const tag = rawTag && TAG_RE.test(rawTag) ? rawTag : null;
  const query = {
    sort: url.searchParams.get("sort") === "top" ? ("top" as const) : ("latest" as const),
    cursor: url.searchParams.get("cursor"),
    tag,
    search: url.searchParams.get("q"),
    symbol: rawSymbol ? rawSymbol.toUpperCase().slice(0, 20) : null,
    scope: url.searchParams.get("scope") as "all" | "following" | "saved" | null,
  };

  // Anonymous first pages have no viewer-specific fields (likedByMe etc. are
  // always false) — share a short-lived cache. Signed-in readers stay fresh.
  if (!session && !query.cursor && (!query.scope || query.scope === "all")) {
    const key = `feed:${query.sort}:${query.tag ?? ""}:${query.search ?? ""}:${query.symbol ?? ""}`;
    return NextResponse.json(await cached(key, 30_000, () => queryFeed(query, null)));
  }

  return NextResponse.json(await queryFeed(query, session?.user.id ?? null));
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to post" }, { status: 401 });

  const { allowed } = await rateLimit(`post:${session.user.id}`, 5, 3600);
  if (!allowed)
    return NextResponse.json({ error: "Posting too fast — try later" }, { status: 429 });

  // Durable daily ceiling backed by the DB (the limiter window is only 1h, so a
  // patient spammer could otherwise post far more than 5/day). Five posts/day is
  // generous for genuine use.
  const since24h = new Date(Date.now() - 86_400_000).toISOString();
  const dayCount = await platformDb
    .select({ c: sql<number>`COUNT(*)` })
    .from(posts)
    .where(and(eq(posts.userId, session.user.id), gte(posts.createdAt, since24h)))
    .get();
  if ((dayCount?.c ?? 0) >= 5)
    return NextResponse.json(
      { error: "You've reached today's posting limit — try again tomorrow" },
      { status: 429 }
    );

  const parsed = createPostSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid post" },
      { status: 400 }
    );
  }
  const input = parsed.data;
  await ensureProfile(session.user.id, session.user.name);

  const id = newId();
  await platformDb.insert(posts).values({
    id,
    userId: session.user.id,
    title: input.title?.trim() || null,
    body: input.body.trim(),
    tradeCard: input.tradeCard ? JSON.stringify(input.tradeCard) : null,
    tags: input.tags.length ? JSON.stringify(input.tags) : null,
    createdAt: new Date().toISOString(),
  });
  if (input.images.length) {
    await platformDb
      .insert(postImages)
      .values(input.images.map((data, position) => ({ id: newId(), postId: id, position, data })));
  }
  await notifyMentions(input.body, session.user.id, id);
  await syncPostSymbols(id, input.body); // index $cashtags → per-symbol streams
  invalidateCached("feed:"); // new post must appear for anonymous readers too
  return NextResponse.json({ id }, { status: 201 });
}
