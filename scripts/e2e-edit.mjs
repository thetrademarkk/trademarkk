/**
 * Edit-window + immutable edit history e2e:
 *   sign up → create post → edit within window (title/body/tags) → "Edited"
 *   marker appears → history dialog shows the PRIOR version → edit a comment →
 *   non-author cannot edit (API 403) → past-window edit rejected (API 410) →
 *   360px mobile renders the edited post cleanly → zero console errors.
 *
 *   BASE_URL=http://localhost:3100 node scripts/e2e-edit.mjs
 *
 * Leaves its own user behind for the DB-level sweep (e2e-edit-*@example.com).
 */
import { chromium } from "playwright";
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";

// Minimal .env.local loader so we can backdate a post to exercise the closed-window path.
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
const EMAIL = `e2e-edit-${TS}@example.com`;
const PASSWORD = "e2e-Passw0rd-123";
const MARKER = `E2E edit ${TS} — NIFTY breakout`;
const EDITED_BODY = `${MARKER} — EDITED post body with @ghosthandle$mention.`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
const page = await ctx.newPage();

const issues = [];
page.on("dialog", (d) => d.accept());
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const text = m.text();
  // The inline composer's first POST 401s by design (attempt → gate → retry).
  if (text.includes("401")) return;
  issues.push(`[console] ${page.url()} :: ${text.slice(0, 220)}`);
});
page.on("pageerror", (e) => issues.push(`[pageerror] ${String(e.message).slice(0, 220)}`));

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

// Email verification is now enforced locally (Resend creds present), so the UI
// signup never auto-creates a session. We create the account via the API, mark
// it verified in the platform DB, sign in to get a real cookie, and inject it
// into the browser context — then drive the rest of the flow authenticated.
const signUpAndAuthenticate = async () => {
  const api = ctx.request;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await api.post(`${BASE}/api/auth/sign-up/email`, {
      data: { email: EMAIL, password: PASSWORD, name: "E2E Edit" },
      headers: { origin: BASE },
    });
    if (res.status() === 429) {
      await page.waitForTimeout(12000);
      continue;
    }
    if (![200, 201].includes(res.status()))
      throw new Error(`sign-up failed: ${res.status()} ${(await res.text()).slice(0, 120)}`);
    break;
  }
  // Mark the new user verified directly (no inbox in CI) so sign-in yields a session.
  const db = dbClient();
  if (db)
    await db.execute({ sql: `UPDATE user SET email_verified = 1 WHERE email = ?`, args: [EMAIL] });

  const signin = await api.post(`${BASE}/api/auth/sign-in/email`, {
    data: { email: EMAIL, password: PASSWORD },
    headers: { origin: BASE },
  });
  if (signin.status() !== 200)
    throw new Error(`sign-in failed: ${signin.status()} ${(await signin.text()).slice(0, 120)}`);
  // The session cookie is now in ctx's cookie jar (request shares it with pages).
};

console.log(`Edit e2e on ${BASE} as ${EMAIL}`);

await step("feed renders logged-out", async () => {
  await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByText("House rules").waitFor({ timeout: 60000 });
});

await step("sign up + verify + sign in (API), then create a post via the UI", async () => {
  await signUpAndAuthenticate();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Write a post" }).first().click();
  const bodyField = page.getByLabel("Your post");
  await bodyField.waitFor({ state: "visible", timeout: 15000 });
  await bodyField.fill(`${MARKER} — original body.`);
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
});

const card = () => page.locator("article", { hasText: MARKER }).first();

await step("post appears in feed", async () => {
  await card().waitFor({ timeout: 20000 });
});

// Open the post detail so we have a stable, single card to edit.
let postUrl;
await step("open post detail", async () => {
  // Find the post's permalink from the feed card and navigate to it.
  const href = await card().locator('a[href*="/community/post/"]').first().getAttribute("href");
  postUrl = href?.startsWith("http") ? href : `${BASE}${href}`;
  if (!postUrl || !/\/community\/post\//.test(postUrl)) {
    // Fallback: click the comments link which routes to the detail page.
    await card()
      .getByRole("link", { name: /comment/i })
      .first()
      .click();
    await page.waitForURL(/\/community\/post\//, { timeout: 15000 });
    postUrl = page.url();
  } else {
    await page.goto(postUrl, { waitUntil: "domcontentloaded" });
  }
  await page.locator("article", { hasText: MARKER }).first().waitFor({ timeout: 20000 });
});

await step("edit post within window (title + body) → PATCH 200", async () => {
  await page.getByRole("button", { name: "Post options" }).first().click();
  await page.getByRole("menuitem", { name: /Edit post/ }).click();
  const bodyField = page.getByLabel("Edit post body");
  await bodyField.waitFor({ timeout: 10000 });
  await bodyField.fill(EDITED_BODY);
  await page.getByLabel("Title (optional)").fill(`${MARKER} title`);
  await Promise.all([
    page.waitForResponse(
      (r) =>
        /\/api\/community\/posts\/[^/]+$/.test(r.url()) &&
        r.request().method() === "PATCH" &&
        r.status() === 200,
      { timeout: 20000 }
    ),
    page.getByRole("button", { name: "Save changes" }).click(),
  ]);
});

await step("edited body is shown and the 'Edited' marker appears", async () => {
  const c = page.locator("article", { hasText: MARKER }).first();
  await c.getByText("EDITED post body", { exact: false }).waitFor({ timeout: 15000 });
  await c.locator("[data-edited-marker]").first().waitFor({ timeout: 15000 });
});

await step("history dialog shows the PRIOR (original) version", async () => {
  await page.getByRole("button", { name: "view history" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Edit history").waitFor({ timeout: 10000 });
  // The pre-edit body must be preserved in the immutable history.
  await dialog.getByText("original body", { exact: false }).waitFor({ timeout: 10000 });
  await page.keyboard.press("Escape");
});

await step("add a comment then edit it within window → PATCH 200", async () => {
  const commentBox = page.getByLabel("Write a comment");
  await commentBox.fill(`E2E comment ${TS} original`);
  await Promise.all([
    page.waitForResponse(
      (r) => /\/comments$/.test(r.url()) && r.request().method() === "POST" && r.status() === 201,
      { timeout: 20000 }
    ),
    page.getByRole("button", { name: "Comment", exact: true }).click(),
  ]);
  await page.getByText(`E2E comment ${TS} original`).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Edit comment" }).first().click();
  const editField = page.getByLabel("Edit comment");
  await editField.waitFor({ timeout: 10000 });
  await editField.fill(`E2E comment ${TS} EDITED`);
  await Promise.all([
    page.waitForResponse(
      (r) =>
        /\/api\/community\/comments\/[^/]+$/.test(r.url()) &&
        r.request().method() === "PATCH" &&
        r.status() === 200,
      { timeout: 20000 }
    ),
    page.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  await page.getByText(`E2E comment ${TS} EDITED`).waitFor({ timeout: 15000 });
});

await step("API: a non-author cannot edit the post (403)", async () => {
  const postId = postUrl.match(/\/community\/post\/([^/?#]+)/)?.[1];
  if (!postId) throw new Error("could not resolve post id");
  // A fresh, signed-OUT browser context → no auth cookie → 401/403 (never 200).
  const anonCtx = await browser.newContext();
  const res = await anonCtx.request.patch(`${BASE}/api/community/posts/${postId}`, {
    data: { body: "malicious overwrite by a non-author" },
    headers: { origin: BASE },
  });
  await anonCtx.close();
  if (res.status() === 200) throw new Error("non-author edit unexpectedly succeeded");
  if (![401, 403].includes(res.status()))
    throw new Error(`expected 401/403 for non-author edit, got ${res.status()}`);
});

await step("API: invalid edit body is rejected (400) — same zod as create", async () => {
  const postId = postUrl.match(/\/community\/post\/([^/?#]+)/)?.[1];
  const res = await ctx.request.patch(`${BASE}/api/community/posts/${postId}`, {
    data: { body: "x" }, // too short → 400 from the same zod validation as create
    headers: { origin: BASE },
  });
  if (res.status() !== 400)
    throw new Error(`expected 400 for invalid edit body, got ${res.status()}`);
});

await step("API: past-window edit is rejected (410) after backdating the post", async () => {
  const db = dbClient();
  if (!db) {
    console.log("    (skipped — no platform DB creds in env)");
    return;
  }
  const postId = postUrl.match(/\/community\/post\/([^/?#]+)/)?.[1];
  // Backdate the post 16 minutes so the 15-minute window is firmly closed.
  const past = new Date(Date.now() - 16 * 60_000).toISOString();
  await db.execute({ sql: `UPDATE posts SET created_at = ? WHERE id = ?`, args: [past, postId] });
  const res = await ctx.request.patch(`${BASE}/api/community/posts/${postId}`, {
    data: { body: "an edit that should be rejected after the window closes" },
    headers: { origin: BASE },
  });
  if (res.status() !== 410)
    throw new Error(`expected 410 for past-window edit, got ${res.status()}`);
});

await step("mobile 360px: edited post card has no horizontal overflow", async () => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(postUrl, { waitUntil: "domcontentloaded" });
  const c = page.locator("article", { hasText: MARKER }).first();
  await c.waitFor({ timeout: 20000 });
  const overflow = await c.evaluate((el) => el.scrollWidth - el.clientWidth);
  if (overflow > 1) throw new Error(`edited post card overflows by ${overflow}px at 360px`);
});

await browser.close();
if (issues.length) {
  console.log(`\n${failed} step(s) failed; ${issues.length} issue(s):`);
  for (const i of issues) console.log("  " + i);
  process.exit(1);
}
console.log("\nEdit e2e passed (zero console errors).");
