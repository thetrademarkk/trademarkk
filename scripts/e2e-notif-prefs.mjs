/**
 * Notification preferences (rank-19) e2e:
 *   1. User A opens /community/notifications, clicks "Preferences", toggles the
 *      "New followers" type OFF. The toggle persists across a full reload.
 *   2. User B follows A → because A opted out of follow notifications, NO new
 *      follow notification is created for A (a reply still WOULD — proven by the
 *      file-backed server test; here we assert the follow is suppressed and a
 *      comment notification still flows).
 *   3. A toggles "New followers" back ON; B unfollows then re-follows → the
 *      follow notification now flows again.
 *   4. 360px renders cleanly (no horizontal overflow). Zero console errors.
 *
 *   BASE_URL=http://localhost:3100 node scripts/e2e-notif-prefs.mjs
 *
 * Cleans up ONLY its own synthetic users + their rows. NEVER touches
 * demo@trademark.app, raashish1601@gmail.com or mahajandeepakshi03@gmail.com.
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
const userA = { email: `e2e-np-a-${TS}@example.com`, name: `E2E NPA ${TS}` };
const userB = { email: `e2e-np-b-${TS}@example.com`, name: `E2E NPB ${TS}` };

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
    if (text.includes("401")) return; // some first POSTs 401 by design
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
  await clearRateLimits();
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await api.post(`${BASE}/api/auth/sign-up/email`, {
      data: { email: u.email, password: PASSWORD, name: u.name },
      headers: { origin: BASE },
    });
    if (res.status() === 429) {
      await clearRateLimits();
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
  return { ctx, page, api };
};

// A's follow-notification count, read from A's own session (server-authoritative).
const followNotifs = async (s) => {
  const res = await s.api.get(`${BASE}/api/community/notifications?limit=100`, {
    headers: { origin: BASE },
  });
  if (res.status() !== 200) throw new Error(`notifications API ${res.status()}`);
  const data = await res.json();
  return data.notifications.filter((n) => n.type === "follow").length;
};
const commentNotifs = async (s) => {
  const res = await s.api.get(`${BASE}/api/community/notifications?limit=100`, {
    headers: { origin: BASE },
  });
  const data = await res.json();
  return data.notifications.filter((n) => n.type === "comment").length;
};

console.log(`Notification-prefs e2e on ${BASE}`);

let A, B;
let aUsername, aPostId;
try {
  await step("seed two synthetic users", async () => {
    A = await newAuthedUser(userA);
    B = await newAuthedUser(userB);
  });

  await step("A has a community profile + a post (so B can also comment)", async () => {
    // ensureProfile is lazy — create A's profile + grab the handle.
    const prof = await A.api.get(`${BASE}/api/community/profile`, { headers: { origin: BASE } });
    if (prof.status() !== 200) throw new Error(`profile API ${prof.status()}`);
    aUsername = (await prof.json()).username;
    if (!aUsername) throw new Error("A has no username");
    const post = await A.api.post(`${BASE}/api/community/posts`, {
      data: { body: `notif-pref seed post ${TS}`, tags: [] },
      headers: { origin: BASE },
    });
    if (![200, 201].includes(post.status())) throw new Error(`A post failed: ${post.status()}`);
    aPostId = (await post.json()).id;
  });

  await step("A opens Notifications → Preferences and toggles 'New followers' OFF", async () => {
    const page = A.page;
    await page.goto(`${BASE}/community/notifications`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Notification preferences" }).first().click();
    const toggle = page.locator('[data-notif-pref="follow"]');
    await toggle.waitFor({ timeout: 20000 });
    if ((await toggle.getAttribute("data-enabled")) !== "true")
      throw new Error("follow toggle should start ON");
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/community/notification-prefs") &&
          r.request().method() === "PUT" &&
          r.status() === 200,
        { timeout: 20000 }
      ),
      toggle.click(),
    ]);
    // Optimistic + server-confirmed: the switch is now OFF.
    await page.waitForFunction(
      () =>
        document.querySelector('[data-notif-pref="follow"]')?.getAttribute("data-enabled") ===
        "false",
      { timeout: 10000 }
    );
  });

  await step("the OFF state persists across a full reload", async () => {
    const page = A.page;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Notification preferences" }).first().click();
    const toggle = page.locator('[data-notif-pref="follow"]');
    await toggle.waitFor({ timeout: 20000 });
    if ((await toggle.getAttribute("data-enabled")) !== "false")
      throw new Error("follow preference did not persist OFF across reload");
  });

  await step("B follows A → NO follow notification is created (A opted out)", async () => {
    const before = await followNotifs(A);
    const res = await B.api.post(
      `${BASE}/api/community/users/${encodeURIComponent(aUsername)}/follow`,
      { headers: { origin: BASE } }
    );
    if (res.status() !== 200) throw new Error(`follow failed: ${res.status()}`);
    if ((await res.json()).following !== true) throw new Error("expected following:true");
    const after = await followNotifs(A);
    if (after !== before)
      throw new Error(`follow notif leaked while opted out (${before}→${after})`);
  });

  await step("a DIFFERENT (still-enabled) type still flows: B comments on A's post", async () => {
    const before = await commentNotifs(A);
    const res = await B.api.post(`${BASE}/api/community/posts/${aPostId}/comments`, {
      data: { body: `still-enabled comment ${TS}` },
      headers: { origin: BASE },
    });
    if (![200, 201].includes(res.status())) throw new Error(`comment failed: ${res.status()}`);
    const after = await commentNotifs(A);
    if (after !== before + 1)
      throw new Error(`comment notif should still flow (${before}→${after})`);
  });

  await step("A toggles 'New followers' back ON", async () => {
    const page = A.page;
    await page.goto(`${BASE}/community/notifications`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Notification preferences" }).first().click();
    const toggle = page.locator('[data-notif-pref="follow"]');
    await toggle.waitFor({ timeout: 20000 });
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/community/notification-prefs") &&
          r.request().method() === "PUT" &&
          r.status() === 200,
        { timeout: 20000 }
      ),
      toggle.click(),
    ]);
    await page.waitForFunction(
      () =>
        document.querySelector('[data-notif-pref="follow"]')?.getAttribute("data-enabled") ===
        "true",
      { timeout: 10000 }
    );
  });

  await step("B re-follows A → the follow notification now flows again", async () => {
    // B is currently following A — toggle off then on to re-trigger the insert.
    const off = await B.api.post(
      `${BASE}/api/community/users/${encodeURIComponent(aUsername)}/follow`,
      { headers: { origin: BASE } }
    );
    if ((await off.json()).following !== false) throw new Error("expected unfollow");
    const before = await followNotifs(A);
    const on = await B.api.post(
      `${BASE}/api/community/users/${encodeURIComponent(aUsername)}/follow`,
      { headers: { origin: BASE } }
    );
    if ((await on.json()).following !== true) throw new Error("expected re-follow");
    const after = await followNotifs(A);
    if (after !== before + 1)
      throw new Error(`follow notif should flow when ON (${before}→${after})`);
  });

  await step("mobile 360px: the preferences panel has no horizontal overflow", async () => {
    const page = A.page;
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(`${BASE}/community/notifications`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Notification preferences" }).first().click();
    await page.locator('[data-notif-pref="follow"]').waitFor({ timeout: 20000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    if (overflow > 1) throw new Error(`notifications page overflows by ${overflow}px at 360px`);
  });
} finally {
  if (A) await A.ctx.close().catch(() => {});
  if (B) await B.ctx.close().catch(() => {});
  await browser.close();
  const db = dbClient();
  if (db) {
    for (const email of [userA.email, userB.email]) {
      const u = await db.execute({ sql: `SELECT id FROM user WHERE email = ?`, args: [email] });
      const uid = u.rows[0]?.id;
      if (!uid) continue;
      await db.execute({
        sql: `DELETE FROM follows WHERE follower_id = ? OR following_id = ?`,
        args: [uid, uid],
      });
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
    await db.execute(
      `DELETE FROM rate_limits WHERE key LIKE 'su:%' OR key LIKE 'si:%' OR key LIKE 'track:%' OR key LIKE 'post:%' OR key LIKE 'comment:%' OR key LIKE 'follow:%' OR key LIKE 'notif-prefs:%'`
    );
  }
}

if (issues.length) {
  console.log(`\n${failed} step(s) failed; ${issues.length} issue(s):`);
  for (const i of issues) console.log("  " + i);
  process.exit(1);
}
console.log("\nNotification-prefs e2e passed (zero console errors).");
