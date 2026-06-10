import "server-only";
import { createClient } from "@tursodatabase/api";
import { serverEnv, hasTursoApi } from "./env";

/**
 * Turso Platform API — provisions per-user databases and mints short-lived,
 * single-database tokens. The org token never leaves the server.
 */
function api() {
  if (!hasTursoApi()) {
    throw new Error(
      "Hosted storage is not configured. Set TURSO_PLATFORM_API_TOKEN and TURSO_ORG_SLUG."
    );
  }
  return createClient({ org: serverEnv.tursoOrg, token: serverEnv.tursoApiToken });
}

export async function provisionDatabase(userId: string): Promise<{ name: string; hostname: string }> {
  const slug = userId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
  const suffix = Math.random().toString(36).slice(2, 7);
  const name = `tm-${slug}-${suffix}`;
  const db = await api().databases.create(name, { group: serverEnv.tursoGroup });
  return { name: db.name, hostname: db.hostname };
}

export async function mintDbToken(dbName: string): Promise<string> {
  const token = await api().databases.createToken(dbName, {
    expiration: "7d",
    authorization: "full-access",
  });
  return token.jwt;
}

export async function deleteDatabase(dbName: string): Promise<void> {
  await api().databases.delete(dbName);
}
