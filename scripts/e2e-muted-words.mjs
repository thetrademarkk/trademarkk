/**
 * Muted words (personal content filter) e2e:
 *   1. Two synthetic users A (the muter) and B. B authors a post containing a
 *      unique marker word ("scammyword<TS>") and a normal post.
 *   2. A sees BOTH of B's posts in the feed (baseline).
 *   3. A opens /community/notifications → Preferences → Muted words, mutes the
 *      marker word (substring). A's feed no longer shows the marker post; the
 *      normal post stays. The mute persists across a full reload.
 *   4. B (no mutes) still sees BOTH posts — muting is PERSONAL.
 *   5. A removes the mute → the marker post reappears in A's feed.
 *   6. Whole-word vs substring: A mutes "ass" as a WHOLE WORD; a post saying
 *      "asset" stays visible, a post saying "what an ass" is hidden.
 *   7. 360px renders cleanly (no horizontal overflow). Zero console errors.
 *
 *   BASE_URL=http://localhost:3100 node scripts/e2e-muted-words.mjs
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
const MARKER = `scammyword${TS}`;
const userA = { email: `e2e-mw-a-${TS}@example.com`, name: `E2E MWA ${TS}` };
const userB = { email: `e2e-mw-b-${TS}@example.com`, name: `E2E MWB ${TS}` };

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

const post = async (s, body) => {
  const res = await s.api.post(`${BASE}/api/community/posts`, {
    data: { body, tags: [] },
    headers: { origin: BASE },
  });
  if (![200, 201].includes(res.status())) throw new Error(`post failed: ${res.status()}`);
  return (await res.json()).id;
};

// Does the given session's latest feed contain the post id?
const feedHas = async (s, id, scope = "all") => {
  const res = await s.api.get(`${BASE}/api/community/posts?sort=latest&scope=${scope}`, {
    headers: { origin: BASE },
  });
  if (res.status() !== 200) throw new Error(`feed API ${res.status()}`);
  const data = await res.json();
  return data.posts.some((p) => p.id === id);
};

// Open the Muted words panel on the notifications page.
const openMutedPanel = async (page) => {
  await page.goto(`${BASE}/community/notifications`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Notification preferences" }).first().click();
  await page.getByRole("region", { name: "Muted words" }).waitFor({ timeout: 20000 });
};

const addMute = async (page, term, mode = "Contains") => {
  await page.getByLabel("Word to mute").fill(term);
  if (mode !== "Contains") {
    await page.getByLabel("Match mode").click();
    await page.getByRole("option", { name: mode }).click();
  }
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/community/muted-words") &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20000 }
    ),
    page.getByRole("button", { name: "Mute", exact: true }).click(),
  ]);
};

console.log(`Muted-words e2e on ${BASE}`);

let A, B;
let markerPostId, normalPostId, assetPostId, assPostId;
try {
  await step("seed two synthetic users", async () => {
    A = await newAuthedUser(userA);
    B = await newAuthedUser(userB);
  });

  await step("B authors a marker post + a normal post", async () => {
    markerPostId = await post(B, `here is a ${MARKER} that A will mute`);
    normalPostId = await post(B, `a perfectly normal post ${TS} kept visible`);
  });

  await step("baseline: A sees BOTH of B's posts", async () => {
    if (!(await feedHas(A, markerPostId)))
      throw new Error("A should see the marker post initially");
    if (!(await feedHas(A, normalPostId)))
      throw new Error("A should see the normal post initially");
  });

  await step("A mutes the marker word (substring) via the settings panel", async () => {
    await openMutedPanel(A.page);
    await addMute(A.page, MARKER);
    // The entry shows in the list.
    await A.page
      .getByRole("list", { name: "Your muted words" })
      .getByText(`"${MARKER}"`)
      .waitFor({ timeout: 10000 });
  });

  await step("A's feed now HIDES the marker post; the normal post stays", async () => {
    if (await feedHas(A, markerPostId)) throw new Error("marker post should be hidden from A");
    if (!(await feedHas(A, normalPostId))) throw new Error("normal post must stay visible to A");
  });

  await step("the mute persists across a full reload", async () => {
    await A.page.reload({ waitUntil: "domcontentloaded" });
    await A.page.getByRole("button", { name: "Notification preferences" }).first().click();
    await A.page
      .getByRole("list", { name: "Your muted words" })
      .getByText(`"${MARKER}"`)
      .waitFor({ timeout: 20000 });
    if (await feedHas(A, markerPostId)) throw new Error("marker post should still be hidden");
  });

  await step("B (no mutes) STILL sees both posts — muting is personal", async () => {
    if (!(await feedHas(B, markerPostId))) throw new Error("B must still see the marker post");
    if (!(await feedHas(B, normalPostId))) throw new Error("B must still see the normal post");
  });

  await step("A removes the mute → the marker post reappears", async () => {
    const page = A.page;
    await openMutedPanel(page);
    const removeBtn = page.getByRole("button", { name: `Remove muted word "${MARKER}"` });
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/community/muted-words") &&
          r.request().method() === "DELETE" &&
          r.status() === 200,
        { timeout: 20000 }
      ),
      removeBtn.click(),
    ]);
    if (!(await feedHas(A, markerPostId)))
      throw new Error("marker post should reappear after unmute");
  });

  await step("whole-word vs substring: 'ass' (word) hides 'ass' but not 'asset'", async () => {
    assetPostId = await post(B, `i bought a great asset ${TS}`);
    assPostId = await post(B, `what an ass move ${TS}`);
    await openMutedPanel(A.page);
    await addMute(A.page, "ass", "Whole word");
    if (await feedHas(A, assPostId)) throw new Error("whole-word 'ass' post should be hidden");
    if (!(await feedHas(A, assetPostId)))
      throw new Error("'asset' must NOT be hidden by whole-word 'ass'");
  });

  await step("mobile 360px: the muted-words panel has no horizontal overflow", async () => {
    const page = A.page;
    await page.setViewportSize({ width: 360, height: 800 });
    await openMutedPanel(page);
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
      `DELETE FROM rate_limits WHERE key LIKE 'su:%' OR key LIKE 'si:%' OR key LIKE 'track:%' OR key LIKE 'post:%' OR key LIKE 'muted-words:%'`
    );
  }
}

if (issues.length) {
  console.log(`\n${failed} step(s) failed; ${issues.length} issue(s):`);
  for (const i of issues) console.log("  " + i);
  process.exit(1);
}
console.log("\nMuted-words e2e passed (zero console errors).");
