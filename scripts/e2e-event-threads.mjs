/**
 * Event / market-session threads (rank-18) e2e:
 *   The server must run with EVENTS_TEST_DATE_OVERRIDE=1 so `?date=` injects a
 *   deterministic IST date (we NEVER rely on the real clock).
 *
 *   1. A simulated NIFTY-expiry Thursday (2026-06-11): the "Today" events card
 *      lists an Expiry-Day + Market-Open thread, each with a time-box badge.
 *   2. Opening the expiry thread shows the PINNED "opened automatically by
 *      TradeMarkk" header (the house account is clearly labelled automated, not
 *      a person) and the thread is authored by the house @trademark profile.
 *   3. A seeded synthetic user posts a comment INTO the thread → it persists
 *      (reload → still there).
 *   4. A simulated weekend (2026-06-13) shows the graceful "Markets closed
 *      today" empty state.
 *   5. 360px renders cleanly (no horizontal overflow). Zero console errors.
 *
 *   BASE_URL=http://localhost:3100 node scripts/e2e-event-threads.mjs
 *
 * Cleans up ONLY its own synthetic user(s) + the event_threads/posts it created
 * on the simulated days. NEVER touches demo@trademark.app, raashish1601@gmail.com
 * or mahajandeepakshi03@gmail.com.
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
const PASSWORD = "e2e-Passw0rd-123";
// Simulated IST days the engine resolves deterministically (NOT the real clock).
const EXPIRY_DAY = "2026-06-11"; // Thursday → NIFTY expiry + market open
const CLOSED_DAY = "2026-06-13"; // Saturday → markets closed
const user = { email: `e2e-evt-${TS}@example.com`, name: `E2E Evt ${TS}` };

// The synthetic days we materialize threads on — for targeted cleanup. NEVER
// delete threads on other dates (a real visit may have created today's).
const SIM_DATES = [EXPIRY_DAY, CLOSED_DAY];

const issues = [];
let failed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    issues.push(`[step] ${name} :: ${String(e.message).slice(0, 220)}`);
    console.log(`  FAIL ${name}: ${String(e.message).slice(0, 220)}`);
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

const browser = await chromium.launch();

const newAuthedUser = async (u) => {
  const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
  const api = ctx.request;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await api.post(`${BASE}/api/auth/sign-up/email`, {
      data: { email: u.email, password: PASSWORD, name: u.name },
      headers: { origin: BASE },
    });
    if (res.status() === 429) {
      await new Promise((r) => setTimeout(r, 12000));
      continue;
    }
    if (![200, 201].includes(res.status()))
      throw new Error(`sign-up failed: ${res.status()} ${(await res.text()).slice(0, 120)}`);
    break;
  }
  const db = dbClient();
  if (db)
    await db.execute({
      sql: `UPDATE user SET email_verified = 1 WHERE email = ?`,
      args: [u.email],
    });
  let signin;
  for (let attempt = 0; attempt < 6; attempt++) {
    await clearRateLimits();
    signin = await api.post(`${BASE}/api/auth/sign-in/email`, {
      data: { email: u.email, password: PASSWORD },
      headers: { origin: BASE },
    });
    if (signin.status() === 200) break;
    if (signin.status() === 429) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    throw new Error(`sign-in failed: ${signin.status()}`);
  }
  if (!signin || signin.status() !== 200) throw new Error(`sign-in failed: ${signin?.status()}`);
  const page = await ctx.newPage();
  attachConsole(page);
  return { ctx, page };
};

console.log(`Event-threads e2e on ${BASE} (expiry=${EXPIRY_DAY} closed=${CLOSED_DAY})`);

let session;
let expiryPostId = null;
try {
  await step("preflight: date override is enabled on the server", async () => {
    const ctx = await browser.newContext();
    const res = await ctx.request.get(`${BASE}/api/community/events?date=${EXPIRY_DAY}`, {
      headers: { origin: BASE },
    });
    if (res.status() !== 200) throw new Error(`events API ${res.status()}`);
    const data = await res.json();
    if (data.date !== EXPIRY_DAY)
      throw new Error(
        `?date override ignored (got ${data.date}). Start the server with EVENTS_TEST_DATE_OVERRIDE=1.`
      );
    await ctx.close();
  });

  await step("expiry day materializes Expiry + Market-Open threads (API, idempotent)", async () => {
    const ctx = await browser.newContext();
    const get = () =>
      ctx.request
        .get(`${BASE}/api/community/events?date=${EXPIRY_DAY}`, { headers: { origin: BASE } })
        .then((r) => r.json());
    const first = await get();
    const types = first.threads.map((t) => t.type).sort();
    if (JSON.stringify(types) !== JSON.stringify(["expiry-day", "market-open"]))
      throw new Error(`expected expiry+open, got ${JSON.stringify(types)}`);
    if (first.marketClosed) throw new Error("expiry day must not be marketClosed");
    expiryPostId = first.threads.find((t) => t.type === "expiry-day").postId;
    // Idempotent: a second resolve returns the SAME post ids.
    const second = await get();
    const a = first.threads.map((t) => t.postId).sort();
    const b = second.threads.map((t) => t.postId).sort();
    if (JSON.stringify(a) !== JSON.stringify(b))
      throw new Error("re-materialization changed post ids (not idempotent)");
    await ctx.close();
  });

  await step("seed a synthetic user", async () => {
    await clearRateLimits();
    session = await newAuthedUser(user);
  });

  await step("the 'Today' events card lists the expiry + open threads with badges", async () => {
    const page = session.page;
    // Inject the simulated date into the client query by overriding the API
    // request — the card calls /api/community/events; rewrite to add ?date=.
    await page.route("**/api/community/events*", (route) => {
      const u = new URL(route.request().url());
      u.searchParams.set("date", EXPIRY_DAY);
      route.continue({ url: u.toString() });
    });
    await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded" });
    // Two cards exist (mobile lg:hidden + desktop hidden lg:block) — target the
    // one that is actually visible at the current viewport.
    const card = page.getByTestId("events-card").locator("visible=true").first();
    await card.waitFor({ timeout: 30000 });
    await card.locator('[data-event-row="expiry-day"]').first().waitFor({ timeout: 15000 });
    await card.locator('[data-event-row="market-open"]').first().waitFor({ timeout: 15000 });
    const badge = await card.locator('[data-event-row="expiry-day"]').first().textContent();
    if (!/Expiry Day · /.test(badge ?? ""))
      throw new Error(`expiry badge missing time-box: ${(badge ?? "").slice(0, 60)}`);
  });

  await step("the expiry thread page shows the PINNED automated header", async () => {
    const page = session.page;
    await page.goto(`${BASE}/community/post/${expiryPostId}`, { waitUntil: "domcontentloaded" });
    const header = page.getByTestId("event-thread-header").first();
    await header.waitFor({ timeout: 30000 });
    const automated = header.locator("[data-event-automated]").first();
    const text = (await automated.textContent()) ?? "";
    if (!/opened automatically by TradeMarkk/i.test(text))
      throw new Error(`automated label missing: ${text.slice(0, 80)}`);
    // The thread is authored by the house @trademark account.
    await page.getByText("@trademark", { exact: false }).first().waitFor({ timeout: 15000 });
  });

  await step("posting a comment into the thread persists across reload", async () => {
    const page = session.page;
    const marker = `e2e expiry take ${TS}`;
    await page.getByLabel("Write a comment").first().fill(marker);
    await Promise.all([
      page.waitForResponse(
        (r) =>
          /\/api\/community\/posts\/[^/]+\/comments/.test(r.url()) &&
          r.request().method() === "POST" &&
          r.status() === 201,
        { timeout: 30000 }
      ),
      page.getByRole("button", { name: "Comment", exact: true }).first().click(),
    ]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText(marker).first().waitFor({ timeout: 20000 });
  });

  await step("a weekend shows the graceful 'Markets closed today' state", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
    const page = await ctx.newPage();
    attachConsole(page);
    await page.route("**/api/community/events*", (route) => {
      const u = new URL(route.request().url());
      u.searchParams.set("date", CLOSED_DAY);
      route.continue({ url: u.toString() });
    });
    await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("events-card").locator("visible=true").first();
    await card.waitFor({ timeout: 30000 });
    const closed = card.locator("[data-events-closed]").first();
    await closed.waitFor({ timeout: 15000 });
    const text = (await closed.textContent()) ?? "";
    if (!/Markets closed today/i.test(text))
      throw new Error(`closed copy missing: ${text.slice(0, 80)}`);
    await ctx.close();
  });

  await step("mobile 360px: the events card has no horizontal overflow", async () => {
    const page = session.page;
    await page.setViewportSize({ width: 360, height: 780 });
    await page.unroute("**/api/community/events*").catch(() => {});
    await page.route("**/api/community/events*", (route) => {
      const u = new URL(route.request().url());
      u.searchParams.set("date", EXPIRY_DAY);
      route.continue({ url: u.toString() });
    });
    await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("events-card").first().waitFor({ timeout: 25000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    if (overflow > 1) throw new Error(`community overflows by ${overflow}px at 360px`);
  });
} finally {
  if (session) await session.ctx.close().catch(() => {});
  await browser.close();
  const db = dbClient();
  if (db) {
    // Delete the synthetic user's comments first (they hang off the house
    // thread), then the user — NEVER the protected accounts or the house account.
    const u = await db.execute({ sql: `SELECT id FROM user WHERE email = ?`, args: [user.email] });
    const uid = u.rows[0]?.id;
    if (uid) {
      await db.execute({ sql: `DELETE FROM comments WHERE user_id = ?`, args: [uid] });
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
    // Remove ONLY the event threads + their posts on the SIMULATED days we
    // created (never today's real thread). The house account stays.
    for (const date of SIM_DATES) {
      const rows = await db.execute({
        sql: `SELECT post_id FROM event_threads WHERE event_date = ?`,
        args: [date],
      });
      for (const r of rows.rows) {
        await db.execute({ sql: `DELETE FROM comments WHERE post_id = ?`, args: [r.post_id] });
        await db.execute({ sql: `DELETE FROM post_symbols WHERE post_id = ?`, args: [r.post_id] });
        await db.execute({ sql: `DELETE FROM posts WHERE id = ?`, args: [r.post_id] });
      }
      await db.execute({ sql: `DELETE FROM event_threads WHERE event_date = ?`, args: [date] });
    }
    await db.execute(
      `DELETE FROM rate_limits WHERE key LIKE 'su:%' OR key LIKE 'si:%' OR key LIKE 'track:%' OR key LIKE 'post:%' OR key LIKE 'comment:%'`
    );
  }
}

if (issues.length) {
  console.log(`\n${failed} step(s) failed; ${issues.length} issue(s):`);
  for (const i of issues) console.log("  " + i);
  process.exit(1);
}
console.log("\nEvent-threads e2e passed (zero console errors).");
