import "server-only";
import { createClient } from "@tursodatabase/api";
import { eq, and } from "drizzle-orm";
import { serverEnv, hasTursoApi } from "./env";
import { platformDb } from "./db/platform";
import { userDatabases } from "./db/platform-schema";

/**
 * Turso Platform API — provisions per-user databases and mints single-database
 * tokens that expire after 30d (the client caches ~28d and re-mints with a
 * buffer before expiry, so a working session never loses its DB connection).
 * The org token never leaves the server.
 */
function api() {
  if (!hasTursoApi()) {
    throw new Error(
      "Hosted storage is not configured. Set TURSO_PLATFORM_API_TOKEN and TURSO_ORG_SLUG."
    );
  }
  return createClient({ org: serverEnv.tursoOrg, token: serverEnv.tursoApiToken });
}

export async function provisionDatabase(
  userId: string
): Promise<{ name: string; hostname: string }> {
  const slug = userId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 20);
  const suffix = Math.random().toString(36).slice(2, 7);
  const name = `tm-${slug}-${suffix}`;
  const db = await api().databases.create(name, { group: serverEnv.tursoGroup });
  return { name: db.name, hostname: db.hostname };
}

/**
 * Mints a single-database, full-access token for `dbName` that expires after 30d
 * — but ONLY after verifying that `dbName` is the database mapped to `userId` in
 * the platform DB. Without this ownership check, any signed-in user who learned
 * (or guessed) another user's `db_name` could mint a full-access token to that
 * user's private journal (latent privilege escalation). The check lives INSIDE
 * the mint so every caller is protected, not just the ones that remember to do
 * it themselves.
 *
 * Long-lived (30d) on purpose: this is a personal trading journal, not a banking
 * session — a day-long token forced a re-mint per session and tripped the route's
 * burst guard ("try again shortly"). The client caches it ~28d and re-mints with a
 * buffer before expiry, so a working session never loses its DB connection.
 */
export async function mintDbToken(dbName: string, userId: string): Promise<string> {
  const owned = await platformDb
    .select({ dbName: userDatabases.dbName })
    .from(userDatabases)
    .where(and(eq(userDatabases.userId, userId), eq(userDatabases.dbName, dbName)))
    .get();
  if (!owned) {
    throw new Error("Database does not belong to this user");
  }
  const token = await api().databases.createToken(dbName, {
    expiration: "30d",
    authorization: "full-access",
  });
  return token.jwt;
}

export async function deleteDatabase(dbName: string): Promise<void> {
  await api().databases.delete(dbName);
}
