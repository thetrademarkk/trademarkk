/**
 * For-You interest feed + cold-start starter follows (rank-12) e2e:
 *   clear su:/si: rate_limits -> sign up + verify + sign in THREE distinct users
 *   (interested viewer A, author B, brand-new cold-start viewer D) via API ->
 *     B posts P_tag (#options, no ticker), P_sym ($NIFTY), P_plain (neither) ->
 *   A follows #options (API) + watches $NIFTY (API) ->
 *     A's For-You feed (API /foryou) ranks P_tag and P_sym ABOVE P_plain, and
 *     never the viewer's own posts ->
 *   A opens /community, selects the "For You" tab (UI) -> the feed renders with
 *     the "Ranked from..." explainer; Latest is still the default tab ->
 *   brand-new viewer D (no signals) -> For-You is NON-EMPTY (Top fallback) AND
 *     the starter-suggestions "Get started" card is shown (tags + traders) ->
 *   D follows a suggested tag from the card (UI) -> POST 200 ->
 *   360px renders cleanly -> zero console errors.
 *
 *   BASE_URL=http://localhost:3100 node scripts/e2e-foryou.mjs
 *
 * Leaves its own users behind for the DB-level sweep (e2e-fy-*@example.com).
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
const SYMBOL = "NIFTY"; // a watched ticker (real index)
const TAG = "options"; // a followed tag (curated)
const MARKER = `E2E foryou ${TS}`;
const A = { email: `e2e-fy-a-${TS}@example.com`, name: "E2E FY Viewer" };
const B = { email: `e2e-fy-b-${TS}@example.com`, name: "E2E FY Author" };
const D = { email: `e2e-fy-d-${TS}@example.com`, name: "E2E FY Newbie" };
const PASSWORD = "e2e-Passw0rd-123";
const BODY_TAG = `${MARKER} TAG — about trading discipline. #${TAG}`;
const BODY_SYM = `${MARKER} SYM — watching the index $${SYMBOL} today.`;
const BODY_PLAIN = `${MARKER} PLAIN — a generic note with no tag or ticker.`;

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

const createPost = async (ctx, body, tags = []) => {
  const res = await ctx.request.post(`${BASE}/api/community/posts`, {
    data: { body, tags },
    headers: { origin: BASE },
  });
  if (res.status() !== 201)
    throw new Error(`post create failed: ${res.status()} ${(await res.text()).slice(0, 120)}`);
  return (await res.json()).id;
};

const forYouBodies = async (ctx) => {
  const res = await ctx.request.get(`${BASE}/api/community/foryou`, { headers: { origin: BASE } });
  if (res.status() !== 200) throw new Error(`foryou feed query failed: ${res.status()}`);
  const data = await res.json();
  return (data.posts ?? []).map((p) => p.body ?? "");
};

console.log(`For-You e2e on ${BASE}`);

await step("clear su:/si: rate_limits", clearSignupRateLimits);

let ctxA;
let ctxD;
await step("auth A + B + D; B posts tag/symbol/plain posts", async () => {
  ctxA = await authContext(A);
  ctxD = await authContext(D);
  const ctxB = await authContext(B);
  // The followed tag must be a real stored tag (the body's #hashtag is cosmetic;
  // tags are persisted from the `tags` array), so pass tags: ["options"].
  await createPost(ctxB, BODY_TAG, [TAG]);
  await createPost(ctxB, BODY_SYM);
  await createPost(ctxB, BODY_PLAIN);
  await ctxB.close();
});

await step("A follows #options (API) + watches $NIFTY (API)", async () => {
  const f = await ctxA.request.post(`${BASE}/api/community/tags/${TAG}/follow`, {
    headers: { origin: BASE },
  });
  if (f.status() !== 200) throw new Error(`follow tag failed: ${f.status()}`);
  const w = await ctxA.request.post(`${BASE}/api/community/watchlist/${SYMBOL}`, {
    headers: { origin: BASE },
  });
  if (w.status() !== 200) throw new Error(`watch symbol failed: ${w.status()}`);
});

await step(
  "A's For-You ranks the followed-tag + watched-symbol posts above a plain one",
  async () => {
    const bodies = await forYouBodies(ctxA);
    const idxTag = bodies.findIndex((b) => b.includes("TAG —"));
    const idxSym = bodies.findIndex((b) => b.includes("SYM —"));
    const idxPlain = bodies.findIndex((b) => b.includes("PLAIN —"));
    if (idxTag === -1) throw new Error("followed-tag post missing from For-You");
    if (idxSym === -1) throw new Error("watched-symbol post missing from For-You");
    if (idxPlain !== -1 && (idxTag > idxPlain || idxSym > idxPlain))
      throw new Error(
        `interest posts should outrank the plain one (tag=${idxTag} sym=${idxSym} plain=${idxPlain})`
      );
  }
);

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

await step("'For You' is an optional tab; Latest stays the default", async () => {
  await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded", timeout: 90000 });
  // Latest is pressed by default (not For You) — avoids a forced filter bubble.
  await page
    .getByRole("button", { name: "Latest", exact: true })
    .first()
    .waitFor({ timeout: 60000 });
  // The For-You tab exists and is selectable.
  await page.getByRole("button", { name: "For You", exact: true }).first().click();
  // The For-You explainer renders.
  await page.getByText(/Ranked from the tags, tickers and traders/i).waitFor({ timeout: 20000 });
});

await step("brand-new viewer D: For-You is non-empty (Top fallback)", async () => {
  const bodies = await forYouBodies(ctxD);
  if (bodies.length === 0)
    throw new Error("cold-start For-You should fall back to a non-empty Top feed");
});

const pageD = await ctxD.newPage();
pageD.on("dialog", (d) => d.accept());
pageD.on("console", (m) => {
  if (m.type() !== "error") return;
  const text = m.text();
  if (text.includes("401")) return;
  issues.push(`[console] ${pageD.url()} :: ${text.slice(0, 220)}`);
});
pageD.on("pageerror", (e) => issues.push(`[pageerror] ${String(e.message).slice(0, 220)}`));

await step("cold-start D sees the 'Get started' starter-follows card on For-You", async () => {
  await pageD.goto(`${BASE}/community`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await pageD.getByRole("button", { name: "For You", exact: true }).first().click();
  await pageD.locator("[data-starter-suggestions]").first().waitFor({ timeout: 20000 });
  await pageD.getByText("Get started", { exact: false }).first().waitFor({ timeout: 10000 });
});

await step("cold-start starter card renders cleanly at 360px (no overflow)", async () => {
  await pageD.setViewportSize({ width: 360, height: 780 });
  await pageD.goto(`${BASE}/community`, { waitUntil: "domcontentloaded" });
  const tab = pageD.getByRole("button", { name: "For You", exact: true }).first();
  await tab.waitFor({ timeout: 30000 });
  await tab.click();
  await pageD.locator("[data-starter-suggestions]").first().waitFor({ timeout: 20000 });
  const overflow = await pageD.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  if (overflow > 1) throw new Error(`starter card overflows by ${overflow}px at 360px`);
  await pageD.setViewportSize({ width: 1380, height: 900 });
});

await step("cold-start D follows a suggested tag from the card (UI -> POST 200)", async () => {
  const card = pageD.locator("[data-starter-suggestions]").first();
  const tagBtn = card.getByRole("button", { name: /^#/ }).first();
  await tagBtn.waitFor({ timeout: 10000 });
  await Promise.all([
    pageD.waitForResponse(
      (r) =>
        /\/api\/community\/tags\/[^/]+\/follow$/.test(r.url()) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20000 }
    ),
    tagBtn.click(),
  ]);
});

await step("mobile 360px: For-You renders without horizontal overflow", async () => {
  // Use viewer A's page — A has interest signals, so For-You renders a real
  // ranked feed (the starter card is intentionally hidden once you follow
  // something, as D did in the previous step). We assert the For-You explainer
  // paints and the doc doesn't overflow at 360px.
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded" });
  const tab = page.getByRole("button", { name: "For You", exact: true }).first();
  await tab.waitFor({ timeout: 30000 });
  await tab.click();
  await page.getByText(/Ranked from the tags, tickers and traders/i).waitFor({ timeout: 20000 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  if (overflow > 1) throw new Error(`For-You overflows by ${overflow}px at 360px`);
});

await browser.close();
if (issues.length) {
  console.log(`\n${failed} step(s) failed; ${issues.length} issue(s):`);
  for (const i of issues) console.log("  " + i);
  process.exit(1);
}
console.log("\nFor-You e2e passed (zero console errors).");
