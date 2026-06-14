/**
 * "N new posts" live pill (rank-15) e2e:
 *   clear su:/si: rate_limits → user A signs in and opens /community (Latest) →
 *   user B (second session) API-creates a fresh synthetic post → A's feed shows
 *   the floating "N new posts" pill with count >= 1 (poll nudged via a focus
 *   event so we don't wait the full interval) → clicking it prepends B's post at
 *   the top of A's feed and clears the pill → the pill is ABSENT on the Top scope
 *   → 360px renders cleanly → zero console errors.
 *
 *   BASE_URL=http://localhost:3100 node scripts/e2e-newposts-pill.mjs
 *
 * Cleans up ALL its own users + their posts at the end (and on failure).
 * NEVER touches demo@trademark.app / raashish1601@gmail.com / mahajandeepakshi03@gmail.com.
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
// A nearly-unique marker so we can find B's new post in A's feed unambiguously.
const MARKER = `e2e new-post marker ${TAG}`;
const PASSWORD = "e2e-Passw0rd-123";
const userA = { email: `e2e-pill-${TS}-a@example.com`, name: `E2E Pill A` };
const userB = { email: `e2e-pill-${TS}-b@example.com`, name: `E2E Pill B` };
const allEmails = [userA.email, userB.email];

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
    `DELETE FROM rate_limits WHERE key LIKE 'su:%' OR key LIKE 'si:%' OR key LIKE 'track:%' OR key LIKE 'post:%'`
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

/** API-creates a post as the given session; asserts a 201 and returns the id. */
const apiPost = async (s, body) => {
  const db = dbClient();
  if (db) await db.execute(`DELETE FROM rate_limits WHERE key LIKE 'post:%'`);
  const res = await s.ctx.request.post(`${BASE}/api/community/posts`, {
    data: { body, tags: [] },
    headers: { origin: BASE },
  });
  if (![200, 201].includes(res.status()))
    throw new Error(`post failed: ${res.status()} ${(await res.text()).slice(0, 120)}`);
  return (await res.json()).id;
};

/** Nudge TanStack Query's focus-refetch so we don't wait the 25s poll interval. */
const nudgePoll = async (page) => {
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
};

console.log(`New-posts-pill e2e on ${BASE} — marker="${MARKER}"`);

const sessions = [];
try {
  await step("clear su:/si:/track:/post: rate_limits", clearRateLimits);

  const A = await newAuthedUser(userA);
  const B = await newAuthedUser(userB);
  sessions.push(A, B);

  await step("A opens the Latest community feed", async () => {
    await A.page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded" });
    // Wait for the feed to paint at least one post (or the empty state) so the
    // pill's `since` baseline is anchored to the current top.
    await A.page
      .locator("article, [data-testid='new-posts-pill']")
      .first()
      .waitFor({ timeout: 30000 })
      .catch(() => {});
    // Give the feed a beat so its top-post baseline is captured.
    await A.page.waitForTimeout(1500);
  });

  await step("B (second session) posts a fresh marker post", async () => {
    await apiPost(B, MARKER);
  });

  await step(
    "the count endpoint reports >= 1 newer post for A (signed-in, un-cached)",
    async () => {
      // Probe the endpoint directly first — fast, deterministic, independent of poll timing.
      // `since` = a moment just before B posted (A's baseline is at-or-before this).
      const since = new Date(TS - 60_000).toISOString();
      const res = await A.ctx.request.get(
        `${BASE}/api/community/posts/new-count?since=${encodeURIComponent(since)}`,
        { headers: { origin: BASE } }
      );
      if (res.status() !== 200) throw new Error(`new-count API ${res.status()}`);
      const data = await res.json();
      if (!(Number(data.count) >= 1))
        throw new Error(`expected count >= 1, got ${JSON.stringify(data)}`);
    }
  );

  await step("A's feed shows the floating 'N new posts' pill", async () => {
    const page = A.page;
    // Poll a few times, nudging focus-refetch each round, until the pill appears.
    const pill = page.getByTestId("new-posts-pill");
    let visible = false;
    for (let i = 0; i < 12 && !visible; i++) {
      await nudgePoll(page);
      visible = await pill
        .filter({ hasText: /new post/i })
        .first()
        .isVisible()
        .catch(() => false);
      if (!visible) await page.waitForTimeout(2500);
    }
    if (!visible) throw new Error("the 'N new posts' pill never appeared after B posted");
    const text = (await pill.textContent()) ?? "";
    if (!/new post/i.test(text)) throw new Error(`pill text unexpected: ${text}`);
  });

  await step("clicking the pill prepends B's post at the top + clears the pill", async () => {
    const page = A.page;
    await page.getByTestId("new-posts-pill").click();
    // B's marker post now appears in A's feed (it slides in at the head).
    await page.locator("article", { hasText: MARKER }).first().waitFor({ timeout: 20000 });
    // The pill clears: it animates out (opacity-0) and goes aria-hidden + out of
    // the tab order, so it is no longer an active "N new posts" control. Poll for
    // the count reaching 0 (aria-hidden="true").
    let cleared = false;
    for (let i = 0; i < 12 && !cleared; i++) {
      const hidden = await page
        .getByTestId("new-posts-pill")
        .getAttribute("aria-hidden")
        .catch(() => null);
      cleared = hidden === "true";
      if (!cleared) await page.waitForTimeout(1000);
    }
    if (!cleared) {
      const t =
        (await page
          .getByTestId("new-posts-pill")
          .textContent()
          .catch(() => "")) ?? "";
      throw new Error(`pill did not clear (still active): "${t.trim()}"`);
    }
  });

  await step("the pill is ABSENT on the Top scope (not a recency surface)", async () => {
    const page = A.page;
    await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Top this week" }).first().click();
    await page.waitForTimeout(2000);
    await nudgePoll(page);
    await page.waitForTimeout(1500);
    // The pill element should not render at all on Top.
    const count = await page.getByTestId("new-posts-pill").count();
    if (count > 0)
      throw new Error(`pill rendered on Top scope (count=${count}) — should be gated off`);
  });

  await step("mobile 360px: /community renders cleanly with the pill mechanics", async () => {
    const page = A.page;
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded" });
    await page
      .locator("article")
      .first()
      .waitFor({ timeout: 30000 })
      .catch(() => {});
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    if (overflow > 1) throw new Error(`/community overflows by ${overflow}px at 360px`);
  });
} finally {
  for (const s of sessions) await s.ctx.close().catch(() => {});
  await browser.close();
  // Full cleanup: delete every e2e user we created + their posts.
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
console.log("\nNew-posts-pill e2e passed (zero console errors).");
