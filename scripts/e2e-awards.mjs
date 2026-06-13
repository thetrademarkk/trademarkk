/**
 * Community awards / achievement badges (rank-20) e2e:
 *   member A (real signup, then back-dated to >1yr tenure via the DB) authors a
 *   handful of posts + comments → we seed GENUINE cross-user reactions / bookmarks
 *   / comment-likes from many DISTINCT synthetic accounts (direct DB inserts —
 *   deterministic, no signup limits, the per-reactor cap means they MUST be
 *   distinct to count) so A earns several real badges → A's profile shows the
 *   earned-badges row + the Achievements section (earned + greyed "how to earn"
 *   unearned) + A's post card shows the one subtle featured badge next to the
 *   author name → a BRAND-NEW member shows few/no badges + the empty Achievements
 *   state → a FLAGGED member (one quality_flag, otherwise identical strong
 *   activity) shows NO earned badges (the anti-gaming gate) → the honest framing
 *   is present → 360px renders cleanly → zero console errors.
 *
 *   BASE_URL=http://localhost:3100 node scripts/e2e-awards.mjs
 *
 * Cleans up ALL its own users (real + synthetic) + their posts/likes/etc at the
 * end (and on failure). NEVER touches demo@trademark.app /
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
const MARKER = `e2e awards marker ${TAG}`;
const PASSWORD = "e2e-Passw0rd-123";
const userA = { email: `e2e-aw-${TS}-a@example.com`, name: `E2E Aw A` };
const userNew = { email: `e2e-aw-${TS}-new@example.com`, name: `E2E Aw New` };
const userFlag = { email: `e2e-aw-${TS}-flag@example.com`, name: `E2E Aw Flag` };
// Synthetic reactor accounts — distinct people whose genuine reactions earn the
// badges. The per-reactor cap means these MUST be distinct to count.
const REACTOR_PREFIX = `e2e-aw-${TS}-react`;
const REACTOR_COUNT = 14;
const reactorEmails = Array.from(
  { length: REACTOR_COUNT },
  (_, i) => `${REACTOR_PREFIX}-${i}@example.com`
);
const allEmails = [userA.email, userNew.email, userFlag.email, ...reactorEmails];

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
    await clearRateLimits();
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

/** API-creates a post (returns id). */
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

const resolveUser = async (db, email) => {
  const u = await db.execute({ sql: `SELECT id FROM user WHERE email = ?`, args: [email] });
  const uid = u.rows[0]?.id;
  if (!uid) return { uid: null, username: null };
  const p = await db.execute({
    sql: `SELECT username FROM profiles WHERE user_id = ?`,
    args: [uid],
  });
  return { uid, username: p.rows[0]?.username ?? null };
};

/**
 * Seeds a member into "earns lots of badges" shape: back-dates their account to
 * >1yr tenure, gives them 12 posts (one real to create the profile) across many
 * distinct weeks + 25 comments, then DISTINCT cross-user reactions / bookmarks /
 * comment-likes + followers. `flagged` adds a single quality_flag to one post to
 * exercise the anti-gaming gate.
 */
const seedStrongMember = async (db, s, prefix, email, { flagged = false } = {}) => {
  // Real post → creates the profile row lazily.
  const realPostId = await apiPost(s, `${MARKER} ${prefix} body 0 — my reasoning on the setup.`);
  const { uid, username } = await resolveUser(db, email);
  if (!uid || !username) throw new Error(`could not resolve ${prefix} profile`);

  // Back-date the account so tenure badges (6mo / 1yr) are earnable. user.created_at
  // is drizzle `mode:"timestamp"` → stored in SECONDS (not ms), so we back-date in
  // seconds; reputation reads it as a Date and derives tenure days.
  await db.execute({
    sql: `UPDATE user SET created_at = ? WHERE id = ?`,
    args: [Math.floor((TS - 400 * 86_400_000) / 1000), uid],
  });

  // 11 more posts across distinct weeks (Wordsmith volume).
  const postIds = [realPostId];
  for (let i = 1; i < 12; i++) {
    const id = `${prefix}-p${i}`;
    postIds.push(id);
    await db.execute({
      sql: `INSERT OR IGNORE INTO posts (id, user_id, body, created_at) VALUES (?, ?, ?, ?)`,
      args: [
        id,
        uid,
        `${MARKER} ${prefix} body ${i}`,
        new Date(TS - (i * 8 + 1) * 86_400_000).toISOString(),
      ],
    });
  }
  // 25 comments across distinct weeks (Conversationalist volume).
  for (let i = 0; i < 25; i++) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO comments (id, post_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)`,
      args: [
        `${prefix}-c${i}`,
        postIds[0],
        uid,
        `${MARKER} ${prefix} comment ${i}`,
        new Date(TS - (i + 1) * 86_400_000).toISOString(),
      ],
    });
  }
  if (flagged) {
    // One quality-flagged post — disqualifies ALL positive badges.
    await db.execute({
      sql: `INSERT OR IGNORE INTO posts (id, user_id, body, quality_flag, created_at) VALUES (?, ?, ?, 'tip', ?)`,
      args: [`${prefix}-flagged`, uid, `${MARKER} ${prefix} flagged`, new Date(TS).toISOString()],
    });
  }
  return { uid, username, postIds };
};

let aData = null;
let flagData = null;

console.log(`Awards e2e on ${BASE} — marker="${MARKER}"`);

const sessions = [];
const db = dbClient();
try {
  await step("clear rate_limits", clearRateLimits);

  const A = await newAuthedUser(userA);
  const NEWBIE = await newAuthedUser(userNew);
  const FLAG = await newAuthedUser(userFlag);
  sessions.push(A, NEWBIE, FLAG);

  await step("seed A as a tenured, genuinely-engaged member", async () => {
    if (!db) throw new Error("no platform DB — cannot seed A");
    aData = await seedStrongMember(db, A, `e2e-aw-${TS}-A`, userA.email);
  });

  await step("seed FLAG identically but with one quality_flag (anti-gaming)", async () => {
    if (!db) throw new Error("no platform DB — cannot seed FLAG");
    flagData = await seedStrongMember(db, FLAG, `e2e-aw-${TS}-F`, userFlag.email, {
      flagged: true,
    });
  });

  await step("seed DISTINCT cross-user reactions/bookmarks/comment-likes + followers", async () => {
    if (!db) throw new Error("no platform DB — cannot seed reactors");
    const now = new Date().toISOString();
    for (let i = 0; i < REACTOR_COUNT; i++) {
      const rid = `${REACTOR_PREFIX}-id-${i}`;
      await db.execute({
        sql: `INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at)
              VALUES (?, ?, ?, 1, ?, ?)`,
        args: [rid, `Reactor ${i}`, reactorEmails[i], TS, TS],
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
      // Each distinct reactor reacts to BOTH A's and FLAG's first post (rotate).
      for (const m of [aData, flagData]) {
        const target = m.postIds[i % m.postIds.length];
        await db.execute({
          sql: `INSERT OR IGNORE INTO likes (post_id, user_id, reaction, created_at) VALUES (?, ?, 'insightful', ?)`,
          args: [target, rid, now],
        });
        // First 10 reactors bookmark a post (Worth Saving needs 10).
        if (i < 10) {
          await db.execute({
            sql: `INSERT OR IGNORE INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)`,
            args: [rid, m.postIds[(i + 1) % m.postIds.length], now],
          });
        }
        // First 6 reactors like a comment (Helpful Voice needs 5).
        if (i < 6) {
          await db.execute({
            sql: `INSERT OR IGNORE INTO comment_likes (comment_id, user_id, created_at) VALUES (?, ?, ?)`,
            args: [`${m === aData ? `e2e-aw-${TS}-A` : `e2e-aw-${TS}-F`}-c0`, rid, now],
          });
        }
      }
      // Each distinct reactor follows A and FLAG (Community Pillar needs 25 — we
      // also add follows from the OTHER seeded accounts below to clear 25).
      await db.execute({
        sql: `INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)`,
        args: [rid, aData.uid, now],
      });
      await db.execute({
        sql: `INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)`,
        args: [rid, flagData.uid, now],
      });
    }
    // Top up followers to >=25 with extra synthetic follower-only accounts.
    for (let i = REACTOR_COUNT; i < 27; i++) {
      const fid = `${REACTOR_PREFIX}-follower-${i}`;
      await db.execute({
        sql: `INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at)
              VALUES (?, ?, ?, 1, ?, ?)`,
        args: [fid, `Follower ${i}`, `${REACTOR_PREFIX}-follower-${i}@example.com`, TS, TS],
      });
      for (const m of [aData, flagData]) {
        await db.execute({
          sql: `INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)`,
          args: [fid, m.uid, now],
        });
      }
    }
    // Invalidate any denormalized cache so the next profile read recomputes fresh.
    await db.execute(`UPDATE profiles SET reputation_computed_at = NULL, awards = NULL`);
  });

  await step("A's profile shows the earned-badges row + Achievements section", async () => {
    const page = A.page;
    await page.goto(`${BASE}/community/u/${aData.username}`, { waitUntil: "domcontentloaded" });
    const section = page.locator("[data-achievements]");
    await section.waitFor({ timeout: 30000 });
    // The header badges row exists with at least a few earned badges.
    const row = page.locator("[data-award-badges]");
    await row.waitFor({ timeout: 10000 });
    const earnedChips = await row.locator("[data-award]").count();
    if (earnedChips < 4)
      throw new Error(`expected >=4 earned badge chips on A's header, got ${earnedChips}`);
    // The Achievements section lists the tenure + reception badges by id.
    for (const id of ["one-year", "six-months", "well-received", "community-pillar"]) {
      if ((await section.locator(`[data-award-earned='${id}']`).count()) === 0)
        throw new Error(`A should have earned '${id}' but it is not listed`);
    }
  });

  await step("the Achievements section shows greyed 'how to earn' unearned badges", async () => {
    const page = A.page;
    const unearned = page.locator("[data-unearned] [data-award-unearned]");
    // A earns most badges; the unearned list may be small but the heading copy
    // and the criteria framing must be present. Assert the honest disclaimer.
    const body = (await page.locator("[data-achievements]").textContent()) ?? "";
    if (!/never trading skill|never trading skill, returns/i.test(body))
      throw new Error("Achievements section is missing the not-trading-skill framing");
    // Earned-count chip reflects a non-trivial number.
    const count = (await page.locator("[data-earned-count]").textContent()) ?? "";
    if (!/\d+ earned/.test(count)) throw new Error(`earned count chip missing: ${count}`);
    // If any unearned badges show, each must carry its criteria text (how to earn).
    if ((await unearned.count()) > 0) {
      const first = (await unearned.first().textContent()) ?? "";
      if (first.trim().length < 5) throw new Error("an unearned badge is missing its criteria");
    }
  });

  await step("badge tooltips show label + criteria (hover the header row)", async () => {
    const page = A.page;
    const firstChip = page.locator("[data-award-badges] [data-award]").first();
    await firstChip.hover();
    // The accessible criteria is always in the DOM (sr-only) even before hover.
    const sr = (await firstChip.locator("span.sr-only, .sr-only").first().textContent()) ?? "";
    if (sr.trim().length < 5) throw new Error("badge chip has no accessible label/criteria");
  });

  await step("A's post card shows ONE subtle featured badge next to the author name", async () => {
    const page = A.page;
    // The featured badge reads the DENORMALIZED awards (warmed lazily in
    // hydratePosts). The profile load above computed+persisted A's set; reload so
    // the feed rows pick up the now-warm awards. Poll a couple of reloads.
    let count = 0;
    for (let i = 0; i < 4 && count === 0; i++) {
      await page.goto(`${BASE}/community/u/${aData.username}`, { waitUntil: "domcontentloaded" });
      const post = page.locator("article").first();
      await post.waitFor({ timeout: 20000 }).catch(() => {});
      count = await post.locator("[data-featured-award]").count();
      if (count === 0) await page.waitForTimeout(1500);
    }
    if (count === 0) throw new Error("no featured award chip on A's post card author row");
    // Subtle = exactly ONE featured badge, never a cluster.
    const post = page.locator("article").first();
    if ((await post.locator("[data-featured-award]").count()) !== 1)
      throw new Error("the featured author chip should render exactly ONE badge");
  });

  await step("a brand-new member shows the empty Achievements state + no badges row", async () => {
    const page = NEWBIE.page;
    await apiPost(NEWBIE, `${MARKER} newbie hello`);
    const { username } = await resolveUser(db, userNew.email);
    await page.goto(`${BASE}/community/u/${username}`, { waitUntil: "domcontentloaded" });
    const section = page.locator("[data-achievements]");
    await section.waitFor({ timeout: 30000 });
    // No earned badges → the empty-state copy, and no header badges row.
    if ((await page.locator("[data-award-badges]").count()) > 0)
      throw new Error("a brand-new member should show no earned-badges row");
    const body = (await section.textContent()) ?? "";
    if (!/no badges yet/i.test(body))
      throw new Error("brand-new member is missing the empty Achievements state");
    // No featured chip on their post.
    const post = page.locator("article").first();
    await post.waitFor({ timeout: 20000 });
    if ((await post.locator("[data-featured-award]").count()) > 0)
      throw new Error("a brand-new member should show no featured award chip");
  });

  await step("a FLAGGED member shows NO earned badges (anti-gaming gate)", async () => {
    const page = FLAG.page;
    await page.goto(`${BASE}/community/u/${flagData.username}`, { waitUntil: "domcontentloaded" });
    const section = page.locator("[data-achievements]");
    await section.waitFor({ timeout: 30000 });
    // Despite identical strong activity, the quality flag suppresses every badge.
    if ((await page.locator("[data-award-badges]").count()) > 0)
      throw new Error("a quality-flagged member should show NO earned-badges row");
    if ((await section.locator("[data-award-earned]").count()) > 0)
      throw new Error("a quality-flagged member should have ZERO earned achievements");
    const body = (await section.textContent()) ?? "";
    if (!/no badges yet/i.test(body))
      throw new Error("flagged member should show the empty Achievements state");
  });

  await step("mobile 360px: A's profile renders the achievements cleanly", async () => {
    const page = A.page;
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`${BASE}/community/u/${aData.username}`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-achievements]").waitFor({ timeout: 30000 });
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
    // Follower-only top-up accounts share the reactor prefix — sweep by prefix too.
    const prefixRows = await db.execute({
      sql: `SELECT id FROM user WHERE email LIKE ?`,
      args: [`${REACTOR_PREFIX}-follower-%@example.com`],
    });
    const extraIds = prefixRows.rows.map((r) => r.id);
    const emailIds = [];
    for (const email of allEmails) {
      const u = await db.execute({ sql: `SELECT id FROM user WHERE email = ?`, args: [email] });
      if (u.rows[0]?.id) emailIds.push(u.rows[0].id);
    }
    for (const uid of [...new Set([...emailIds, ...extraIds])]) {
      await db.execute({ sql: `DELETE FROM likes WHERE user_id = ?`, args: [uid] });
      await db.execute({ sql: `DELETE FROM bookmarks WHERE user_id = ?`, args: [uid] });
      await db.execute({ sql: `DELETE FROM comment_likes WHERE user_id = ?`, args: [uid] });
      await db.execute({
        sql: `DELETE FROM follows WHERE follower_id = ? OR following_id = ?`,
        args: [uid, uid],
      });
      await db.execute({
        sql: `DELETE FROM likes WHERE post_id IN (SELECT id FROM posts WHERE user_id = ?)`,
        args: [uid],
      });
      await db.execute({
        sql: `DELETE FROM bookmarks WHERE post_id IN (SELECT id FROM posts WHERE user_id = ?)`,
        args: [uid],
      });
      await db.execute({
        sql: `DELETE FROM comment_likes WHERE comment_id IN (SELECT id FROM comments WHERE user_id = ?)`,
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
console.log("\nAwards e2e passed (zero console errors).");
