import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/server/auth";
import { platformDb } from "@/server/db/platform";
import { userDatabases } from "@/server/db/platform-schema";
import { mintDbToken } from "@/server/turso-platform";
import { rateLimit } from "@/server/rate-limit";
import { isAllowedOrigin } from "@/server/origin-check";

/** Mints a short-lived read-write token scoped to the session user's hosted DB only. */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // At most 10 mints/hour, and never two within 10 minutes — a 24h token plus
  // the client's 24h cache is already ample, so anything faster is abuse (or a
  // buggy client loop).
  const { allowed } = await rateLimit(`token:${session.user.id}`, 10, 3600);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const { allowed: notTooSoon } = await rateLimit(`token-burst:${session.user.id}`, 1, 600);
  if (!notTooSoon)
    return NextResponse.json(
      { error: "A token was just issued — try again shortly" },
      { status: 429 }
    );

  const row = await platformDb
    .select()
    .from(userDatabases)
    .where(eq(userDatabases.userId, session.user.id))
    .get();
  if (!row) return NextResponse.json({ error: "No database provisioned" }, { status: 404 });

  try {
    const token = await mintDbToken(row.dbName, session.user.id);
    return NextResponse.json({
      url: `https://${row.hostname}`,
      token,
      storageMode: row.storageMode,
      expiresInDays: 1,
    });
  } catch (e) {
    console.error("[token] mint failed", e);
    return NextResponse.json({ error: "Could not mint database token" }, { status: 500 });
  }
}
