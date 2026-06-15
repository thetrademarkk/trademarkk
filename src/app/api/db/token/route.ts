import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/server/auth";
import { platformDb } from "@/server/db/platform";
import { userDatabases } from "@/server/db/platform-schema";
import { mintDbToken } from "@/server/turso-platform";
import { rateLimit } from "@/server/rate-limit";
import { isAllowedOrigin } from "@/server/origin-check";

/** Mints a long-lived (30d) read-write token scoped to the session user's hosted DB only. */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Abuse cap only: at most 10 mints/hour. No sub-10-minute burst block — tokens
  // are long-lived (30d) and the client caches ~28d, so legitimate re-mints (new
  // tab, cache miss) are rare and must never be blocked with "try again shortly".
  // A runaway client still hits the hourly cap.
  const { allowed } = await rateLimit(`token:${session.user.id}`, 10, 3600);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

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
      expiresInDays: 28,
    });
  } catch (e) {
    console.error("[token] mint failed", e);
    return NextResponse.json({ error: "Could not mint database token" }, { status: 500 });
  }
}
