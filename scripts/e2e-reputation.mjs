/**
 * Community reputation / standing (rank-16) e2e:
 *   user A (real signup) posts a few times + comments → we seed GENUINE
 *   cross-user reactions/bookmarks from many DISTINCT synthetic reactor accounts
 *   (direct DB inserts — deterministic, no signup rate limits) so A earns a
 *   real standing → A's profile shows the reputation tier chip + the "why this
 *   tier" breakdown (with the reactions-from-others line populated) → A's post
 *   card shows the tier chip next to the author name → a BRAND-NEW member (no
 *   activity) shows the "New" tier on their profile and NO chip on their post →
 *   the honest "not trading skill" framing is present → 360px renders cleanly →
 *   zero console errors.
 *
 *   BASE_URL=http://localhost:3100 node scripts/e2e-reputation.mjs
 *
 * Cleans up ALL its own users (real + synthetic reactors) + their posts/likes at
 * the end (and on failure). NEVER touches demo@trademark.app /
 * raashish1601@gmail.com / mahajandeepakshi03@gmail.com.
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
const MARKER = `e2e reputation marker ${TAG}`;
const PASSWORD = "e2e-Passw0rd-123";
const userA = { email: `e2e-rep-${TS}-a@example.com`, name: `E2E Rep A` };
const userNew = { email: `e2e-rep-${TS}-new@example.com`, name: `E2E Rep New` };
// Synthetic reactor accounts (seeded directly in the DB) — distinct people whose
// genuine reactions/bookmarks earn A a real standing. The per-author cap in the
// model means these must be DISTINCT to count; one account spamming wouldn't.
const REACTOR_PREFIX = `e2e-rep-${TS}-react`;
const REACTOR_COUNT = 14;
const reactorEmails = Array.from(
  { length: REACTOR_COUNT },
  (_, i) => `${REACTOR_PREFIX}-${i}@example.com`
);
const allEmails = [userA.email, userNew.email, ...reactorEmails];

const browser = await chromium.launch();

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
    `DELETE FROM rate_limits WHERE key LIKE 'su:%' OR key LIKE 'si:%' OR key LIKE 'track:%' OR key LIKE 'post:%'`
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

/** API-creates a post (returns id). Optionally with tags + a title. */
const apiPost = async (s, body, opts = {}) => {
  const db = dbClient();
  if (db) await db.execute(`DELETE FROM rate_limits WHERE key LIKE 'post:%'`);
  const res = await s.ctx.request.post(`${BASE}/api/community/posts`, {
    data: { body, tags: opts.tags ?? [], ...(opts.title ? { title: opts.title } : {}) },
    headers: { origin: BASE },
  });
  if (![200, 201].includes(res.status()))
    throw new Error(`post failed: ${res.status()} ${(await res.text()).slice(0, 120)}`);
  return (await res.json()).id;
};

let aUserId = null;
let aUsername = null;

console.log(`Reputation e2e on ${BASE} — marker="${MARKER}"`);

const sessions = [];
const db = dbClient();
try {
  await step("clear rate_limits", clearRateLimits);

  const A = await newAuthedUser(userA);
  const NEWBIE = await newAuthedUser(userNew);
  sessions.push(A, NEWBIE);

  // Resolve A's profile, then SEED a handful of authored posts + comments
  // directly in the DB (deterministic — bypasses the durable 5/day post ceiling
  // and the comment burst limiter; reputation reads posts/comments straight from
  // the tables, so this is exactly what a genuinely active member looks like).
  // postIds[0] is a REAL API post (creates A's profile lazily via ensureProfile);
  // the rest are seeded directly to bypass the durable 5/day post ceiling.
  const postIds = Array.from({ length: 6 }, (_, i) => `e2e-rep-${TS}-p${i}`);
  await step("A authors several posts + comments (seeded)", async () => {
    if (!db) throw new Error("no platform DB — cannot seed A's content");
    // One real post → ensures A's profile row exists (created on first interaction).
    postIds[0] = await apiPost(A, `${MARKER} body 0 — sharing my reasoning on the setup.`);
    const row = await db.execute({
      sql: `SELECT id FROM user WHERE email = ?`,
      args: [userA.email],
    });
    aUserId = row.rows[0]?.id;
    const p = await db.execute({
      sql: `SELECT username FROM profiles WHERE user_id = ?`,
      args: [aUserId],
    });
    aUsername = p.rows[0]?.username;
    if (!aUserId || !aUsername) throw new Error("could not resolve A's profile");
    const now = new Date().toISOString();
    for (let i = 1; i < postIds.length; i++) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO posts (id, user_id, body, created_at) VALUES (?, ?, ?, ?)`,
        args: [
          postIds[i],
          aUserId,
          `${MARKER} body ${i} — sharing my reasoning on the setup.`,
          now,
        ],
      });
    }
    for (let i = 0; i < 4; i++) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO comments (id, post_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)`,
        args: [`e2e-rep-${TS}-c${i}`, postIds[0], aUserId, `${MARKER} comment ${i}`, now],
      });
    }
  });

  await step("seed GENUINE cross-user reactions/bookmarks from DISTINCT reactors", async () => {
    if (!db) throw new Error("no platform DB — cannot seed reactors");
    const now = new Date().toISOString();
    for (let i = 0; i < REACTOR_COUNT; i++) {
      const rid = `${REACTOR_PREFIX}-id-${i}`;
      const email = reactorEmails[i];
      await db.execute({
        sql: `INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at)
              VALUES (?, ?, ?, 1, ?, ?)`,
        args: [rid, `Reactor ${i}`, email, TS, TS],
      });
      await db.execute({
        sql: `INSERT OR IGNORE INTO profiles (user_id, username, display_name, created_at)
              VALUES (?, ?, ?, ?)`,
        args: [
          rid,
          `${REACTOR_PREFIX}_${i}`.replace(/[^a-z0-9_]/g, "_").slice(0, 20),
          `Reactor ${i}`,
          now,
        ],
      });
      // Each distinct reactor reacts to one of A's posts (rotate across posts).
      const target = postIds[i % postIds.length];
      await db.execute({
        sql: `INSERT OR IGNORE INTO likes (post_id, user_id, reaction, created_at) VALUES (?, ?, 'insightful', ?)`,
        args: [target, rid, now],
      });
      // The first 6 reactors also bookmark a post (a stronger "useful" signal).
      if (i < 6) {
        await db.execute({
          sql: `INSERT OR IGNORE INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)`,
          args: [rid, postIds[(i + 1) % postIds.length], now],
        });
      }
    }
    // Invalidate any denormalized cache so the next profile read recomputes fresh.
    await db.execute({
      sql: `UPDATE profiles SET reputation_computed_at = NULL WHERE user_id = ?`,
      args: [aUserId],
    });
  });

  await step("A's profile shows a reputation tier chip + breakdown panel", async () => {
    const page = A.page;
    await page.goto(`${BASE}/community/u/${aUsername}`, { waitUntil: "domcontentloaded" });
    const panel = page.locator("[data-reputation-panel]");
    await panel.waitFor({ timeout: 30000 });
    // The header tier chip exists and is NOT the lowest "new" tier (A earned standing).
    const tier = await panel
      .locator("[data-reputation-tier]")
      .first()
      .getAttribute("data-reputation-tier");
    if (!tier) throw new Error("no reputation tier rendered on A's profile");
    if (tier === "new") throw new Error(`A earned cross-user reactions but still shows 'new' tier`);
  });

  await step(
    "the breakdown lists 'Reactions from others' with a positive contribution",
    async () => {
      const page = A.page;
      // Expand the "Why?" breakdown.
      await page
        .getByRole("button", { name: /show standing breakdown|why/i })
        .first()
        .click();
      const detail = page.locator("[data-reputation-detail]");
      await detail.waitFor({ timeout: 10000 });
      const reactionsLine = detail.locator("[data-component='reactions']");
      if ((await reactionsLine.count()) === 0)
        throw new Error("breakdown missing the 'Reactions from others' line");
      const text = (await reactionsLine.textContent()) ?? "";
      if (!/\+/.test(text)) throw new Error(`reactions line shows no positive points: ${text}`);
    }
  );

  await step("the honest 'not trading skill' framing is present", async () => {
    const page = A.page;
    const body = (await page.locator("[data-reputation-detail]").textContent()) ?? "";
    if (!/not a measure of trading skill/i.test(body))
      throw new Error("the not-trading-skill disclaimer is missing from the breakdown");
  });

  await step("A's post card shows the tier chip next to the author name", async () => {
    const page = A.page;
    // The author chip reads the DENORMALIZED tier (warmed lazily in hydratePosts).
    // The previous profile load computed + persisted A's standing; reload so the
    // feed's post rows pick up the now-warm tier. Poll a couple of reloads since
    // the cache write is best-effort/async.
    let found = false;
    for (let i = 0; i < 4 && !found; i++) {
      await page.goto(`${BASE}/community/u/${aUsername}`, { waitUntil: "domcontentloaded" });
      const post = page.locator("article").first();
      await post.waitFor({ timeout: 20000 }).catch(() => {});
      // The chip on a post is gated to non-"new" tiers; A is Contributing+.
      found = (await post.locator("[data-reputation-tier]").count()) > 0;
      if (!found) await page.waitForTimeout(1500);
    }
    if (!found) throw new Error("no reputation chip on A's post card author row");
  });

  await step("a brand-new member shows the 'New' tier and NO chip on their post", async () => {
    const page = NEWBIE.page;
    // Newbie posts once so they have an article on their profile.
    await apiPost(NEWBIE, `${MARKER} newbie hello`);
    const db2 = dbClient();
    let newUsername = null;
    if (db2) {
      const u = await db2.execute({
        sql: `SELECT id FROM user WHERE email = ?`,
        args: [userNew.email],
      });
      const p = await db2.execute({
        sql: `SELECT username FROM profiles WHERE user_id = ?`,
        args: [u.rows[0]?.id],
      });
      newUsername = p.rows[0]?.username;
    }
    await page.goto(`${BASE}/community/u/${newUsername}`, { waitUntil: "domcontentloaded" });
    const panel = page.locator("[data-reputation-panel]");
    await panel.waitFor({ timeout: 30000 });
    const tier = await panel
      .locator("[data-reputation-tier]")
      .first()
      .getAttribute("data-reputation-tier");
    if (tier !== "new") throw new Error(`brand-new member should be 'new', got '${tier}'`);
    // On the post card itself, the "new" tier renders NO chip (only profiles show New).
    const post = page.locator("article").first();
    await post.waitFor({ timeout: 20000 });
    const chipOnPost = await post.locator("[data-reputation-tier]").count();
    if (chipOnPost > 0)
      throw new Error("a 'new' member should NOT show a reputation chip on their post card");
  });

  await step("mobile 360px: A's profile renders the standing panel cleanly", async () => {
    const page = A.page;
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`${BASE}/community/u/${aUsername}`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-reputation-panel]").waitFor({ timeout: 30000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    if (overflow > 1) throw new Error(`profile overflows by ${overflow}px at 360px`);
  });
} finally {
  for (const s of sessions) await s.ctx.close().catch(() => {});
  await browser.close();
  // Full cleanup: delete every e2e user (real + synthetic) + their content.
  if (db) {
    for (const email of allEmails) {
      const u = await db.execute({ sql: `SELECT id FROM user WHERE email = ?`, args: [email] });
      const uid = u.rows[0]?.id;
      if (!uid) continue;
      await db.execute({ sql: `DELETE FROM likes WHERE user_id = ?`, args: [uid] });
      await db.execute({ sql: `DELETE FROM bookmarks WHERE user_id = ?`, args: [uid] });
      await db.execute({
        sql: `DELETE FROM likes WHERE post_id IN (SELECT id FROM posts WHERE user_id = ?)`,
        args: [uid],
      });
      await db.execute({
        sql: `DELETE FROM bookmarks WHERE post_id IN (SELECT id FROM posts WHERE user_id = ?)`,
        args: [uid],
      });
      await db.execute({
        sql: `DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE user_id = ?)`,
        args: [uid],
      });
      await db.execute({ sql: `DELETE FROM comments WHERE user_id = ?`, args: [uid] });
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
      `DELETE FROM rate_limits WHERE key LIKE 'su:%' OR key LIKE 'si:%' OR key LIKE 'track:%' OR key LIKE 'post:%' OR key LIKE 'comment:%'`
    );
  }
}

if (issues.length) {
  console.log(`\n${failed} step(s) failed; ${issues.length} issue(s):`);
  for (const i of issues) console.log("  " + i);
  process.exit(1);
}
console.log("\nReputation e2e passed (zero console errors).");
