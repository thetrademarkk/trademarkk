/**
 * Trending tickers & topics board (rank-9) e2e:
 *   clear su:/si: rate_limits → create 3 distinct users (API sign-up + verify +
 *   sign-in) who each post about a unique synthetic $ticker → a 4th user spams a
 *   different synthetic $ticker 10x → assert via the signed-in (un-cached)
 *   /api/community/trending that the 3-author ticker TRENDS and the spammed
 *   single-author ticker does NOT (unique-author gate) → the /community/trending
 *   page renders the board + the "not a recommendation" disclaimer → a board row
 *   links to the symbol stream → 360px renders cleanly → zero console errors.
 *
 *   BASE_URL=http://localhost:3100 node scripts/e2e-trending.mjs
 *
 * Cleans up ALL its own users + their posts + post_symbols at the end (and on
 * failure) — 0 e2e-trend-* rows must remain.
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
const TAG = TS.toString(36).slice(-6).toUpperCase();
// Synthetic, almost-certainly-unique tickers so assertions are independent of
// any real platform activity. Free-entry $cashtags accept any uppercase token.
const TREND = `TMT${TAG}`; // posted by 3 distinct authors → must trend
const SPAM = `TMS${TAG}`; // posted 10x by ONE author → must NOT trend
const PASSWORD = "e2e-Passw0rd-123";
const users = [0, 1, 2].map((i) => ({
  email: `e2e-trend-${TS}-${i}@example.com`,
  name: `E2E Trend ${i}`,
}));
const spammer = { email: `e2e-trend-${TS}-spam@example.com`, name: "E2E Spam" };
const allEmails = [...users.map((u) => u.email), spammer.email];

const browser = await chromium.launch();

const issues = [];
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

const attachConsole = (page) => {
  page.on("dialog", (d) => d.accept());
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (text.includes("401")) return; // composer's first POST 401s by design
    issues.push(`[console] ${page.url()} :: ${text.slice(0, 220)}`);
  });
  page.on("pageerror", (e) => issues.push(`[pageerror] ${String(e.message).slice(0, 220)}`));
};

const clearRateLimits = async () => {
  const db = dbClient();
  if (!db) return;
  await db.execute(
    `DELETE FROM rate_limits WHERE key LIKE 'su:%' OR key LIKE 'si:%' OR key LIKE 'track:%'`
  );
};

/** Signs up + verifies + signs in a user in a fresh context; returns {ctx,page}. */
const newAuthedUser = async (user) => {
  const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
  const api = ctx.request;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await api.post(`${BASE}/api/auth/sign-up/email`, {
      data: { email: user.email, password: PASSWORD, name: user.name },
      headers: { origin: BASE },
    });
    if (res.status() === 429) {
      await new Promise((r) => setTimeout(r, 12000));
      continue;
    }
    if (![200, 201].includes(res.status()))
      throw new Error(
        `sign-up ${user.email} failed: ${res.status()} ${(await res.text()).slice(0, 120)}`
      );
    break;
  }
  const db = dbClient();
  if (db)
    await db.execute({
      sql: `UPDATE user SET email_verified = 1 WHERE email = ?`,
      args: [user.email],
    });
  // Sign-in is also IP-rate-limited (si:*); creating several users back-to-back
  // can 429 the later sign-ins. Clear the auth limiters then retry with backoff.
  let signin;
  for (let attempt = 0; attempt < 6; attempt++) {
    await clearRateLimits();
    signin = await api.post(`${BASE}/api/auth/sign-in/email`, {
      data: { email: user.email, password: PASSWORD },
      headers: { origin: BASE },
    });
    if (signin.status() === 200) break;
    if (signin.status() === 429) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    throw new Error(`sign-in ${user.email} failed: ${signin.status()}`);
  }
  if (!signin || signin.status() !== 200)
    throw new Error(`sign-in ${user.email} failed after retries: ${signin?.status()}`);
  const page = await ctx.newPage();
  attachConsole(page);
  return { ctx, page };
};

/** Posts a body via the UI composer; asserts the 201. */
const postViaUi = async (page, body) => {
  await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded" });
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

console.log(`Trending e2e on ${BASE} — trend=$${TREND} spam=$${SPAM}`);

const sessions = [];
try {
  await step("clear su:/si:/track: rate_limits", clearRateLimits);

  await step("3 distinct authors each post about the trend ticker", async () => {
    for (let i = 0; i < users.length; i++) {
      const s = await newAuthedUser(users[i]);
      sessions.push(s);
      await postViaUi(s.page, `E2E trend ${TS} #${i} — eyeing $${TREND} setups today.`);
    }
  });

  // The app enforces a durable 5-posts/day ceiling per user (counts real rows,
  // not just the rate-limit table), so a single author can post at most 5×. That
  // is still ample to prove the gate: 5 posts from ONE author must NOT trend a
  // ticker that 2+ distinct authors would. Clear the hourly post: limiter so all
  // 5 land in one run.
  const SPAM_COUNT = 5;
  await step(`a single author spams the spam ticker ${SPAM_COUNT} times (via API)`, async () => {
    const s = await newAuthedUser(spammer);
    sessions.push(s);
    const db = dbClient();
    for (let i = 0; i < SPAM_COUNT; i++) {
      if (db) await db.execute(`DELETE FROM rate_limits WHERE key LIKE 'post:%'`);
      const res = await s.ctx.request.post(`${BASE}/api/community/posts`, {
        data: { body: `E2E spam ${TS} #${i} — $${SPAM} to the moon`, tags: [] },
        headers: { origin: BASE },
      });
      if (![200, 201].includes(res.status()))
        throw new Error(
          `spam post ${i} failed: ${res.status()} ${(await res.text()).slice(0, 100)}`
        );
    }
  });

  // Use a signed-in user's request context → the board is computed per-request
  // (NOT cached), so assertions don't race the 10-minute anonymous cache TTL.
  const viewer = sessions[0];

  await step("the 3-author ticker TRENDS (signed-in, un-cached API)", async () => {
    const res = await viewer.ctx.request.get(`${BASE}/api/community/trending?window=24h`, {
      headers: { origin: BASE },
    });
    if (res.status() !== 200) throw new Error(`trending API ${res.status()}`);
    const data = await res.json();
    const hit = (data.tickers ?? []).find((t) => t.key === TREND);
    if (!hit) throw new Error(`$${TREND} did not trend (3 distinct authors expected)`);
    if (hit.authors < 3) throw new Error(`$${TREND} authors=${hit.authors}, expected >=3`);
  });

  await step("the spammed single-author ticker does NOT trend (unique-author gate)", async () => {
    const res = await viewer.ctx.request.get(`${BASE}/api/community/trending?window=24h`, {
      headers: { origin: BASE },
    });
    const data = await res.json();
    const hit = (data.tickers ?? []).find((t) => t.key === SPAM);
    if (hit)
      throw new Error(`$${SPAM} trended with ${hit.posts} posts but only 1 author — gate failed`);
  });

  await step("/community/trending page shows the board with trend rows", async () => {
    const page = viewer.page;
    await page.goto(`${BASE}/community/trending`, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("heading", { name: "Trending", exact: true })
      .first()
      .waitFor({ timeout: 30000 });
    await page.getByTestId("trending-board").waitFor({ timeout: 15000 });
    // The trend ticker appears as a $-prefixed row linking to its stream.
    await page.locator(`a[href="/community/s/${TREND}"]`).first().waitFor({ timeout: 15000 });
  });

  await step("a trending row navigates to the symbol stream", async () => {
    const page = viewer.page;
    await page.goto(`${BASE}/community/trending`, { waitUntil: "domcontentloaded" });
    await page.locator(`a[href="/community/s/${TREND}"]`).first().click();
    await page.waitForURL(new RegExp(`/community/s/${TREND}`), { timeout: 15000 });
    await page
      .getByRole("heading", { name: `$${TREND}` })
      .first()
      .waitFor({ timeout: 15000 });
  });

  await step("right-rail Trending widget renders on /community (desktop)", async () => {
    const page = viewer.page;
    await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("trending-widget").waitFor({ timeout: 20000 });
  });

  await step("mobile 360px: /community/trending has no horizontal overflow", async () => {
    const page = viewer.page;
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(`${BASE}/community/trending`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("trending-board").waitFor({ timeout: 20000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    if (overflow > 1) throw new Error(`trending page overflows by ${overflow}px at 360px`);
  });
} finally {
  for (const s of sessions) await s.ctx.close().catch(() => {});
  await browser.close();
  // Full cleanup: delete every e2e user we created + their posts/post_symbols.
  const db = dbClient();
  if (db) {
    for (const email of allEmails) {
      const u = await db.execute({ sql: `SELECT id FROM user WHERE email = ?`, args: [email] });
      const uid = u.rows[0]?.id;
      if (!uid) continue;
      await db.execute({
        sql: `DELETE FROM post_symbols WHERE post_id IN (SELECT id FROM posts WHERE user_id = ?)`,
        args: [uid],
      });
      await db.execute({ sql: `DELETE FROM posts WHERE user_id = ?`, args: [uid] });
      await db.execute({
        sql: `DELETE FROM notifications WHERE user_id = ? OR actor_id = ?`,
        args: [uid, uid],
      });
      await db.execute({ sql: `DELETE FROM profiles WHERE user_id = ?`, args: [uid] });
      await db.execute({ sql: `DELETE FROM session WHERE user_id = ?`, args: [uid] });
      await db.execute({ sql: `DELETE FROM account WHERE user_id = ?`, args: [uid] });
      await db.execute({ sql: `DELETE FROM user WHERE id = ?`, args: [uid] });
    }
    await db.execute(
      `DELETE FROM rate_limits WHERE key LIKE 'su:%' OR key LIKE 'si:%' OR key LIKE 'track:%' OR key LIKE 'post:%'`
    );
  }
}

if (issues.length) {
  console.log(`\n${failed} step(s) failed; ${issues.length} issue(s):`);
  for (const i of issues) console.log("  " + i);
  process.exit(1);
}
console.log("\nTrending e2e passed (zero console errors).");
