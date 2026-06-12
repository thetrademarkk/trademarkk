import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { posts, profiles } from "@/server/db/platform-schema";
import { PostDetail } from "./post-detail";

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
    if (!row) return { title: "Post not found — TradeMark Community" };
    const author = await platformDb
      .select({ displayName: profiles.displayName })
      .from(profiles)
      .where(eq(profiles.userId, row.userId))
      .get();
    const title = row.title ?? `${author?.displayName ?? "A trader"} on TradeMark`;
    const description = row.body.replace(/\s+/g, " ").trim().slice(0, 160);
    return {
      title: `${title} — TradeMark Community`,
      description,
      openGraph: { title, description },
    };
  } catch {
    return { title: "TradeMark Community" };
  }
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PostDetail id={id} />;
}
