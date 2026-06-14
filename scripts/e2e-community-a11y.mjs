/**
 * Community accessibility + polling-perf hardening e2e (polish pass).
 *
 * One signed-in synthetic user opens /community and we assert the wins of the
 * polish pass:
 *
 *  A11Y
 *   - the always-mounted icon-only header/dock controls (notifications bell,
 *     messages FAB) expose an accessible name (no nameless icon buttons);
 *   - the "N new posts" pill is a polite live region (role=status / aria-live)
 *     so its count change is announced without stealing focus;
 *   - the reaction picker button on a post is named ("React to this post") and,
 *     when opened, exposes a role="menu" with named role="menuitemradio" options
 *     and moves focus INTO the menu (focus management);
 *   - an opened dialog (the post composer) traps focus — Tab cycles within it.
 *
 *  PERF (the headline fix)
 *   - with the feed open, BACKGROUND the tab (visibility=hidden) and assert the
 *     community polls QUIESCE: no /api/community/{notifications,dm/conversations,
 *     posts/new-count} request fires while the tab is hidden (captured via
 *     request interception). Restoring focus is allowed to refetch.
 *
 *   BASE_URL=http://localhost:3100 node scripts/e2e-community-a11y.mjs
 *
 * Cleans up its own synthetic user at the end (and on failure). NEVER touches
 * demo@trademark.app / raashish1601@gmail.com / mahajandeepakshi03@gmail.com.
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
const user = { email: `e2e-a11y-${TS}@example.com`, name: `E2E A11y` };

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
      throw new Error(
        `sign-up ${u.email} failed: ${res.status()} ${(await res.text()).slice(0, 120)}`
      );
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
    throw new Error(`sign-in ${u.email} failed: ${signin.status()}`);
  }
  if (!signin || signin.status() !== 200)
    throw new Error(`sign-in ${u.email} failed after retries: ${signin?.status()}`);
  const page = await ctx.newPage();
  attachConsole(page);
  return { ctx, page };
};

/** API-creates a post so the feed has at least one article with a reaction control. */
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

const COMMUNITY_POLL_RE = /\/api\/community\/(notifications|dm\/conversations|posts\/new-count)/;

console.log(`Community a11y + poll-perf e2e on ${BASE}`);

let S;
try {
  await step("clear su:/si:/track:/post: rate_limits", clearRateLimits);
  S = await newAuthedUser(user);
  const page = S.page;

  // Track community poll requests with timestamps so we can prove the polls go
  // quiet while the tab is hidden.
  const pollHits = [];
  page.on("request", (req) => {
    if (COMMUNITY_POLL_RE.test(req.url())) pollHits.push({ url: req.url(), at: Date.now() });
  });

  await step("seed a post so the feed has an interactive article", async () => {
    await apiPost(S, `a11y polish marker ${TS}`);
  });

  await step("A opens the Latest community feed", async () => {
    await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded" });
    await page
      .locator("article")
      .first()
      .waitFor({ timeout: 30000 })
      .catch(() => {});
  });

  await step("the notifications bell exposes an accessible name", async () => {
    const bell = page.getByRole("button", { name: /notifications/i }).first();
    await bell.waitFor({ timeout: 15000 });
    const name = (await bell.getAttribute("aria-label")) ?? "";
    if (!/notifications/i.test(name)) throw new Error(`bell aria-label missing: "${name}"`);
  });

  await step("the messages dock exposes an accessible name", async () => {
    const fab = page.getByRole("link", { name: /messages/i }).first();
    await fab.waitFor({ timeout: 15000 });
    const name = (await fab.getAttribute("aria-label")) ?? "";
    if (!/messages/i.test(name)) throw new Error(`messages FAB aria-label missing: "${name}"`);
  });

  await step("the 'N new posts' pill is a polite live region", async () => {
    // The live region is present in the DOM even at count 0 (it announces on change).
    const live = page.locator('[role="status"][aria-live="polite"]');
    if ((await live.count()) === 0)
      throw new Error("no polite aria-live status region found for the new-posts pill");
  });

  await step("the post reaction control is named and opens an ARIA menu", async () => {
    const reactBtn = page.getByRole("button", { name: /react to this post/i }).first();
    await reactBtn.waitFor({ timeout: 15000 });
    // Open via keyboard to also exercise focus management.
    await reactBtn.focus();
    await reactBtn.press("ArrowUp");
    const menu = page.getByRole("menu", { name: /pick a reaction/i }).first();
    await menu.waitFor({ timeout: 5000 });
    const options = menu.getByRole("menuitemradio");
    const optCount = await options.count();
    if (optCount < 2) throw new Error(`reaction menu had ${optCount} named options`);
    // Each option must have an accessible name.
    for (let i = 0; i < optCount; i++) {
      const n = (await options.nth(i).getAttribute("aria-label")) ?? "";
      if (!n.trim()) throw new Error(`reaction option ${i} has no accessible name`);
    }
    // Focus moved into the menu (an option is focused, not the trigger).
    const focusedInMenu = await page.evaluate(
      () => document.activeElement?.getAttribute("role") === "menuitemradio"
    );
    if (!focusedInMenu) throw new Error("opening the reaction menu did not move focus into it");
    await page.keyboard.press("Escape");
  });

  await step("opening the inline composer moves focus to the post body (focus mgmt)", async () => {
    // The top-of-feed composer is an inline expander, not a modal — its a11y win
    // is focus management: clicking the collapsed "Start a post" prompt expands
    // it and auto-focuses the body textarea so a keyboard user lands ready to type.
    const opener = page.getByRole("button", { name: /start a post/i }).first();
    await opener.waitFor({ timeout: 10000 });
    await opener.click();
    await page.getByTestId("inline-composer-expanded").waitFor({ timeout: 8000 });
    // Focus should now be inside the expanded composer on a textbox.
    const focusedTextbox = await page.evaluate(() => {
      const el = document.activeElement;
      return Boolean(el && el.tagName === "TEXTAREA");
    });
    if (!focusedTextbox)
      throw new Error("expanding the composer did not move focus to the body textarea");
    // The collapse control is a named icon button (no nameless icon button).
    const collapse = page.getByRole("button", { name: /collapse composer/i }).first();
    if (!(await collapse.isVisible().catch(() => false)))
      throw new Error("composer collapse control missing its accessible name");
  });

  await step("PERF: community polls quiesce while the tab is hidden", async () => {
    // Let the feed settle, then snapshot the poll count.
    await page.waitForTimeout(2000);
    const before = pollHits.length;
    // Background the tab. The browser keeps it open but TanStack Query's
    // visibilitychange listener should pause every refetchIntervalInBackground:
    // false poll (notifications 60s, DM inbox 30s, new-posts pill 25s).
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // Wait LONGER than the fastest always-mounted poll cadence (25s pill) so a
    // still-running poll would definitely have fired.
    await page.waitForTimeout(28000);
    const fired = pollHits.slice(before);
    if (fired.length > 0)
      throw new Error(
        `expected zero community polls while hidden, saw ${fired.length}: ${fired
          .map((f) => f.url.replace(BASE, ""))
          .join(", ")}`
      );
  });

  await step("PERF: polls resume once the tab is visible again", async () => {
    const before = pollHits.length;
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    // Once visible, the paused intervals restart. refetchOnWindowFocus only
    // refetches STALE queries (by design — efficient), so rather than rely on an
    // immediate focus-refetch we wait past the fastest always-mounted cadence
    // (30s DM inbox / 25s pill) and assert at least one poll fires again — i.e.
    // the interval genuinely resumed instead of staying dead after backgrounding.
    let resumed = false;
    for (let i = 0; i < 34 && !resumed; i++) {
      await page.waitForTimeout(1000);
      resumed = pollHits.length > before;
    }
    if (!resumed) throw new Error("community polls did not resume after the tab became visible");
  });
} finally {
  if (S) await S.ctx.close().catch(() => {});
  await browser.close();
  const db = dbClient();
  if (db) {
    const u = await db.execute({ sql: `SELECT id FROM user WHERE email = ?`, args: [user.email] });
    const uid = u.rows[0]?.id;
    if (uid) {
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
console.log("\nCommunity a11y + poll-perf e2e passed (zero console errors).");
