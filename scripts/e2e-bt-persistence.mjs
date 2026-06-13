/**
 * Feature e2e (BT-09): backtest persistence + immutable public share.
 *
 *   clear su:/si: + bt: rate_limits → create the synthetic user (API) →
 *   run the golden backtest ANONYMOUSLY in a fresh context → click Save →
 *   assert the login nudge appears (gate only at value) → sign in via the gate's
 *   form → the run is claimed (POST /api/backtest/runs 201, owned in the DB) →
 *   click Share → a public link is minted → re-share returns the SAME url
 *   (idempotent) → open the link in a THIRD context with NO auth → assert the
 *   read-only report + the point-in-time disclaimer render and the 6 headline
 *   stats match the owner's view → 360px clean → zero console errors.
 *
 * Cleanup sweeps ONLY the synthetic user + the backtest rows it created. It
 * NEVER touches demo@trademark.app, raashish1601@gmail.com, mahajandeepakshi03@gmail.com.
 *
 *   BASE_URL=http://localhost:3600 node scripts/e2e-bt-persistence.mjs
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

const BASE = process.env.BASE_URL ?? "http://localhost:3600";
const TS = Date.now();
const EMAIL = `e2e-btp-${TS}@example.com`;
const PASSWORD = "e2e-Passw0rd-123";

const browser = await chromium.launch();
const issues = [];
let failed = 0;
let passed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    issues.push(`[step] ${name} :: ${String(e.message).slice(0, 240)}`);
    console.log(`  FAIL ${name}: ${String(e.message).slice(0, 240)}`);
  }
};

const wireListeners = (page) => {
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (t.includes("401")) return; // expected: save POST 401s once before the gate
    if (t.includes("/_vercel")) return;
    issues.push(`[console] ${page.url()} :: ${t.slice(0, 250)}`);
  });
  page.on("pageerror", (e) =>
    issues.push(`[pageerror] ${page.url()} :: ${String(e.message).slice(0, 250)}`)
  );
  page.on("response", (r) => {
    if (r.status() >= 400 && r.status() !== 401 && !r.url().includes("/_vercel"))
      issues.push(`[http ${r.status()}] ${r.url()}`);
  });
};

const noOverflow = async (page) => {
  const o = await page.evaluate(() => {
    const el = document.scrollingElement;
    return { sw: el.scrollWidth, cw: el.clientWidth };
  });
  if (o.sw > o.cw) throw new Error(`horizontal overflow ${o.sw} > ${o.cw}`);
};

const freshBuild = async (page) => {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("tmk.bt.draft.nocode");
      localStorage.removeItem("tmk.bt.prevrun");
      indexedDB.deleteDatabase("tmk.bt");
    } catch {}
  });
  await page.goto(`${BASE}/backtesting/build`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByTestId("bt-stepper").first().waitFor({ timeout: 20000 });
};

const runGolden = async (page) => {
  for (let i = 0; i < 4; i++) await page.getByTestId("bt-continue").click();
  await page.getByTestId("bt-step-review").waitFor({ timeout: 10000 });
  await page.getByTestId("bt-run").click();
  await page.getByTestId("bt-results-done").waitFor({ timeout: 30000 });
  await page.locator('[data-status="done"]').waitFor({ timeout: 30000 });
};

const sixStats = async (page) => {
  await page.locator("[data-stat-key]").first().waitFor({ timeout: 10000 });
  return page.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll("[data-stat-key]")) {
      const k = el.getAttribute("data-stat-key");
      const v = el.querySelector(".font-money")?.textContent?.trim();
      if (k && v && !(k in out)) out[k] = v;
    }
    return out;
  });
};

// ── Pre-flight: rate limits + the synthetic user (created via API) ──
await step("clear su:/si: + bt: rate_limits", async () => {
  const db = dbClient();
  if (!db) throw new Error("no platform DB creds");
  await db.execute(
    `DELETE FROM rate_limits WHERE key LIKE 'su:%' OR key LIKE 'si:%' OR key LIKE 'bt:%'`
  );
});

const api = (await browser.newContext()).request;
await step("create the synthetic user (API sign-up + verify)", async () => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await api.post(`${BASE}/api/auth/sign-up/email`, {
      data: { email: EMAIL, password: PASSWORD, name: "E2E BT Persist" },
      headers: { origin: BASE },
    });
    if (res.status() === 429) {
      await new Promise((r) => setTimeout(r, 12000));
      continue;
    }
    if (![200, 201].includes(res.status()))
      throw new Error(`sign-up failed: ${res.status()} ${(await res.text()).slice(0, 120)}`);
    break;
  }
  const db = dbClient();
  await db.execute({ sql: `UPDATE user SET email_verified = 1 WHERE email = ?`, args: [EMAIL] });
});

// ── Anonymous run → Save → login nudge → sign in → claim ──
const ownerCtx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
const owner = await ownerCtx.newPage();
wireListeners(owner);

let ownerStats = {};
let shareUrl = null;

console.log("— owner: anonymous run → save (login nudge) → claim → share —");

await step("run the golden backtest fully anonymously (no gate to build/run)", async () => {
  await freshBuild(owner);
  await runGolden(owner);
  ownerStats = await sixStats(owner);
  if (!ownerStats.netPnl?.includes("1,899.29"))
    throw new Error(`expected golden +₹1,899.29, got ${JSON.stringify(ownerStats)}`);
});

await step("the Save/Share bar appears with an anonymous hint", async () => {
  await owner.getByTestId("bt-save-share-bar").scrollIntoViewIfNeeded();
  await owner.getByTestId("bt-save-share-bar").waitFor({ timeout: 8000 });
  await owner.getByText(/sign in only to save or share/i).waitFor({ timeout: 5000 });
});

await step("clicking Save raises the login nudge (gate ONLY at value)", async () => {
  await owner.getByTestId("bt-save").click();
  // SignInGate is the app's auth-nudge dialog ("Join the conversation").
  await owner.getByText("Join the conversation").waitFor({ timeout: 8000 });
});

await step("sign in via the gate → the held run is claimed (POST 201, owned)", async () => {
  // The AuthForm opens in sign-UP mode; the user already exists (API pre-step),
  // so switch to sign-IN to avoid the signup rate-limit, then submit.
  await owner.getByRole("button", { name: /Already have an account\?/i }).click();
  await owner.getByRole("heading", { name: "Welcome back" }).waitFor({ timeout: 5000 });
  await owner.getByPlaceholder("you@example.com").fill(EMAIL);
  await owner.getByPlaceholder("8+ characters").fill(PASSWORD);
  // The one-shot claim effect POSTs the held run after auth resolves.
  const [save] = await Promise.all([
    owner.waitForResponse(
      (r) =>
        r.url().endsWith("/api/backtest/runs") &&
        r.request().method() === "POST" &&
        r.status() === 201,
      { timeout: 40000 }
    ),
    owner.getByRole("button", { name: "Sign in", exact: true }).click(),
  ]);
  const json = await save.json();
  if (!json.runId) throw new Error("save response missing runId");
});

await step("the claimed run is owned by the synthetic user in the DB (never re-run)", async () => {
  const db = dbClient();
  const rows = await db.execute({
    sql: `SELECT r.id, r.run_result FROM backtest_runs r
          JOIN user u ON u.id = r.user_id WHERE u.email = ?`,
    args: [EMAIL],
  });
  if (rows.rows.length < 1) throw new Error("no claimed run owned by the synthetic user");
  const blob = String(rows.rows[0].run_result);
  if (!blob.includes("1899.29")) throw new Error("stored run did not preserve the golden net P&L");
});

await step("Share mints a public link; re-share returns the SAME url (idempotent)", async () => {
  const [share1] = await Promise.all([
    owner.waitForResponse(
      (r) =>
        /\/api\/backtest\/runs\/[^/]+\/share$/.test(r.url()) && r.request().method() === "POST",
      { timeout: 20000 }
    ),
    owner.getByTestId("bt-share").click(),
  ]);
  const j1 = await share1.json();
  if (!j1.url) throw new Error("first share returned no url");
  shareUrl = j1.url;
  await owner.getByTestId("bt-share-url").waitFor({ timeout: 8000 });

  // Re-share the same run → same id (idempotency on the server).
  const [share2] = await Promise.all([
    owner.waitForResponse(
      (r) =>
        /\/api\/backtest\/runs\/[^/]+\/share$/.test(r.url()) && r.request().method() === "POST",
      { timeout: 20000 }
    ),
    owner.getByTestId("bt-share").click(),
  ]);
  const j2 = await share2.json();
  if (j2.url !== shareUrl) throw new Error(`re-share changed the url: ${shareUrl} → ${j2.url}`);
});

// ── Public viewer (NO auth) ──
console.log("— public viewer (no auth): immutable read-only share —");
const viewCtx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
const viewer = await viewCtx.newPage();
wireListeners(viewer);

await step("the share link renders read-only with NO auth", async () => {
  if (!shareUrl) throw new Error("no share url to open");
  await viewer.goto(shareUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await viewer.getByTestId("bt-results-done").waitFor({ timeout: 20000 });
  // It is read-only: no Save/Share bar on a shared run, even though un-authed.
  if (await viewer.getByTestId("bt-save-share-bar").count())
    throw new Error("a shared run must not show the Save/Share bar");
});

await step("the point-in-time / not-advice disclaimer is present", async () => {
  await viewer.getByTestId("bt-share-disclaimer").waitFor({ timeout: 8000 });
  const txt = (await viewer.getByTestId("bt-share-disclaimer").textContent())?.toLowerCase() ?? "";
  if (!txt.includes("not advice") && !txt.includes("point-in-time"))
    throw new Error(`disclaimer missing the honest framing: "${txt}"`);
});

await step("the 6 headline stats match the owner's view exactly", async () => {
  const viewerStats = await sixStats(viewer);
  for (const k of ["netPnl", "winRate", "maxDrawdown", "expectancy", "profitFactor", "sharpe"]) {
    if (viewerStats[k] !== ownerStats[k])
      throw new Error(`stat ${k} mismatch: owner ${ownerStats[k]} vs shared ${viewerStats[k]}`);
  }
});

await step("the shared report fits 360px with zero horizontal overflow", async () => {
  await viewer.setViewportSize({ width: 360, height: 800 });
  await viewer.goto(shareUrl, { waitUntil: "domcontentloaded" });
  await viewer.getByTestId("bt-results-done").waitFor({ timeout: 20000 });
  await noOverflow(viewer);
});

// ── Cleanup: ONLY the synthetic user + its backtest rows ──
console.log("— cleanup (synthetic user + its backtest rows only) —");
await step("sweep the synthetic user's backtest rows + account", async () => {
  const db = dbClient();
  const u = await db.execute({ sql: `SELECT id FROM user WHERE email = ?`, args: [EMAIL] });
  const uid = u.rows[0]?.id;
  if (uid) {
    await db.execute({ sql: `DELETE FROM backtest_runs WHERE user_id = ?`, args: [uid] });
    await db.execute({ sql: `DELETE FROM backtest_strategies WHERE user_id = ?`, args: [uid] });
    await db.execute({
      sql: `DELETE FROM notifications WHERE user_id = ? OR actor_id = ?`,
      args: [uid, uid],
    });
    await db.execute({ sql: `DELETE FROM session WHERE user_id = ?`, args: [uid] });
    await db.execute({ sql: `DELETE FROM account WHERE user_id = ?`, args: [uid] });
    await db.execute({ sql: `DELETE FROM user WHERE id = ?`, args: [uid] });
  }
  // Safety assertion: we only ever touched the e2e-btp-* synthetic identity.
  if (!EMAIL.startsWith("e2e-btp-")) throw new Error("refusing to sweep a non-synthetic user");
});

await browser.close();

console.log(`\n${passed} passed, ${failed} failed`);
if (issues.length) {
  console.log(`\n— ${issues.length} issue(s) —`);
  for (const i of [...new Set(issues)]) console.log("  " + i);
  process.exit(1);
} else {
  console.log("\nNo console errors, no failed requests. ✅");
}
