/**
 * Creates (or reuses) a hosted demo account and fills it with ~3 months of
 * realistic sample data — for screenshots and product demos.
 *
 * Credentials come from the environment ONLY — there are no defaults, so the
 * script fails loudly instead of ever baking a password into the repo:
 *
 *   DEMO_EMAIL=demo@example.com DEMO_PASSWORD=... npx tsx scripts/seed-demo-user.ts
 *   BASE_URL=https://your-deployment DEMO_EMAIL=... DEMO_PASSWORD=... npx tsx scripts/seed-demo-user.ts
 */
import { createLibsqlDb } from "../src/lib/db/adapters/libsql";
import { seedSampleData } from "../src/lib/db/seed";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.DEMO_EMAIL;
const PASSWORD = process.env.DEMO_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error(
    "Missing DEMO_EMAIL / DEMO_PASSWORD environment variables.\n" +
      "Refusing to run with hardcoded credentials — set both and retry:\n" +
      "  DEMO_EMAIL=demo@example.com DEMO_PASSWORD=<secret> npx tsx scripts/seed-demo-user.ts"
  );
  process.exit(1);
}

// Better Auth (rightly) rejects origin-less browser-style requests in production.
const HEADERS = { "Content-Type": "application/json", Origin: BASE };

async function authedCookie(): Promise<string> {
  const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: "Demo Trader" }),
  });
  let res = signUp;
  if (!signUp.ok) {
    console.log("  sign-up not possible (exists?) — signing in");
    res = await fetch(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  }
  const cookies = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookies) throw new Error("no session cookie returned");
  return cookies;
}

async function main() {
  console.log(`Seeding demo user on ${BASE} as ${EMAIL}`);
  const cookie = await authedCookie();

  const prov = await fetch(`${BASE}/api/db/provision`, {
    method: "POST",
    headers: { cookie, Origin: BASE },
  });
  if (!prov.ok) throw new Error(`provision failed: ${prov.status} ${await prov.text()}`);
  console.log("  provisioned:", ((await prov.json()) as { dbName: string }).dbName);

  const tok = await fetch(`${BASE}/api/db/token`, {
    method: "POST",
    headers: { cookie, Origin: BASE },
  });
  if (!tok.ok) throw new Error(`token failed: ${tok.status} ${await tok.text()}`);
  const { url, token } = (await tok.json()) as { url: string; token: string };

  const db = createLibsqlDb(url, token);
  const onboarded = await db.execute(`SELECT value FROM settings WHERE key = 'onboarded'`);
  if (onboarded.rows.length > 0) {
    console.log("  already seeded — skipping (delete the account to reseed)");
  } else {
    console.log("  generating ~3 months of trades, journals & rule checks…");
    await seedSampleData(db);
  }

  const trades = await db.execute(`SELECT COUNT(*) AS c, SUM(net_pnl) AS pnl FROM trades`);
  const journals = await db.execute(`SELECT COUNT(*) AS c FROM journal_entries`);
  console.log(
    `\n✅ Demo account ready: ${trades.rows[0]?.c} trades, ${journals.rows[0]?.c} journal entries`
  );
  console.log(`   Login: ${EMAIL} (password from your DEMO_PASSWORD env)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
