/**
 * One-shot Vercel production deploy.
 *   VERCEL_TOKEN=xxx node scripts/deploy-vercel.mjs
 *
 * - Links (or creates) the project non-interactively
 * - Pushes secrets from .env.local to Production (URLs are set to the live domain)
 * - Deploys to production, then re-points auth URLs at the assigned domain and redeploys
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const token = process.env.VERCEL_TOKEN;
if (!token) {
  console.error("Set VERCEL_TOKEN. Create one at https://vercel.com/account/tokens");
  process.exit(1);
}
const PROJECT = "trademark";
const T = `--token ${token}`;
const run = (cmd, opts = {}) => execSync(cmd, { stdio: "pipe", encoding: "utf-8", ...opts });
const runLoud = (cmd) => execSync(cmd, { stdio: "inherit" });

// Parse .env.local
const env = {};
for (const line of readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

// Secrets pushed as-is (URLs handled separately after we know the domain).
const SECRET_KEYS = [
  "TURSO_PLATFORM_DB_URL",
  "TURSO_PLATFORM_DB_TOKEN",
  "TURSO_PLATFORM_API_TOKEN",
  "TURSO_ORG_SLUG",
  "TURSO_GROUP",
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
];

console.log("→ Linking project…");
runLoud(`vercel link --yes --project ${PROJECT} ${T}`);

const setEnv = (key, value) => {
  if (value === undefined || value === "") return;
  try {
    run(`vercel env rm ${key} production --yes ${T}`);
  } catch {
    /* not set yet */
  }
  run(`vercel env add ${key} production ${T}`, { input: value + "\n" });
  console.log(`  set ${key}`);
};

console.log("→ Pushing secrets to Production…");
for (const key of SECRET_KEYS) setEnv(key, env[key]);

console.log("→ First production deploy…");
const url = run(`vercel deploy --prod --yes ${T}`).trim().split(/\s+/).pop();
console.log("  deployed:", url);

console.log("→ Pointing auth URLs at the live domain & redeploying…");
setEnv("BETTER_AUTH_URL", url);
setEnv("NEXT_PUBLIC_APP_URL", url);
const finalUrl = run(`vercel deploy --prod --yes ${T}`).trim().split(/\s+/).pop();

console.log("\n✅ Live at:", finalUrl);
console.log("Add this domain to Google OAuth redirect URIs if using Google sign-in.");
