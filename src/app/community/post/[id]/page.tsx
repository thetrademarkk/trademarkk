import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { posts, profiles } from "@/server/db/platform-schema";
import { PostDetail } from "./post-detail";

// The shell is a pure client component (data loads via the API), so the
// document never varies by viewer. generateStaticParams switches the route
// from per-request SSR (a function invocation per share-link click — the
// dominant prod TTFB cost) to on-demand ISR: rendered once per id, then
// served from the CDN cache. revalidate keeps the OG metadata below from
// freezing until the next deploy (edits/deletes surface within 5 min).
export const revalidate = 300;

export function generateStaticParams() {
  return [];
}

/** Real titles/descriptions so shared links unfurl properly in chats and socials. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const row = await platformDb
      .select({ title: posts.title, body: posts.body, userId: posts.userId })
      .from(posts)
      .where(eq(posts.id, id))
      .get();
    if (!row) return { title: "Post not found — TradeMarkk Community" };
    const author = await platformDb
      .select({ displayName: profiles.displayName })
      .from(profiles)
      .where(eq(profiles.userId, row.userId))
      .get();
    const title = row.title ?? `${author?.displayName ?? "A trader"} on TradeMarkk`;
    const description = row.body.replace(/\s+/g, " ").trim().slice(0, 160);
    return {
      title: `${title} — TradeMarkk Community`,
      description,
      openGraph: { title, description },
    };
  } catch {
    return { title: "TradeMarkk Community" };
  }
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PostDetail id={id} />;
}
