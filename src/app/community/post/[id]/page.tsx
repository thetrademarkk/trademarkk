import { PostDetail } from "./post-detail";

// The shell is a pure client component (data loads via the API), so the
// document never varies by viewer. generateStaticParams switches the route
// from per-request SSR (a function invocation per share-link click — the
// dominant prod TTFB cost) to on-demand static: rendered once per id, then
// served from the CDN cache.
export function generateStaticParams() {
  return [];
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PostDetail id={id} />;
}
