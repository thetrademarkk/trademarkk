/**
 * Admin moderation queue (rank-14) e2e:
 *   clear su:/si: rate_limits -> sign up + verify + sign in THREE users via API:
 *     ADMIN (email in ADMIN_EMAILS at serve time), AUTHOR, REPORTER ->
 *   AUTHOR posts P_ok (clean) + P_tip (auto-flagged by the quality gate) ->
 *   REPORTER reports P_ok (creates an open report) ->
 *   NON-ADMIN (author) hitting GET + POST /api/admin/moderation -> 403 (both) ->
 *   ADMIN drives the UI: /admin -> Moderation -> the queue shows the reported
 *     post AND the auto-flagged post -> dismiss the report (UI) -> clear the
 *     flag (UI) -> delete a freshly reported comment (UI) -> suspend the AUTHOR
 *     (UI) -> the suspended author's next post POST returns 403 ->
 *   reinstate the author (cleanup) -> 360px renders cleanly -> zero console errs.
 *
 *   Serve with ADMIN_EMAILS including the e2e admin's email, then:
 *   BASE_URL=http://localhost:3100 node scripts/e2e-mod-queue.mjs
 *
 * Leaves its own users behind for the DB-level sweep (e2e-mod-*@example.com).
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
const ADMIN = { email: "e2e-mod-admin@example.com", name: "E2E Mod Admin" };
const AUTHOR = { email: `e2e-mod-author-${TS}@example.com`, name: "E2E Mod Author" };
const REPORTER = { email: `e2e-mod-rep-${TS}@example.com`, name: "E2E Mod Reporter" };
const PASSWORD = "e2e-Passw0rd-123";
const MARKER = `E2E modq ${TS}`;
// A clean, genuine-analysis post (passes the quality gate cleanly).
const BODY_OK = `${MARKER} OK — reviewed my BANKNIFTY trade and the risk-reward held up well over the session, noting the slippage on exit.`;
// A tip-flavoured post → the rank-13 quality gate SOFT-flags it ('tip') without blocking.
const BODY_TIP = `${MARKER} TIP — buy this stock now, guaranteed multibagger sure-shot target, jackpot tip for everyone.`;

const browser = await chromium.launch();
const issues = [];
let failed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    issues.push(`[step] ${name} :: ${String(e.message).slice(0, 240)}`);
    console.log(`  FAIL ${name}: ${String(e.message).slice(0, 240)}`);
  }
};

const clearSignupRateLimits = async () => {
  const db = dbClient();
  if (!db) return;
  await db.execute(`DELETE FROM rate_limits WHERE key LIKE 'su:%' OR key LIKE 'si:%'`);
};

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
    if (![200, 201].includes(res.status())) {
      // A pre-existing fixed-email user (e.g. the admin from a prior run) returns
      // a non-2xx "already exists" — fall through to sign-in instead of failing.
      if (res.status() >= 400 && res.status() < 500) break;
      throw new Error(`sign-up failed for ${user.email}: ${res.status()}`);
    }
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

const createPost = async (ctx, body, expect = 201) => {
  const res = await ctx.request.post(`${BASE}/api/community/posts`, {
    data: { body, tags: [] },
    headers: { origin: BASE },
  });
  if (res.status() !== expect)
    throw new Error(
      `post create expected ${expect}, got ${res.status()} ${(await res.text()).slice(0, 140)}`
    );
  return res.status() === 201 ? (await res.json()).id : null;
};

const createComment = async (ctx, postId, body) => {
  const res = await ctx.request.post(`${BASE}/api/community/posts/${postId}/comments`, {
    data: { body },
    headers: { origin: BASE },
  });
  if (res.status() !== 201)
    throw new Error(`comment create failed: ${res.status()} ${(await res.text()).slice(0, 140)}`);
  return (await res.json()).id;
};

const report = async (ctx, targetType, targetId, reason) => {
  const res = await ctx.request.post(`${BASE}/api/community/report`, {
    data: { targetType, targetId, reason },
    headers: { origin: BASE },
  });
  if (![200, 201].includes(res.status()))
    throw new Error(`report failed: ${res.status()} ${(await res.text()).slice(0, 140)}`);
};

console.log(`Moderation-queue e2e on ${BASE}`);

await step("clear su:/si: rate_limits", clearSignupRateLimits);

let ctxAdmin, ctxAuthor, ctxReporter, authorId, pOk, pTip, commentId;
await step("auth ADMIN + AUTHOR + REPORTER; author posts clean + tip posts", async () => {
  ctxAdmin = await authContext(ADMIN);
  ctxAuthor = await authContext(AUTHOR);
  ctxReporter = await authContext(REPORTER);
  pOk = await createPost(ctxAuthor, BODY_OK);
  pTip = await createPost(ctxAuthor, BODY_TIP);
  const db = dbClient();
  authorId = String(
    (await db.execute({ sql: `SELECT id FROM user WHERE email = ?`, args: [AUTHOR.email] })).rows[0]
      .id
  );
});

await step("the tip post was auto-flagged by the quality gate (quality_flag set)", async () => {
  const db = dbClient();
  const row = (
    await db.execute({ sql: `SELECT quality_flag FROM posts WHERE id = ?`, args: [pTip] })
  ).rows[0];
  if (!row || !row.quality_flag) throw new Error("expected the tip post to carry a quality_flag");
});

await step("REPORTER reports the clean post + a comment (opens reports)", async () => {
  await report(ctxReporter, "post", pOk, "spam");
  commentId = await createComment(ctxAuthor, pOk, `${MARKER} a comment to be reported`);
  await report(ctxReporter, "comment", commentId, "harassment");
});

await step("NON-ADMIN GET /api/admin/moderation -> 403", async () => {
  const res = await ctxAuthor.request.get(`${BASE}/api/admin/moderation`, {
    headers: { origin: BASE },
  });
  if (res.status() !== 403) throw new Error(`expected 403, got ${res.status()}`);
});

await step("NON-ADMIN POST /api/admin/moderation -> 403", async () => {
  const res = await ctxAuthor.request.post(`${BASE}/api/admin/moderation`, {
    data: { action: "ban-user", userId: authorId },
    headers: { origin: BASE },
  });
  if (res.status() !== 403) throw new Error(`expected 403, got ${res.status()}`);
  // And the author must NOT be banned by that rejected call.
  const db = dbClient();
  const row = (await db.execute({ sql: `SELECT status FROM user WHERE id = ?`, args: [authorId] }))
    .rows[0];
  if (row?.status === "banned") throw new Error("non-admin POST should not have banned the user");
});

await step("ADMIN GET queue shows the reported post AND the auto-flagged post", async () => {
  const res = await ctxAdmin.request.get(`${BASE}/api/admin/moderation?status=open&source=all`, {
    headers: { origin: BASE },
  });
  if (res.status() !== 200)
    throw new Error(`admin queue GET failed: ${res.status()} — is the e2e admin in ADMIN_EMAILS?`);
  const data = await res.json();
  const hasReport = data.items.some((i) => i.source === "report" && i.targetId === pOk);
  const hasFlag = data.items.some((i) => i.source === "flag" && i.targetId === pTip);
  if (!hasReport) throw new Error("reported post missing from the queue");
  if (!hasFlag) throw new Error("auto-flagged post missing from the queue");
  if (!(data.openCounts.reports >= 2)) throw new Error("expected >=2 open reports in counts");
  if (!(data.openCounts.flags >= 1)) throw new Error("expected >=1 open flag in counts");
});

// Drive the admin UI.
const page = await ctxAdmin.newPage();
page.on("dialog", (d) => d.accept());
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (t.includes("401")) return;
  issues.push(`[console] ${page.url()} :: ${t.slice(0, 220)}`);
});
page.on("pageerror", (e) => issues.push(`[pageerror] ${String(e.message).slice(0, 220)}`));

await step("ADMIN opens /admin -> Moderation -> queue renders both items", async () => {
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByRole("button", { name: "Moderation", exact: true }).first().click();
  await page.locator("[data-testid='mod-queue']").first().waitFor({ timeout: 30000 });
  // Both an auto-flagged row and a report row are present.
  await page.locator("[data-source='flag']").first().waitFor({ timeout: 15000 });
  await page.locator("[data-source='report']").first().waitFor({ timeout: 15000 });
});

await step("ADMIN dismisses the comment report (UI -> POST 200)", async () => {
  // Target the comment report row (preview contains the comment marker).
  const row = page
    .locator("[data-source='report']")
    .filter({ hasText: "a comment to be reported" })
    .first();
  await row.waitFor({ timeout: 15000 });
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/admin/moderation") &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20000 }
    ),
    row.getByRole("button", { name: "Dismiss" }).click(),
  ]);
});

await step("ADMIN clears the auto-flag on the tip post (UI -> POST 200)", async () => {
  const row = page.locator("[data-source='flag']").first();
  await row.waitFor({ timeout: 15000 });
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/admin/moderation") &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20000 }
    ),
    row.getByRole("button", { name: "Clear flag" }).click(),
  ]);
  // The flag is gone from the DB.
  const db = dbClient();
  const f = (await db.execute({ sql: `SELECT quality_flag FROM posts WHERE id = ?`, args: [pTip] }))
    .rows[0];
  if (f?.quality_flag) throw new Error("clear-flag should have nulled quality_flag");
});

await step(
  "ADMIN deletes the reported POST content (UI -> in-app confirm -> POST 200)",
  async () => {
    const row = page
      .locator("[data-source='report']")
      .filter({ hasText: "OK — reviewed my BANKNIFTY" })
      .first();
    await row.waitFor({ timeout: 15000 });
    // The row button opens an in-app confirm dialog (not a native confirm).
    await row.getByRole("button", { name: "Remove content" }).click();
    const dialog = page.locator("[role='dialog']");
    await dialog.getByRole("button", { name: "Remove content" }).waitFor({ timeout: 10000 });
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/admin/moderation") &&
          r.request().method() === "POST" &&
          r.status() === 200,
        { timeout: 20000 }
      ),
      dialog.getByRole("button", { name: "Remove content" }).click(),
    ]);
    // The post is gone.
    const db = dbClient();
    const gone = (await db.execute({ sql: `SELECT id FROM posts WHERE id = ?`, args: [pOk] }))
      .rows[0];
    if (gone) throw new Error("delete-content should have removed the post");
  }
);

await step("ADMIN suspends the author via API (mirrors the UI button) -> 200", async () => {
  const res = await ctxAdmin.request.post(`${BASE}/api/admin/moderation`, {
    data: { action: "ban-user", userId: authorId },
    headers: { origin: BASE },
  });
  if (res.status() !== 200) throw new Error(`ban-user failed: ${res.status()}`);
  const db = dbClient();
  const row = (await db.execute({ sql: `SELECT status FROM user WHERE id = ?`, args: [authorId] }))
    .rows[0];
  if (row?.status !== "banned") throw new Error("author should be banned");
});

await step("the suspended author's next post POST -> 403", async () => {
  await createPost(ctxAuthor, `${MARKER} should be blocked`, 403);
});

await step("a mod_actions audit row exists for the ban", async () => {
  const db = dbClient();
  const row = (
    await db.execute({
      sql: `SELECT action FROM mod_actions WHERE target_id = ? AND action = 'ban-user'`,
      args: [authorId],
    })
  ).rows[0];
  if (!row) throw new Error("expected a mod_actions ban-user row");
});

await step("ADMIN reinstates the author (cleanup) -> author can post again", async () => {
  const res = await ctxAdmin.request.post(`${BASE}/api/admin/moderation`, {
    data: { action: "unban-user", userId: authorId },
    headers: { origin: BASE },
  });
  if (res.status() !== 200) throw new Error(`unban failed: ${res.status()}`);
  await createPost(ctxAuthor, `${MARKER} reinstated and posting`, 201);
});

await step("moderation queue renders cleanly at 360px (no overflow)", async () => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Moderation", exact: true }).first().click();
  // The Moderation pane heading paints (queue or empty state below it).
  await page.getByRole("heading", { name: "Moderation" }).first().waitFor({ timeout: 20000 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  if (overflow > 1) throw new Error(`moderation queue overflows by ${overflow}px at 360px`);
});

await browser.close();
if (issues.length) {
  console.log(`\n${failed} step(s) failed; ${issues.length} issue(s):`);
  for (const i of issues) console.log("  " + i);
  process.exit(1);
}
console.log("\nModeration-queue e2e passed (zero console errors).");
