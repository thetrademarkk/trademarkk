import { ProfileView } from "./profile-view";

// Pure client shell (profile data loads via the API) — static per username
// instead of a per-request SSR invocation. See post/[id]/page.tsx.
export function generateStaticParams() {
  return [];
}

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return <ProfileView username={username} />;
}
