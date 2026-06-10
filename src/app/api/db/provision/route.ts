import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/server/auth";
import { platformDb } from "@/server/db/platform";
import { userDatabases } from "@/server/db/platform-schema";
import { provisionDatabase, mintDbToken } from "@/server/turso-platform";
import { hasTursoApi } from "@/server/env";
import { rateLimit } from "@/server/rate-limit";
import { isAllowedOrigin } from "@/server/origin-check";
import { createLibsqlDb } from "@/lib/db/adapters/libsql";
import { runMigrations } from "@/lib/db/migrations";

/** Creates the user's hosted journal DB (idempotent). Requires a verified session. */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { allowed } = await rateLimit(`provision:${session.user.id}`, 5, 300);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const existing = await platformDb
    .select()
    .from(userDatabases)
    .where(eq(userDatabases.userId, session.user.id))
    .get();
  if (existing) {
    return NextResponse.json({
      dbName: existing.dbName,
      storageMode: existing.storageMode,
      provisioned: true,
    });
  }

  if (!hasTursoApi()) {
    return NextResponse.json(
      {
        error:
          "Hosted storage is not configured on this deployment. Use 'Bring your own database' or demo mode, or set TURSO_PLATFORM_API_TOKEN.",
      },
      { status: 503 }
    );
  }

  try {
    const { name, hostname } = await provisionDatabase(session.user.id);
    // Bootstrap the journal schema server-side so the client lands on a ready DB.
    const token = await mintDbToken(name);
    const db = createLibsqlDb(`https://${hostname}`, token);
    await runMigrations(db);

    await platformDb.insert(userDatabases).values({
      userId: session.user.id,
      dbName: name,
      hostname,
      storageMode: "hosted",
      status: "active",
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ dbName: name, storageMode: "hosted", provisioned: true });
  } catch (e) {
    console.error("[provision] failed", e);
    return NextResponse.json({ error: "Provisioning failed. Try again." }, { status: 500 });
  }
}
