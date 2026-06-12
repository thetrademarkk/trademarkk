import { NextResponse } from "next/server";
import { newId } from "@/lib/id";
import { platformDb } from "@/server/db/platform";
import { posts, postImages } from "@/server/db/platform-schema";
import { ensureProfile, getSession, notifyMentions, queryFeed } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";
import { cached, invalidateCached } from "@/server/cache";
import { createPostSchema } from "@/features/community/schemas";

/** Public feed — readable logged-out. */
export async function GET(req: Request) {
  const session = await getSession();
  const url = new URL(req.url);
  const query = {
    sort: url.searchParams.get("sort") === "top" ? ("top" as const) : ("latest" as const),
    cursor: url.searchParams.get("cursor"),
    tag: url.searchParams.get("tag"),
    search: url.searchParams.get("q"),
    scope: url.searchParams.get("scope") as "all" | "following" | "saved" | null,
  };

  // Anonymous first pages have no viewer-specific fields (likedByMe etc. are
  // always false) — share a short-lived cache. Signed-in readers stay fresh.
  if (!session && !query.cursor && (!query.scope || query.scope === "all")) {
    const key = `feed:${query.sort}:${query.tag ?? ""}:${query.search ?? ""}`;
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
  invalidateCached("feed:"); // new post must appear for anonymous readers too
  return NextResponse.json({ id }, { status: 201 });
}
