import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { countPostsForTag } from "@/server/community";
import { normalizeTag } from "@/features/community/followed-tags";
import { TagPage } from "./tag-page";

// On-demand ISR: a per-tag shell is rendered once then served from the CDN and
// refreshed every 5 min (post counts / OG don't need to be real-time). We do NOT
// generateStaticParams over every tag — the empty list means "build none up
// front, generate each on first request and cache it".
export const revalidate = 300;
export const dynamicParams = true;

export function generateStaticParams(): { tag: string }[] {
  return [];
}

/** Per-tag SEO: real title/description, canonical, and OG so shared links unfurl. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tag: string }>;
}): Promise<Metadata> {
  const { tag: raw } = await params;
  const tag = normalizeTag(decodeURIComponent(raw));
  if (!tag) return { title: "Topic — TradeMarkk Community" };
  const title = `#${tag} — TradeMarkk Community`;
  const description = `Educational trade ideas, lessons and discussion tagged #${tag} on TradeMarkk. Not investment advice.`;
  return {
    title: `#${tag}`,
    description,
    alternates: { canonical: `/community/t/${tag}` },
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export default async function CommunityTagPage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag: raw } = await params;
  const tag = normalizeTag(decodeURIComponent(raw));
  // An un-postable tag value has no page (defence-in-depth alongside the route's
  // grammar check) — 404 rather than render an empty shell for junk.
  if (!tag) notFound();
  const count = await countPostsForTag(tag);
  return <TagPage tag={tag} initialCount={count} />;
}
