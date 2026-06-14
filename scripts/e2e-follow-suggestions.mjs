/**
 * "Who to follow" follow-suggestions (rank-17) e2e:
 *   clear su:/si: rate_limits -> sign up + verify + sign in FOUR distinct users
 *   (viewer A, mutual M, 2nd-degree candidate C, shared-tag author T) via API ->
 *     each makes ONE real API post first (creates the lazy profile row) ->
 *   build the follow graph: A->M (so M is already-followed), M->C (so C is A's
 *     2nd-degree), and A follows #options; T authors a post tagged #options ->
 *   A's /api/community/who-to-follow returns C ("Followed by 1 person you follow")
 *     and T ("Also posts about #options"), each carrying a reason; the already-
 *     followed M never appears ->
 *   A opens /community (desktop) -> the "Who to follow" right-rail card shows the
 *     suggestions with reason lines (+ a tier chip when standing > New) ->
 *   A clicks Follow on the C row -> POST /users/<C>/follow 200, the row resolves
 *     to "Following" then removes from the card, and the follow persists (a
 *     re-query no longer suggests C) ->
 *   360px renders cleanly (rail hidden, no horizontal overflow) ->
 *   zero console errors.
 *
 *   BASE_URL=http://localhost:3100 node scripts/e2e-follow-suggestions.mjs
 *
 * Leaves its own users behind for the DB-level sweep (e2e-wtf-*@example.com).
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
const TAG = "options"; // a curated, followable tag
const A = { email: `e2e-wtf-a-${TS}@example.com`, name: "E2E WTF Viewer" };
const M = { email: `e2e-wtf-m-${TS}@example.com`, name: "E2E WTF Mutual" };
const C = { email: `e2e-wtf-c-${TS}@example.com`, name: "E2E WTF Candidate" };
const T = { email: `e2e-wtf-t-${TS}@example.com`, name: "E2E WTF TagAuthor" };
const PASSWORD = "e2e-Passw0rd-123";

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
  // Sign-up is capped 3/hour/IP (a blocked sign-up returns a FAKE success, so the
  // user silently never persists and the later sign-in 401s) — clear the per-IP
  // su:/si: counters before each so creating four users in one run never blocks.
  await clearSignupRateLimits();
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
  // Sign-in is rate-limited too (Better Auth in-memory `si:` limiter ~few/min) —
  // back off + retry so creating four users back-to-back doesn't 429 the 4th.
  for (let attempt = 0; attempt < 6; attempt++) {
    const signin = await api.post(`${BASE}/api/auth/sign-in/email`, {
      data: { email: user.email, password: PASSWORD },
      headers: { origin: BASE },
    });
    if (signin.status() === 200) return ctx;
    if (signin.status() === 429) {
      await new Promise((r) => setTimeout(r, 12000));
      continue;
    }
    throw new Error(`sign-in failed for ${user.email}: ${signin.status()}`);
  }
  throw new Error(`sign-in kept 429ing for ${user.email}`);
};

/** A real API post — also lazily creates the author's profile row. */
const createPost = async (ctx, body, tags = []) => {
  const res = await ctx.request.post(`${BASE}/api/community/posts`, {
    data: { body, tags },
    headers: { origin: BASE },
  });
  if (res.status() !== 201)
    throw new Error(`post create failed: ${res.status()} ${(await res.text()).slice(0, 120)}`);
  return (await res.json()).id;
};

/** Resolves a user's community handle from the platform DB (by email). */
const handleFor = async (db, email) => {
  const r = await db.execute({
    sql: `SELECT p.username AS u FROM profiles p JOIN user us ON us.id = p.user_id WHERE us.email = ?`,
    args: [email],
  });
  const u = r.rows[0]?.u;
  if (!u) throw new Error(`no profile/username for ${email}`);
  return String(u);
};

const followUser = async (ctx, handle) => {
  const res = await ctx.request.post(`${BASE}/api/community/users/${handle}/follow`, {
    headers: { origin: BASE },
  });
  if (res.status() !== 200) throw new Error(`follow ${handle} failed: ${res.status()}`);
  return (await res.json()).following;
};

const followTag = async (ctx, tag) => {
  const res = await ctx.request.post(`${BASE}/api/community/tags/${tag}/follow`, {
    headers: { origin: BASE },
  });
  if (res.status() !== 200) throw new Error(`follow tag ${tag} failed: ${res.status()}`);
};

const whoToFollow = async (ctx) => {
  const res = await ctx.request.get(`${BASE}/api/community/who-to-follow`, {
    headers: { origin: BASE },
  });
  if (res.status() !== 200) throw new Error(`who-to-follow query failed: ${res.status()}`);
  return res.json();
};

console.log(`Who-to-follow e2e on ${BASE}`);

await step("clear su:/si: rate_limits", clearSignupRateLimits);

let ctxA;
let handleC;
let handleM;
let handleT;
await step("auth A/M/C/T; each posts once; build the follow graph", async () => {
  ctxA = await authContext(A);
  const ctxM = await authContext(M);
  const ctxC = await authContext(C);
  const ctxT = await authContext(T);

  // One real post each -> creates the lazy profile rows (needed for handles +
  // the candidate's "recent activity" signal). T's post carries the followed tag.
  await createPost(ctxA, `WTF ${TS} viewer note`);
  await createPost(ctxM, `WTF ${TS} mutual note`);
  await createPost(ctxC, `WTF ${TS} candidate note`);
  await createPost(ctxT, `WTF ${TS} tag note about discipline #${TAG}`, [TAG]);

  const db = dbClient();
  handleM = await handleFor(db, M.email);
  handleC = await handleFor(db, C.email);
  handleT = await handleFor(db, T.email);

  // A -> M (already-followed; must never be suggested back to A).
  await followUser(ctxA, handleM);
  // M -> C (so C becomes A's 2nd-degree connection).
  await followUser(ctxM, handleC);
  // A follows #options; T authored a post tagged #options (shared-tag candidate).
  await followTag(ctxA, TAG);

  await ctxM.close();
  await ctxC.close();
  await ctxT.close();
});

await step("A's who-to-follow returns C (2nd-degree) + T (shared-tag) with reasons", async () => {
  const data = await whoToFollow(ctxA);
  if (!data.show) throw new Error("expected suggestions to show for a connected viewer");
  const byHandle = new Map(data.suggestions.map((s) => [s.username, s]));
  const c = byHandle.get(handleC);
  const t = byHandle.get(handleT);
  if (!c) throw new Error(`2nd-degree candidate ${handleC} missing from suggestions`);
  if (!t) throw new Error(`shared-tag author ${handleT} missing from suggestions`);
  if (c.reason !== "Followed by 1 person you follow")
    throw new Error(`unexpected 2nd-degree reason: "${c.reason}"`);
  if (t.reason !== `Also posts about #${TAG}`)
    throw new Error(`unexpected shared-tag reason: "${t.reason}"`);
});

await step("the already-followed user M never appears in A's suggestions", async () => {
  const data = await whoToFollow(ctxA);
  if (data.suggestions.some((s) => s.username === handleM))
    throw new Error("an already-followed user must never be suggested");
});

// Drive the UI as A.
const page = await ctxA.newPage();
page.on("dialog", (d) => d.accept());
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const text = m.text();
  if (text.includes("401")) return; // composer's first POST 401s by design
  issues.push(`[console] ${page.url()} :: ${text.slice(0, 220)}`);
});
page.on("pageerror", (e) => issues.push(`[pageerror] ${String(e.message).slice(0, 220)}`));

await step("the 'Who to follow' card renders with reason lines (desktop rail)", async () => {
  await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded", timeout: 90000 });
  const card = page.locator("[data-who-to-follow]").first();
  await card.waitFor({ timeout: 30000 });
  await card.getByText("Who to follow", { exact: true }).first().waitFor({ timeout: 10000 });
  // The 2nd-degree candidate row shows its honest reason.
  await card
    .locator(`[data-suggestion-user="${handleC}"]`)
    .getByText("Followed by 1 person you follow")
    .waitFor({ timeout: 10000 });
  // The shared-tag candidate row shows its honest reason.
  await card
    .locator(`[data-suggestion-user="${handleT}"]`)
    .getByText(`Also posts about #${TAG}`)
    .waitFor({ timeout: 10000 });
});

await step("clicking Follow on C persists (POST 200) and removes the row", async () => {
  const row = page.locator(`[data-who-to-follow] [data-suggestion-user="${handleC}"]`);
  const followBtn = row.getByRole("button", { name: new RegExp(`Follow ${C.name}`) });
  await followBtn.waitFor({ timeout: 10000 });
  await Promise.all([
    page.waitForResponse(
      (r) =>
        new RegExp(`/api/community/users/${handleC}/follow$`).test(r.url()) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20000 }
    ),
    followBtn.click(),
  ]);
  // The row resolves then removes from the card.
  await row.waitFor({ state: "detached", timeout: 10000 });
});

await step("the follow persisted — a re-query no longer suggests C", async () => {
  const data = await whoToFollow(ctxA);
  if (data.suggestions.some((s) => s.username === handleC))
    throw new Error("a just-followed user must drop out of subsequent suggestions");
});

await step("mobile 360px: the page renders without horizontal overflow", async () => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Latest", exact: true })
    .first()
    .waitFor({ timeout: 30000 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  if (overflow > 1) throw new Error(`/community overflows by ${overflow}px at 360px`);
  // The who-to-follow rail is in the lg-only right column (hidden on phones).
  const visible = await page
    .locator("[data-who-to-follow]")
    .first()
    .isVisible()
    .catch(() => false);
  if (visible) throw new Error("the desktop-only rail should be hidden at 360px");
  await page.setViewportSize({ width: 1380, height: 900 });
});

await browser.close();
if (issues.length) {
  console.log(`\n${failed} step(s) failed; ${issues.length} issue(s):`);
  for (const i of issues) console.log("  " + i);
  process.exit(1);
}
console.log("\nWho-to-follow e2e passed (zero console errors).");
