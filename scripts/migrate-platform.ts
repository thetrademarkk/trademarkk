/**
 * Creates the platform DB tables (Better Auth + user_databases) on your Turso DB.
 * Run: npm run migrate:platform
 */
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Minimal .env.local loader (no dotenv dependency).
function loadEnv() {
  try {
    const content = readFileSync(join(process.cwd(), ".env.local"), "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? "";
    }
  } catch {
    /* no .env.local — rely on real env */
  }
}

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS user (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS account (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    access_token TEXT,
    refresh_token TEXT,
    id_token TEXT,
    access_token_expires_at INTEGER,
    refresh_token_expires_at INTEGER,
    scope TEXT,
    password TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER,
    updated_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS user_databases (
    user_id TEXT PRIMARY KEY,
    db_name TEXT NOT NULL,
    hostname TEXT NOT NULL,
    storage_mode TEXT NOT NULL DEFAULT 'hosted',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    delete_after TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_session_user ON session (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_session_token ON session (token)`,
  `CREATE INDEX IF NOT EXISTS idx_account_user ON account (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification (identifier)`,
];

async function main() {
  loadEnv();
  const url = process.env.TURSO_PLATFORM_DB_URL;
  const token = process.env.TURSO_PLATFORM_DB_TOKEN;
  if (!url || !token) {
    console.error("Missing TURSO_PLATFORM_DB_URL / TURSO_PLATFORM_DB_TOKEN");
    process.exit(1);
  }
  const client = createClient({ url: url.replace(/^libsql:\/\//, "https://"), authToken: token });
  for (const sql of STATEMENTS) {
    await client.execute(sql);
    console.log("OK:", sql.trim().slice(0, 60).replace(/\s+/g, " "), "…");
  }
  const tables = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
  );
  console.log("\nPlatform DB tables:", tables.rows.map((r) => r.name).join(", "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
