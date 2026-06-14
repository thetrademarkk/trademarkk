/**
 * Watchlist-driven feed scope (rank-11) e2e:
 *   clear su:/si: rate_limits -> sign up + verify + sign in THREE distinct users
 *   (viewer A, followed author B, stranger C) via API ->
 *     B posts P_follow (no watched ticker), B posts P_both ($ZZTEST), C posts
 *     P_watch ($ZZTEST) ->
 *   A follows B (API) and watches $ZZTEST via the stream-page Watch button (UI ->
 *   POST 200, button flips to "Watching") ->
 *   the Watchlist feed (API scope=watchlist) contains P_watch (stranger, watched
 *   symbol) + P_follow (followed author) + P_both (matches both) EXACTLY ONCE,
 *   and never a control post that matches neither ->
 *   the left-rail "Your watchlist" lists $ZZTEST ->
 *   unwatch $ZZTEST (UI) -> P_watch leaves the Watchlist feed but P_follow/P_both
 *   stay (B still followed) ->
 *   360px renders cleanly -> zero console errors.
 *
 *   BASE_URL=http://localhost:3100 node scripts/e2e-watchlist.mjs
 *
 * Leaves its own users behind for the DB-level sweep (e2e-wl-*@example.com).
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
const SYMBOL = "ZZTEST"; // free-entry ticker — unique, never collides with real posts
const MARKER = `E2E watchlist ${TS}`;
const A = { email: `e2e-wl-a-${TS}@example.com`, name: "E2E WL Viewer" };
const B = { email: `e2e-wl-b-${TS}@example.com`, name: "E2E WL Author" };
const C = { email: `e2e-wl-c-${TS}@example.com`, name: "E2E WL Stranger" };
const PASSWORD = "e2e-Passw0rd-123";
const BODY_FOLLOW = `${MARKER} FOLLOW — by the followed author, no watched ticker.`;
const BODY_BOTH = `${MARKER} BOTH — by the followed author about $${SYMBOL}.`;
const BODY_WATCH = `${MARKER} WATCH — by a stranger about $${SYMBOL}.`;
const BODY_CONTROL = `${MARKER} CONTROL — by a stranger, no watched ticker.`;

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

const clearSignupRateLimits = async () => {
  const db = dbClient();
  if (!db) return;
  await db.execute(`DELETE FROM rate_limits WHERE key LIKE 'su:%' OR key LIKE 'si:%'`);
};

/** Returns an authenticated browser context for `user` (own cookie jar). */
const authContext = async (user) => {
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
      throw new Error(`sign-up failed for ${user.email}: ${res.status()}`);
    break;
  }
  const db = dbClient();
  if (db)
    await db.execute({
      sql: `UPDATE user SET email_verified = 1 WHERE email = ?`,
      args: [user.email],
    });
  const signin = await api.post(`${BASE}/api/auth/sign-in/email`, {
    data: { email: user.email, password: PASSWORD },
    headers: { origin: BASE },
  });
  if (signin.status() !== 200)
    throw new Error(`sign-in failed for ${user.email}: ${signin.status()}`);
  return ctx;
};

const createPost = async (ctx, body) => {
  const res = await ctx.request.post(`${BASE}/api/community/posts`, {
    data: { body },
    headers: { origin: BASE },
  });
  if (res.status() !== 201)
    throw new Error(`post create failed: ${res.status()} ${(await res.text()).slice(0, 120)}`);
  return (await res.json()).id;
};

const watchlistBodies = async (ctx) => {
  const res = await ctx.request.get(`${BASE}/api/community/posts?sort=latest&scope=watchlist`, {
    headers: { origin: BASE },
  });
  if (res.status() !== 200) throw new Error(`watchlist feed query failed: ${res.status()}`);
  const data = await res.json();
  return (data.posts ?? []).map((p) => p.body ?? "");
};

console.log(`Watchlist e2e on ${BASE}`);

await step("clear su:/si: rate_limits", clearSignupRateLimits);

let ctxA;
let bHandle;
await step("auth 3 distinct users; B+C post; resolve B's username", async () => {
  ctxA = await authContext(A);
  const ctxB = await authContext(B);
  const ctxC = await authContext(C);
  // followed author B's two posts; stranger C's watched + control posts.
  await createPost(ctxB, BODY_FOLLOW);
  await createPost(ctxB, BODY_BOTH);
  await createPost(ctxC, BODY_WATCH);
  await createPost(ctxC, BODY_CONTROL);
  // B's public username (for A to follow).
  const me = await ctxB.request.get(`${BASE}/api/community/profile`, { headers: { origin: BASE } });
  bHandle = (await me.json()).username;
  if (!bHandle) throw new Error("could not resolve author B's username");
  await ctxB.close();
  await ctxC.close();
});

await step("A follows author B (API)", async () => {
  const res = await ctxA.request.post(
    `${BASE}/api/community/users/${encodeURIComponent(bHandle)}/follow`,
    { headers: { origin: BASE } }
  );
  if (res.status() !== 200) throw new Error(`follow B failed: ${res.status()}`);
});

// Drive the UI as A from here on (own authenticated page).
const page = await ctxA.newPage();
page.on("dialog", (d) => d.accept());
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const text = m.text();
  if (text.includes("401")) return; // composer's first POST 401s by design
  issues.push(`[console] ${page.url()} :: ${text.slice(0, 220)}`);
});
page.on("pageerror", (e) => issues.push(`[pageerror] ${String(e.message).slice(0, 220)}`));

await step("watch $ZZTEST via the stream-page Watch button (UI -> POST 200)", async () => {
  await page.goto(`${BASE}/community/s/${SYMBOL}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await page
    .getByRole("button", { name: /^Watch$/ })
    .first()
    .waitFor({ timeout: 60000 });
  await Promise.all([
    page.waitForResponse(
      (r) =>
        new RegExp(`/api/community/watchlist/${SYMBOL}$`).test(r.url()) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20000 }
    ),
    page
      .getByRole("button", { name: /^Watch$/ })
      .first()
      .click(),
  ]);
  await page
    .getByRole("button", { name: /Watching/ })
    .first()
    .waitFor({ timeout: 10000 });
});

await step("Watchlist feed = watched-symbol post + followed-author posts (each once)", async () => {
  const bodies = await watchlistBodies(ctxA);
  const has = (b) => bodies.filter((x) => x.includes(b)).length;
  if (has(BODY_WATCH) !== 1)
    throw new Error(`stranger's watched post should appear once, saw ${has(BODY_WATCH)}`);
  if (has(BODY_FOLLOW) !== 1)
    throw new Error(`followed author's post should appear once, saw ${has(BODY_FOLLOW)}`);
  if (has(BODY_BOTH) !== 1)
    throw new Error(`post matching BOTH should appear exactly once, saw ${has(BODY_BOTH)}`);
  if (has(BODY_CONTROL) !== 0)
    throw new Error(`control post (matches neither) must NOT appear, saw ${has(BODY_CONTROL)}`);
});

await step("the left-rail 'Your watchlist' lists $ZZTEST", async () => {
  await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded" });
  await page.getByText("Your watchlist", { exact: false }).first().waitFor({ timeout: 20000 });
  await page.locator(`aside a[href="/community/s/${SYMBOL}"]`).first().waitFor({ timeout: 10000 });
});

await step("unwatch (UI) -> watched-only post leaves, followed posts stay", async () => {
  await page.goto(`${BASE}/community/s/${SYMBOL}`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: /Watching/ })
    .first()
    .waitFor({ timeout: 20000 });
  await Promise.all([
    page.waitForResponse(
      (r) =>
        new RegExp(`/api/community/watchlist/${SYMBOL}$`).test(r.url()) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20000 }
    ),
    page
      .getByRole("button", { name: /Watching/ })
      .first()
      .click(),
  ]);
  await page
    .getByRole("button", { name: /^Watch$/ })
    .first()
    .waitFor({ timeout: 10000 });
  const bodies = await watchlistBodies(ctxA);
  const has = (b) => bodies.filter((x) => x.includes(b)).length;
  if (has(BODY_WATCH) !== 0)
    throw new Error(
      `stranger's watched-only post should be gone after unwatch, saw ${has(BODY_WATCH)}`
    );
  if (has(BODY_FOLLOW) !== 1)
    throw new Error(`followed author's post should remain after unwatch, saw ${has(BODY_FOLLOW)}`);
  if (has(BODY_BOTH) !== 1)
    throw new Error(
      `followed author's $${SYMBOL} post should remain (still followed), saw ${has(BODY_BOTH)}`
    );
});

await step("mobile 360px: symbol stream has no horizontal overflow", async () => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`${BASE}/community/s/${SYMBOL}`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: /^Watch$/ })
    .first()
    .waitFor({ timeout: 20000 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  if (overflow > 1) throw new Error(`symbol stream overflows by ${overflow}px at 360px`);
});

await browser.close();
if (issues.length) {
  console.log(`\n${failed} step(s) failed; ${issues.length} issue(s):`);
  for (const i of issues) console.log("  " + i);
  process.exit(1);
}
console.log("\nWatchlist e2e passed (zero console errors).");
