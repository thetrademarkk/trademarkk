import { NextResponse } from "next/server";
import { getFollowedTags, getSession } from "@/server/community";

/** The signed-in viewer's followed tags (sorted). Empty for signed-out / on error. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ tags: [] });
  const tags = await getFollowedTags(session.user.id);
  return NextResponse.json({ tags });
}
