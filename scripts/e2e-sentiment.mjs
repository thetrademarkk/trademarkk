/**
 * Optional Bullish/Bearish sentiment tag (rank-10) e2e:
 *   clear su:/si:/track: rate_limits → 3 distinct users (API sign-up + verify +
 *   sign-in) each post about a unique synthetic $ticker with bull / bull / bear
 *   sentiment via the UI composer toggle → the per-symbol page
 *   (/community/s/<TICKER>) shows the 24h gauge ≈ 67% bullish with the
 *   "NOT advice or a recommendation" disclaimer → a DIFFERENT ticker with only
 *   2 sentiment-bearing posts reads "not enough signal" → the composer toggle
 *   persists a chosen lean (round-trips onto the post card) → 360px renders
 *   cleanly → zero console errors.
 *
 *   BASE_URL=http://localhost:3100 node scripts/e2e-sentiment.mjs
 *
 * Cleans up ALL its own users + posts + post_symbols at the end (and on
 * failure) — 0 e2e-sent-* rows must remain.
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
// Synthetic, almost-certainly-unique tickers (free-entry $cashtags accept any
// uppercase token) so assertions are independent of real platform activity.
const SIGNAL = `TMB${TAG}`; // 3 sentiment-bearing posts (bull/bull/bear) → gauge shows
const THIN = `TMN${TAG}`; // 2 sentiment-bearing posts → "not enough signal"
const PASSWORD = "e2e-Passw0rd-123";
const users = [0, 1, 2].map((i) => ({
  email: `e2e-sent-${TS}-${i}@example.com`,
  name: `E2E Sent ${i}`,
}));
const allEmails = users.map((u) => u.email);

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

/**
 * Posts a body via the UI composer, optionally setting a sentiment via the
 * toggle. Asserts the 201. The composer disables the sentiment toggle until a
 * $cashtag is in the body, so we fill the body (with the ticker) first.
 */
const postViaUi = async (page, body, sentiment) => {
  await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded" });
  const openBtn = page.getByRole("button", { name: "Write a post" }).first();
  await openBtn.waitFor({ state: "visible", timeout: 20000 });
  const bodyField = page.getByLabel("Your post");
  // The button click can race React hydration (handler not attached yet) — retry
  // the open until the composer dialog's body field actually appears.
  for (let attempt = 0; attempt < 5; attempt++) {
    await openBtn.click();
    try {
      await bodyField.waitFor({ state: "visible", timeout: 4000 });
      break;
    } catch {
      if (attempt === 4) throw new Error("composer body field never appeared after Write a post");
      await page.waitForTimeout(500);
    }
  }
  await bodyField.fill(body);
  if (sentiment) {
    const label = sentiment === "bull" ? "Bullish" : "Bearish";
    const btn = page.getByRole("button", { name: label, exact: true }).first();
    await btn.waitFor({ state: "visible", timeout: 10000 });
    await btn.click();
    if ((await btn.getAttribute("aria-pressed")) !== "true")
      throw new Error(`${label} toggle did not become pressed`);
  }
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

console.log(`Sentiment e2e on ${BASE} — signal=$${SIGNAL} thin=$${THIN}`);

const sessions = [];
try {
  await step("clear su:/si:/track: rate_limits", clearRateLimits);

  await step("3 distinct authors post bull/bull/bear on the signal ticker", async () => {
    const leans = ["bull", "bull", "bear"];
    for (let i = 0; i < users.length; i++) {
      const s = await newAuthedUser(users[i]);
      sessions.push(s);
      await postViaUi(s.page, `E2E sentiment ${TS} #${i} — $${SIGNAL} read.`, leans[i]);
    }
  });

  // Reuse the first two authors for the thin ticker (2 sentiment-bearing posts
  // → below the min sample of 3 → "not enough signal").
  await step("2 sentiment-bearing posts on the thin ticker (below the gate)", async () => {
    const db = dbClient();
    for (let i = 0; i < 2; i++) {
      if (db) await db.execute(`DELETE FROM rate_limits WHERE key LIKE 'post:%'`);
      await postViaUi(sessions[i].page, `E2E thin ${TS} #${i} — $${THIN} read.`, "bull");
    }
  });

  const viewer = sessions[0];

  await step("signal ticker gauge ≈ 67% bullish with not-advice disclaimer (API)", async () => {
    const res = await viewer.ctx.request.get(
      `${BASE}/api/community/sentiment?symbol=${SIGNAL}&window=24h`,
      { headers: { origin: BASE } }
    );
    if (res.status() !== 200) throw new Error(`sentiment API ${res.status()}`);
    const { gauge } = await res.json();
    if (!gauge?.hasSignal) throw new Error(`gauge has no signal (total=${gauge?.total})`);
    if (gauge.total !== 3) throw new Error(`expected 3 sentiment posts, got ${gauge.total}`);
    if (gauge.bull !== 2 || gauge.bear !== 1)
      throw new Error(`expected bull=2 bear=1, got bull=${gauge.bull} bear=${gauge.bear}`);
    if (gauge.bullPct !== 67) throw new Error(`expected bullPct 67, got ${gauge.bullPct}`);
  });

  await step("thin ticker reads 'not enough signal' (below min sample)", async () => {
    const res = await viewer.ctx.request.get(
      `${BASE}/api/community/sentiment?symbol=${THIN}&window=24h`,
      { headers: { origin: BASE } }
    );
    const { gauge } = await res.json();
    if (gauge.total !== 2) throw new Error(`expected 2 sentiment posts, got ${gauge.total}`);
    if (gauge.hasSignal) throw new Error(`thin ticker should NOT have a signal (2 < 3)`);
  });

  await step("per-symbol page renders the gauge + disclaimer", async () => {
    const page = viewer.page;
    await page.goto(`${BASE}/community/s/${SIGNAL}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("sentiment-gauge").waitFor({ timeout: 30000 });
    const disclaimer = page.getByTestId("sentiment-gauge").locator("[data-not-advice]").first();
    await disclaimer.waitFor({ timeout: 15000 });
    const text = (await disclaimer.textContent()) ?? "";
    if (!/not advice or a recommendation/i.test(text))
      throw new Error(`disclaimer missing the wording: ${text.slice(0, 80)}`);
    // The gauge shows the bullish percentage once the sample clears the gate.
    await page.getByTestId("sentiment-gauge").getByText(/67%/).first().waitFor({ timeout: 15000 });
  });

  await step("thin-ticker page shows the 'not enough signal' copy", async () => {
    const page = viewer.page;
    await page.goto(`${BASE}/community/s/${THIN}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("sentiment-gauge").waitFor({ timeout: 30000 });
    await page
      .getByTestId("sentiment-gauge")
      .getByText(/not enough signal/i)
      .first()
      .waitFor({ timeout: 15000 });
  });

  await step("the chosen lean round-trips onto the post card (bull chip)", async () => {
    const page = viewer.page;
    await page.goto(`${BASE}/community/s/${SIGNAL}`, { waitUntil: "domcontentloaded" });
    // The first author posted "bull" — that post should carry a Bullish chip.
    await page.locator('[data-sentiment="bull"]').first().waitFor({ timeout: 20000 });
    await page.locator('[data-sentiment="bear"]').first().waitFor({ timeout: 20000 });
  });

  await step("mobile 360px: /community/s/<ticker> has no horizontal overflow", async () => {
    const page = viewer.page;
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(`${BASE}/community/s/${SIGNAL}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("sentiment-gauge").waitFor({ timeout: 20000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    if (overflow > 1) throw new Error(`symbol page overflows by ${overflow}px at 360px`);
  });

  await step("mobile 360px: composer sentiment toggle is reachable & gated", async () => {
    const page = viewer.page;
    await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Write a post" }).first().click();
    const bodyField = page.getByLabel("Your post");
    await bodyField.waitFor({ state: "visible", timeout: 15000 });
    // No ticker yet → the Bullish button is disabled.
    const bull = page.getByRole("button", { name: "Bullish", exact: true }).first();
    await bull.waitFor({ state: "visible", timeout: 10000 });
    if (!(await bull.isDisabled()))
      throw new Error("Bullish toggle should be disabled with no $cashtag");
    // Add a ticker → the toggle enables.
    await bodyField.fill(`mobile $${SIGNAL} check`);
    await page.waitForFunction(
      () => {
        const b = [...document.querySelectorAll("button")].find(
          (el) => el.textContent?.trim() === "Bullish"
        );
        return b && !b.disabled;
      },
      { timeout: 10000 }
    );
  });
} finally {
  for (const s of sessions) await s.ctx.close().catch(() => {});
  await browser.close();
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
console.log("\nSentiment e2e passed (zero console errors).");
