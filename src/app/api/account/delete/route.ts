import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/server/auth";
import { platformDb } from "@/server/db/platform";
import { user, session as sessionTable, account, userDatabases } from "@/server/db/platform-schema";
import { deleteDatabase } from "@/server/turso-platform";
import { hasTursoApi } from "@/server/env";
import { isAllowedOrigin } from "@/server/origin-check";

/** Deletes the account immediately; the hosted journal DB is deleted with it. */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const row = await platformDb
    .select()
    .from(userDatabases)
    .where(eq(userDatabases.userId, userId))
    .get();

  if (row && hasTursoApi()) {
    try {
      await deleteDatabase(row.dbName);
    } catch (e) {
      console.error("[account-delete] turso delete failed (continuing)", e);
    }
  }

  await platformDb.delete(userDatabases).where(eq(userDatabases.userId, userId));
  await platformDb.delete(sessionTable).where(eq(sessionTable.userId, userId));
  await platformDb.delete(account).where(eq(account.userId, userId));
  await platformDb.delete(user).where(eq(user.id, userId));

  return NextResponse.json({ deleted: true });
}
