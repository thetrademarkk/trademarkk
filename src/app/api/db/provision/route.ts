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
  // Provisioning a hosted DB is a privileged, irreversible-ish action — require a
  // verified email so a throwaway/unverified address can't burn provisioning quota.
  if (!session.user.emailVerified)
    return NextResponse.json({ error: "Verify your email first" }, { status: 403 });

  // Provisioning is once-per-user-per-day at most (the DB is created exactly once;
  // repeated calls just re-read the existing row above).
  const { allowed } = await rateLimit(`provision:${session.user.id}`, 1, 86400);
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

  let insertedDbName: string | null = null;
  try {
    const { name, hostname } = await provisionDatabase(session.user.id);
    // Record the mapping FIRST so mintDbToken's ownership check (the dbName must
    // belong to this user) passes, then bootstrap the journal schema server-side
    // so the client lands on a ready DB. The user_id UNIQUE constraint makes a
    // concurrent provision throw here (handled below).
    await platformDb.insert(userDatabases).values({
      userId: session.user.id,
      dbName: name,
      hostname,
      storageMode: "hosted",
      status: "active",
      createdAt: new Date().toISOString(),
    });
    insertedDbName = name;
    const token = await mintDbToken(name, session.user.id);
    const db = createLibsqlDb(`https://${hostname}`, token);
    await runMigrations(db);

    return NextResponse.json({ dbName: name, storageMode: "hosted", provisioned: true });
  } catch (e) {
    // A concurrent provision (e.g. onboarding auto-connect racing a signup's
    // onAuthed) can win the user_id UNIQUE row first — the INSERT throws before
    // we set insertedDbName. That's not a failure: re-read and return the row
    // the other request created.
    if (!insertedDbName) {
      const raced = await platformDb
        .select()
        .from(userDatabases)
        .where(eq(userDatabases.userId, session.user.id))
        .get();
      if (raced) {
        return NextResponse.json({
          dbName: raced.dbName,
          storageMode: raced.storageMode,
          provisioned: true,
        });
      }
    } else {
      // We inserted the mapping but minting/migration failed — roll the row back
      // so it doesn't strand the user on an un-migrated DB; a retry re-provisions.
      await platformDb
        .delete(userDatabases)
        .where(eq(userDatabases.userId, session.user.id))
        .catch(() => undefined);
    }
    console.error("[provision] failed", e);
    return NextResponse.json({ error: "Provisioning failed. Try again." }, { status: 500 });
  }
}
