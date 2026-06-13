/**
 * Link OG unfurl preview cards e2e:
 *   API sign-up → verify in DB → sign-in (cookie) → create a post with a SAFE
 *   external https URL whose unfurl we pre-seed in the link_unfurls cache (so
 *   the card render is deterministic, no live network) → the rich preview card
 *   shows the title + site → create a post with a PRIVATE/loopback URL → NO
 *   card renders and NO error is thrown → the unfurl API returns null for the
 *   private URL → 360px mobile renders the card cleanly → zero console errors.
 *
 *   BASE_URL=http://localhost:3100 node scripts/e2e-unfurl.mjs
 *
 * Leaves its own user behind for the DB-level sweep (e2e-unfurl-*@example.com).
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

// FNV-1a 32-bit — must match urlHash() in src/features/community/unfurl.ts.
function urlHash(url) {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const TS = Date.now();
const EMAIL = `e2e-unfurl-${TS}@example.com`;
const PASSWORD = "e2e-Passw0rd-123";

const SAFE_URL = `https://example.com/article/${TS}`;
const SAFE_TITLE = `E2E unfurl ${TS} — clean NIFTY breakout writeup`;
const SAFE_SITE = "Example Journal";
const SAFE_MARKER = `E2E safe-link ${TS}`;
const PRIVATE_MARKER = `E2E private-link ${TS}`;
const PRIVATE_URL = "https://127.0.0.1/internal/secret";

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

const signUpAndAuthenticate = async () => {
  const api = ctx.request;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await api.post(`${BASE}/api/auth/sign-up/email`, {
      data: { email: EMAIL, password: PASSWORD, name: "E2E Unfurl" },
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

// Pre-seed the unfurl cache so the SAFE-URL card render is deterministic (no
// dependency on a live external site during the test).
const seedUnfurlCache = async () => {
  const db = dbClient();
  if (!db) throw new Error("no platform DB creds — cannot seed unfurl cache");
  await db.execute({
    sql: `INSERT INTO link_unfurls (url_hash, url, title, description, image, site_name, fetched_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(url_hash) DO UPDATE SET title=excluded.title, site_name=excluded.site_name, fetched_at=excluded.fetched_at`,
    args: [
      urlHash(SAFE_URL),
      SAFE_URL,
      SAFE_TITLE,
      "A clean writeup of the move with entries and exits.",
      null,
      SAFE_SITE,
      new Date().toISOString(),
    ],
  });
};

console.log(`Unfurl e2e on ${BASE} as ${EMAIL}`);

await step("feed renders logged-out", async () => {
  await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByText("House rules").waitFor({ timeout: 60000 });
});

await step("sign up + verify + sign in (API); seed unfurl cache", async () => {
  await signUpAndAuthenticate();
  await seedUnfurlCache();
  await page.reload({ waitUntil: "domcontentloaded" });
});

const createPost = async (body) => {
  await page.getByRole("button", { name: "Write a post" }).first().click();
  const bodyField = page.getByLabel("Your post");
  await bodyField.waitFor({ state: "visible", timeout: 15000 });
  await bodyField.fill(body);
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
};

await step("create a post containing a SAFE external link", async () => {
  await createPost(`${SAFE_MARKER} — read this: ${SAFE_URL} for the full plan.`);
  await page.locator("article", { hasText: SAFE_MARKER }).first().waitFor({ timeout: 20000 });
});

await step("rich unfurl card renders with title + site name", async () => {
  const c = page.locator("article", { hasText: SAFE_MARKER }).first();
  const cardLink = c.locator("[data-unfurl-card]").first();
  await cardLink.waitFor({ timeout: 20000 });
  await cardLink.getByText(SAFE_TITLE, { exact: false }).waitFor({ timeout: 10000 });
  // Opens in a new tab, no-opener.
  const target = await cardLink.getAttribute("target");
  const rel = await cardLink.getAttribute("rel");
  const href = await cardLink.getAttribute("href");
  if (target !== "_blank") throw new Error(`unfurl card target=${target}, expected _blank`);
  if (!String(rel).includes("noopener"))
    throw new Error(`unfurl card rel missing noopener: ${rel}`);
  if (href !== SAFE_URL) throw new Error(`unfurl card href=${href}, expected ${SAFE_URL}`);
});

await step("create a post with a PRIVATE/loopback link", async () => {
  await createPost(`${PRIVATE_MARKER} — ${PRIVATE_URL} should never unfurl.`);
  await page.locator("article", { hasText: PRIVATE_MARKER }).first().waitFor({ timeout: 20000 });
});

await step("private/loopback link shows NO card and no error", async () => {
  const c = page.locator("article", { hasText: PRIVATE_MARKER }).first();
  // Give the lazy unfurl fetch a moment to resolve to null.
  await page.waitForTimeout(2500);
  const cardCount = await c.locator("[data-unfurl-card]").count();
  if (cardCount !== 0) throw new Error(`private link unexpectedly rendered ${cardCount} card(s)`);
});

await step("API: the unfurl endpoint returns null for the private-link post", async () => {
  // Resolve the private-link post id from its permalink.
  const c = page.locator("article", { hasText: PRIVATE_MARKER }).first();
  const href = await c.locator('a[href*="/community/post/"]').first().getAttribute("href");
  const postId = String(href).match(/\/community\/post\/([^/?#]+)/)?.[1];
  if (!postId) throw new Error("could not resolve private-link post id");
  const res = await ctx.request.get(`${BASE}/api/community/unfurl?postId=${postId}`, {
    headers: { origin: BASE },
  });
  if (res.status() !== 200) throw new Error(`unfurl API status ${res.status()} (expected 200)`);
  const json = await res.json();
  if (json.unfurl !== null)
    throw new Error(`expected unfurl=null for private URL, got ${JSON.stringify(json.unfurl)}`);
});

await step("mobile 360px: unfurl card has no horizontal overflow", async () => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded" });
  const c = page.locator("article", { hasText: SAFE_MARKER }).first();
  await c.waitFor({ timeout: 20000 });
  const cardLink = c.locator("[data-unfurl-card]").first();
  await cardLink.waitFor({ timeout: 15000 });
  const overflow = await c.evaluate((el) => el.scrollWidth - el.clientWidth);
  if (overflow > 1) throw new Error(`post card with unfurl overflows by ${overflow}px at 360px`);
});

await browser.close();
if (issues.length) {
  console.log(`\n${failed} step(s) failed; ${issues.length} issue(s):`);
  for (const i of issues) console.log("  " + i);
  process.exit(1);
}
console.log("\nUnfurl e2e passed (zero console errors).");
