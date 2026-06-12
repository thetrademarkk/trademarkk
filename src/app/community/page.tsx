import { queryFeed } from "@/server/community";
import type { FeedResponse } from "@/features/community/types";
import { CommunityHomePage } from "./community-home";

// ISR: the anonymous first feed page is baked into the static document so the
// largest feed text paints at first paint (mobile LCP) instead of after
// hydrate-then-fetch. Viewer-specific bits (likedByMe, blocks…) arrive via the
// immediate client refetch — the seed is marked stale from the start.
export const revalidate = 60;

/** Build/ISR-time fetch; CI builds run with placeholder Turso creds, so any
 *  failure (or a slow region) degrades to the old client-only fetch path. */
async function getInitialFeed(): Promise<FeedResponse | null> {
  try {
    return await Promise.race([
      queryFeed({ sort: "latest", cursor: null, tag: null, search: null, scope: "all" }, null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
  } catch {
    return null;
  }
}

export default async function CommunityPage() {
  const initialFeed = await getInitialFeed();
  return <CommunityHomePage initialFeed={initialFeed} />;
}
