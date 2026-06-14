import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { platformDb } from "@/server/db/platform";
import { profiles } from "@/server/db/platform-schema";
import { ProfileView } from "./profile-view";

// Pure client shell (profile data loads via the API) — static per username
// instead of a per-request SSR invocation. See post/[id]/page.tsx.
export function generateStaticParams() {
  return [];
}

/** Per-profile SEO: real title/description, canonical and OG so each trader's
 *  profile is its own indexable URL rather than folding into /community. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const canonical = `/community/u/${username}`;
  try {
    const row = await platformDb
      .select({ displayName: profiles.displayName, bio: profiles.bio })
      .from(profiles)
      .where(eq(profiles.username, username))
      .get();
    if (!row)
      return {
        title: "Trader not found — TradeMarkk Community",
        alternates: { canonical },
      };
    const title = `${row.displayName} (@${username})`;
    const description = row.bio
      ? row.bio.replace(/\s+/g, " ").trim().slice(0, 160)
      : `${row.displayName} on TradeMarkk — trade ideas, journals and discussion. Educational only, not investment advice.`;
    return {
      title: `${title} — TradeMarkk Community`,
      description,
      alternates: { canonical },
      openGraph: { title, description, type: "profile" },
      twitter: { card: "summary", title, description },
    };
  } catch {
    return { title: "TradeMarkk Community", alternates: { canonical } };
  }
}

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return <ProfileView username={username} />;
}
