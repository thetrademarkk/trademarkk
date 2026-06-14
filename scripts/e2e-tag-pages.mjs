/**
 * Topic/tag pages + follow-a-tag (rank-8) e2e:
 *   clear su:/si: rate_limits -> sign up + verify + sign in (API) -> create two
 *   posts tagged #options (API) -> /community/t/options shows both + the post
 *   count + the not-advice banner -> follow the tag (UI button -> POST 200) ->
 *   the followed-tag posts appear in the Following feed (API check) -> the left
 *   rail lists the followed tag -> unfollow (UI) -> it leaves the Following feed
 *   -> 360px renders cleanly -> zero console errors.
 *
 *   BASE_URL=http://localhost:3100 node scripts/e2e-tag-pages.mjs
 *
 * Leaves its own user behind for the DB-level sweep (e2e-tag-*@example.com).
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
const EMAIL = `e2e-tag-${TS}@example.com`;
const PASSWORD = "e2e-Passw0rd-123";
const MARKER = `E2E tagpage ${TS}`;
const TAG = "options";
const BODY_A = `${MARKER} A — long premium into expiry, sizing notes.`;
const BODY_B = `${MARKER} B — rolled the spread, lesson logged.`;

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

const clearSignupRateLimits = async () => {
  const db = dbClient();
  if (!db) return;
  await db.execute(`DELETE FROM rate_limits WHERE key LIKE 'su:%' OR key LIKE 'si:%'`);
};

const signUpAndAuthenticate = async () => {
  const api = ctx.request;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await api.post(`${BASE}/api/auth/sign-up/email`, {
      data: { email: EMAIL, password: PASSWORD, name: "E2E Tag" },
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

const createPost = async (body) => {
  const res = await ctx.request.post(`${BASE}/api/community/posts`, {
    data: { body, tags: [TAG] },
    headers: { origin: BASE },
  });
  if (res.status() !== 201)
    throw new Error(`post create failed: ${res.status()} ${(await res.text()).slice(0, 120)}`);
};

console.log(`Tag-pages e2e on ${BASE} as ${EMAIL}`);

await step("clear su:/si: rate_limits", clearSignupRateLimits);

await step("tag page renders logged-out with the not-advice banner", async () => {
  await page.goto(`${BASE}/community/t/${TAG}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page
    .getByRole("heading", { name: `#${TAG}` })
    .first()
    .waitFor({ timeout: 60000 });
  await page.locator("[data-not-advice]").first().waitFor({ timeout: 15000 });
});

await step("sign up + verify + sign in (API), then create two #options posts", async () => {
  await signUpAndAuthenticate();
  await createPost(BODY_A);
  await createPost(BODY_B);
});

const cardOn = (loc) => loc.locator("article", { hasText: MARKER });

await step("both posts appear on /community/t/options", async () => {
  await page.goto(`${BASE}/community/t/${TAG}`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: `#${TAG}` })
    .first()
    .waitFor({ timeout: 30000 });
  await cardOn(page).first().waitFor({ timeout: 20000 });
  const count = await cardOn(page).count();
  if (count < 2) throw new Error(`expected 2 marker posts on the tag page, saw ${count}`);
});

await step("follow the tag (UI) -> POST /tags/options/follow 200", async () => {
  await Promise.all([
    page.waitForResponse(
      (r) =>
        /\/api\/community\/tags\/options\/follow$/.test(r.url()) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20000 }
    ),
    page
      .getByRole("button", { name: /^Follow$/ })
      .first()
      .click(),
  ]);
  await page
    .getByRole("button", { name: /Following/ })
    .first()
    .waitFor({ timeout: 10000 });
});

await step("followed-tag posts surface in the Following feed (API check)", async () => {
  const res = await ctx.request.get(`${BASE}/api/community/posts?sort=latest&scope=following`, {
    headers: { origin: BASE },
  });
  if (res.status() !== 200) throw new Error(`following feed query failed: ${res.status()}`);
  const data = await res.json();
  const hits = (data.posts ?? []).filter((p) => (p.body ?? "").includes(MARKER)).length;
  if (hits < 2) throw new Error(`expected 2 followed-tag posts in Following feed, saw ${hits}`);
});

await step("the left rail lists the followed tag on /community", async () => {
  await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded" });
  await page.getByText("Followed tags", { exact: false }).first().waitFor({ timeout: 20000 });
  await page.locator('aside a[href="/community/t/options"]').first().waitFor({ timeout: 10000 });
});

await step("unfollow the tag (UI) -> POST 200, then it leaves the Following feed", async () => {
  await page.goto(`${BASE}/community/t/${TAG}`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: /Following/ })
    .first()
    .waitFor({ timeout: 20000 });
  await Promise.all([
    page.waitForResponse(
      (r) =>
        /\/api\/community\/tags\/options\/follow$/.test(r.url()) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20000 }
    ),
    page
      .getByRole("button", { name: /Following/ })
      .first()
      .click(),
  ]);
  await page
    .getByRole("button", { name: /^Follow$/ })
    .first()
    .waitFor({ timeout: 10000 });
  const res = await ctx.request.get(`${BASE}/api/community/posts?sort=latest&scope=following`, {
    headers: { origin: BASE },
  });
  const data = await res.json();
  const hits = (data.posts ?? []).filter((p) => (p.body ?? "").includes(MARKER)).length;
  if (hits !== 0) throw new Error(`expected 0 followed-tag posts after unfollow, saw ${hits}`);
});

await step("mobile 360px: tag page has no horizontal overflow", async () => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`${BASE}/community/t/${TAG}`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: `#${TAG}` })
    .first()
    .waitFor({ timeout: 20000 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  if (overflow > 1) throw new Error(`tag page overflows by ${overflow}px at 360px`);
});

await browser.close();
if (issues.length) {
  console.log(`\n${failed} step(s) failed; ${issues.length} issue(s):`);
  for (const i of issues) console.log("  " + i);
  process.exit(1);
}
console.log("\nTag-pages e2e passed (zero console errors).");
