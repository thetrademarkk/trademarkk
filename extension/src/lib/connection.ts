import { createLibsqlDb } from "@/lib/db/adapters/libsql";
import { SCHEMA_VERSION } from "@/lib/db/migrations";
import type { DbClient } from "@/lib/db/types";
import { fetchHostedConnection, type AppStatus } from "./app-api";
import { getByodCreds } from "./config";

/**
 * Resolves a DbClient for the signed-in user, mirroring the web app's
 * db-session-provider — hosted via token vending, BYOD via stored creds.
 * The extension NEVER migrates databases: if the schema is older than the
 * app expects, the user opens the web app once (which migrates on connect).
 */
export type Connection =
  | { kind: "ready"; db: DbClient; mode: "hosted" | "byod" }
  | { kind: "needs-byod-creds" }
  | { kind: "setup-incomplete" }
  | { kind: "schema-outdated" };

/** Stored BYOD creds failed to connect (revoked token, deleted DB, typo…). */
export class ByodConnectError extends Error {
  constructor() {
    super("Your saved database credentials no longer work.");
    this.name = "ByodConnectError";
  }
}

async function schemaIsCurrent(db: DbClient): Promise<boolean> {
  try {
    const res = await db.execute(`SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations`);
    return Number(res.rows[0]?.v ?? 0) >= SCHEMA_VERSION;
  } catch {
    return false; // no schema_migrations table → never opened in the web app
  }
}

export async function resolveConnection(appUrl: string, status: AppStatus): Promise<Connection> {
  if (status.storageMode === "byod") {
    const creds = await getByodCreds();
    if (!creds) return { kind: "needs-byod-creds" };
    const db = createLibsqlDb(creds.url, creds.token);
    try {
      await db.execute("SELECT 1"); // validates URL + token before any UI renders
    } catch {
      throw new ByodConnectError();
    }
    if (!(await schemaIsCurrent(db))) return { kind: "schema-outdated" };
    return { kind: "ready", db, mode: "byod" };
  }
  if (status.storageMode === "hosted" || status.provisioned) {
    const conn = await fetchHostedConnection(appUrl);
    const db = createLibsqlDb(conn.url, conn.token);
    if (!(await schemaIsCurrent(db))) return { kind: "schema-outdated" };
    return { kind: "ready", db, mode: "hosted" };
  }
  // Signed in but no platform DB row: local-mode journal (lives inside the
  // web app's browser storage — unreachable from extensions by design) or
  // onboarding never finished. Both resolve in the web app.
  return { kind: "setup-incomplete" };
}
