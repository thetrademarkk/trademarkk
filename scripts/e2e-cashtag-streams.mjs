/**
 * $cashtag + per-symbol stream pages (rank-6 "KILLER") e2e:
 *   clear su:/si: rate_limits → sign up + verify + sign in (API) → create a post
 *   with "$NIFTY $RELIANCE" → both symbols appear on their /community/s/ pages →
 *   a $cashtag link navigates to the symbol stream → not-advice banner present →
 *   edit the post removing $RELIANCE → it leaves $RELIANCE's stream but stays on
 *   $NIFTY's → 360px renders cleanly → zero console errors.
 *
 *   BASE_URL=http://localhost:3100 node scripts/e2e-cashtag-streams.mjs
 *
 * Leaves its own user behind for the DB-level sweep (e2e-cash-*@example.com).
 */
import { chromium } from "playwright";
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";

function loadEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? "";
    }
  } catch {
    /* rely on real env */
  }
}
loadEnv();
const dbClient = () => {
  const url = process.env.TURSO_PLATFORM_DB_URL;
  const token = process.env.TURSO_PLATFORM_DB_TOKEN;
  if (!url || !token) return null;
  return createClient({ url: url.replace(/^libsql:\/\//, "https://"), authToken: token });
};

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const TS = Date.now();
const EMAIL = `e2e-cash-${TS}@example.com`;
const PASSWORD = "e2e-Passw0rd-123";
const MARKER = `E2E cashtag ${TS}`;
const BODY = `${MARKER} — watching $NIFTY and $RELIANCE into expiry.`;
const EDITED = `${MARKER} — just $NIFTY now, dropped the other one.`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
const page = await ctx.newPage();

const issues = [];
page.on("dialog", (d) => d.accept());
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const text = m.text();
  if (text.includes("401")) return; // composer's first POST 401s by design
  issues.push(`[console] ${page.url()} :: ${text.slice(0, 220)}`);
});
page.on("pageerror", (e) => issues.push(`[pageerror] ${String(e.message).slice(0, 220)}`));

let failed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    issues.push(`[step] ${name} :: ${String(e.message).slice(0, 200)}`);
    console.log(`  FAIL ${name}: ${String(e.message).slice(0, 200)}`);
  }
};

// Sign-up is rate-limited 3/h/IP and a blocked sign-up returns a fake success
// (anti-enumeration), so a few e2e runs silently no-op. Clear the su:/si: rows.
const clearSignupRateLimits = async () => {
  const db = dbClient();
  if (!db) return;
  await db.execute(`DELETE FROM rate_limits WHERE key LIKE 'su:%' OR key LIKE 'si:%'`);
};

const signUpAndAuthenticate = async () => {
  const api = ctx.request;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await api.post(`${BASE}/api/auth/sign-up/email`, {
      data: { email: EMAIL, password: PASSWORD, name: "E2E Cash" },
      headers: { origin: BASE },
    });
    if (res.status() === 429) {
      await page.waitForTimeout(12000);
      continue;
    }
    if (![200, 201].includes(res.status()))
      throw new Error(`sign-up failed: ${res.status()} ${(await res.text()).slice(0, 120)}`);
    break;
  }
  const db = dbClient();
  if (db)
    await db.execute({ sql: `UPDATE user SET email_verified = 1 WHERE email = ?`, args: [EMAIL] });
  const signin = await api.post(`${BASE}/api/auth/sign-in/email`, {
    data: { email: EMAIL, password: PASSWORD },
    headers: { origin: BASE },
  });
  if (signin.status() !== 200)
    throw new Error(`sign-in failed: ${signin.status()} ${(await signin.text()).slice(0, 120)}`);
};

console.log(`Cashtag-streams e2e on ${BASE} as ${EMAIL}`);

await step("clear su:/si: rate_limits", clearSignupRateLimits);

await step("symbol stream renders logged-out with the not-advice banner", async () => {
  await page.goto(`${BASE}/community/s/NIFTY`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await page.getByRole("heading", { name: "$NIFTY" }).first().waitFor({ timeout: 60000 });
  await page.locator("[data-not-advice]").first().waitFor({ timeout: 15000 });
});

await step("sign up + verify + sign in (API), then create a $NIFTY $RELIANCE post", async () => {
  await signUpAndAuthenticate();
  await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Write a post" }).first().click();
  const bodyField = page.getByLabel("Your post");
  await bodyField.waitFor({ state: "visible", timeout: 15000 });
  await bodyField.fill(BODY);
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/community/posts") &&
        r.request().method() === "POST" &&
        r.status() === 201,
      { timeout: 30000 }
    ),
    page.getByRole("button", { name: "Post", exact: true }).click(),
  ]);
});

const cardOn = (loc) => loc.locator("article", { hasText: MARKER }).first();

await step("post appears on the $NIFTY stream page", async () => {
  await page.goto(`${BASE}/community/s/NIFTY`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "$NIFTY" }).first().waitFor({ timeout: 30000 });
  await cardOn(page).waitFor({ timeout: 20000 });
});

await step("post also appears on the $RELIANCE stream page", async () => {
  await page.goto(`${BASE}/community/s/RELIANCE`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "$RELIANCE" }).first().waitFor({ timeout: 30000 });
  // Company-name enrichment proves the master lookup wired through.
  await page.getByText("Reliance Industries", { exact: false }).first().waitFor({ timeout: 15000 });
  await cardOn(page).waitFor({ timeout: 20000 });
});

await step("a $cashtag link in the post navigates to the symbol stream", async () => {
  await page.goto(`${BASE}/community/s/NIFTY`, { waitUntil: "domcontentloaded" });
  const c = cardOn(page);
  await c.waitFor({ timeout: 20000 });
  // The mentioned-tickers row / body link points at /community/s/RELIANCE.
  await c.locator('a[href="/community/s/RELIANCE"]').first().click();
  await page.waitForURL(/\/community\/s\/RELIANCE/, { timeout: 15000 });
  await page.getByRole("heading", { name: "$RELIANCE" }).first().waitFor({ timeout: 15000 });
});

let postUrl;
await step("open the post detail to edit it", async () => {
  await page.goto(`${BASE}/community/s/NIFTY`, { waitUntil: "domcontentloaded" });
  const c = cardOn(page);
  await c.waitFor({ timeout: 20000 });
  const href = await c.locator('a[href*="/community/post/"]').first().getAttribute("href");
  postUrl = href?.startsWith("http") ? href : `${BASE}${href}`;
  await page.goto(postUrl, { waitUntil: "domcontentloaded" });
  await page.locator("article", { hasText: MARKER }).first().waitFor({ timeout: 20000 });
});

await step("edit the post removing $RELIANCE → PATCH 200", async () => {
  await page.getByRole("button", { name: "Post options" }).first().click();
  await page.getByRole("menuitem", { name: /Edit post/ }).click();
  const bodyField = page.getByLabel("Edit post body");
  await bodyField.waitFor({ timeout: 10000 });
  await bodyField.fill(EDITED);
  await Promise.all([
    page.waitForResponse(
      (r) =>
        /\/api\/community\/posts\/[^/]+$/.test(r.url()) &&
        r.request().method() === "PATCH" &&
        r.status() === 200,
      { timeout: 20000 }
    ),
    page.getByRole("button", { name: "Save changes" }).click(),
  ]);
});

await step("post stays on $NIFTY's stream after the edit", async () => {
  await page.goto(`${BASE}/community/s/NIFTY`, { waitUntil: "domcontentloaded" });
  await cardOn(page).waitFor({ timeout: 20000 });
});

await step("post is GONE from $RELIANCE's stream after the edit (API check)", async () => {
  // Query the symbol-scoped feed directly so we don't depend on cache TTL paint.
  const res = await ctx.request.get(`${BASE}/api/community/posts?sort=latest&symbol=RELIANCE`, {
    headers: { origin: BASE },
  });
  if (res.status() !== 200) throw new Error(`feed query failed: ${res.status()}`);
  const data = await res.json();
  const hit = (data.posts ?? []).some((p) => (p.body ?? "").includes(MARKER));
  if (hit) throw new Error("post still tagged to $RELIANCE after the cashtag was removed");
});

await step("mobile 360px: symbol stream has no horizontal overflow", async () => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`${BASE}/community/s/NIFTY`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "$NIFTY" }).first().waitFor({ timeout: 20000 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  if (overflow > 1) throw new Error(`symbol stream overflows by ${overflow}px at 360px`);
});

await browser.close();
if (issues.length) {
  console.log(`\n${failed} step(s) failed; ${issues.length} issue(s):`);
  for (const i of issues) console.log("  " + i);
  process.exit(1);
}
console.log("\nCashtag-streams e2e passed (zero console errors).");
