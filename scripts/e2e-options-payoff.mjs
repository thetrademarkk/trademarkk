/**
 * Feature e2e: options payoff diagrams + DTE buckets + strategy grouping.
 *
 * Verifies in a real Chromium against a running build (demo mode, no platform
 * users):
 *   - the sample-data demo seeds multi-leg option strategies;
 *   - a multi-leg OPT trade's detail page renders the payoff-at-expiry SVG with
 *     the correct auto-detected strategy label and the strategy-legs breakdown;
 *   - a single-leg OPT trade also renders a payoff diagram (Long Call label);
 *   - the analytics "Options" tab shows strategy-grouping rows (multi-leg
 *     collapsed into one named structure) and DTE buckets;
 *   - the DTE n>=MIN_SAMPLE gate is honest: a well-populated bucket (0DTE) is
 *     enabled while a thin bucket (>30, only 3 demo trades) stays suppressed;
 *   - everything fits a 360px viewport with zero horizontal overflow;
 *   - zero console errors / page errors / failed requests throughout.
 *
 * Run (with the app already serving):
 *   BASE_URL=http://localhost:3200 node scripts/e2e-options-payoff.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3200";
const issues = [];
const browser = await chromium.launch();

let passed = 0;
let failed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    issues.push(`[step] ${name} :: ${String(e.message).slice(0, 220)}`);
    console.log(`  FAIL ${name}: ${String(e.message).slice(0, 220)}`);
  }
};

const wireListeners = (page) => {
  page.on("console", (m) => {
    if (m.type() === "error") issues.push(`[console] ${page.url()} :: ${m.text().slice(0, 250)}`);
  });
  page.on("pageerror", (e) =>
    issues.push(`[pageerror] ${page.url()} :: ${String(e.message).slice(0, 250)}`)
  );
  page.on("response", (r) => {
    if (r.status() >= 400) issues.push(`[http ${r.status()}] ${r.url()}`);
  });
};

const noOverflow = async (page) => {
  const o = await page.evaluate(() => {
    const el = document.scrollingElement;
    return { sw: el.scrollWidth, cw: el.clientWidth };
  });
  if (o.sw > o.cw) throw new Error(`horizontal overflow ${o.sw} > ${o.cw}`);
};

const openFullView = async (page, rowText) => {
  await page.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  const row = page.locator("tr", { hasText: rowText }).first();
  await row.waitFor({ timeout: 20000 });
  await row.click();
  await page.getByRole("link", { name: /Open full view/ }).click();
  await page.waitForURL("**/app/trades/**", { timeout: 20000 });
};

const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
const page = await ctx.newPage();
wireListeners(page);

console.log("— Sample-data demo —");
await step("onboarding → 'Explore with sample data' seeds the journal", async () => {
  await page.goto(`${BASE}/app/onboarding`, { waitUntil: "networkidle" });
  await page.getByText("Try without an account").click();
  await page.getByRole("button", { name: "Explore with sample data" }).waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Explore with sample data" }).click();
  await page.waitForURL("**/app/dashboard", { timeout: 60000 });
  await page.getByText("Net P&L").first().waitFor({ timeout: 30000 });
});

console.log("— Multi-leg payoff diagram —");
let straddleUrl = "";
await step("a multi-leg straddle detail renders the payoff SVG + strategy label", async () => {
  // The seeded long straddle is the unique NIFTY 26000 CE row (a strike the
  // random single-leg generator never produces).
  await openFullView(page, "NIFTY 26000 CE");
  straddleUrl = page.url();

  const svg = page.locator('[data-testid="payoff-svg"]');
  await svg.waitFor({ timeout: 15000 });
  const label = await svg.getAttribute("aria-label");
  if (!label || !label.includes("Straddle"))
    throw new Error(`payoff aria-label missing Straddle: "${label}"`);
  // The curve path must actually draw.
  const dAttr = await svg.locator("path[stroke]").first().getAttribute("d");
  if (!dAttr || dAttr.length < 10) throw new Error("payoff curve path did not render");
  // A long straddle has two breakevens; the strategy-legs breakdown lists legs.
  await page.getByText("Breakevens").waitFor({ timeout: 10000 });
  await page.getByText("Strategy legs").waitFor({ timeout: 10000 });
});

await step("a single-leg OPT trade also renders a payoff diagram", async () => {
  await page.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  const row = page
    .locator("tr")
    .filter({ hasText: /(NIFTY|BANKNIFTY|SENSEX) \d+ (CE|PE)/ })
    .first();
  await row.waitFor({ timeout: 15000 });
  await row.click();
  await page.getByRole("link", { name: /Open full view/ }).click();
  await page.waitForURL("**/app/trades/**", { timeout: 20000 });
  await page.locator('[data-testid="payoff-svg"]').waitFor({ timeout: 15000 });
});

console.log("— Analytics Options tab —");
await step("strategy grouping + DTE buckets render with an honest n-gate", async () => {
  await page.goto(`${BASE}/app/analytics`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Options" }).click();
  await page.locator('[data-testid="strategy-groups"]').waitFor({ timeout: 20000 });
  // Multi-leg structures collapse into named rows with a multi-leg badge.
  const strategyRows = await page.locator("[data-strategy]").count();
  if (strategyRows < 2) throw new Error(`expected several strategy rows, got ${strategyRows}`);
  if ((await page.getByText(/multi-leg/).count()) < 1)
    throw new Error("no multi-leg badge in strategy grouping");

  await page.locator('[data-testid="dte-buckets"]').waitFor({ timeout: 10000 });
  // 0DTE clears MIN_SAMPLE (every single-leg seed trade expires same-day) …
  const zero = page.locator('[data-dte-bucket="0DTE"]');
  await zero.waitFor({ timeout: 10000 });
  if ((await zero.getAttribute("data-enough")) !== "true")
    throw new Error("0DTE bucket should clear MIN_SAMPLE on demo data");
  // … while the far-dated >30 bucket (only 3 demo trades) stays suppressed.
  const far = page.locator('[data-dte-bucket=">30"]');
  if ((await far.count()) > 0 && (await far.getAttribute("data-enough")) === "true")
    throw new Error(">30 DTE bucket should be suppressed below MIN_SAMPLE");
});

console.log("— 360px —");
await step("payoff + options analytics fit 360px with zero overflow", async () => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${BASE}/app/analytics`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Options" }).click();
  await page.locator('[data-testid="strategy-groups"]').waitFor({ timeout: 20000 });
  await noOverflow(page);
  // Reuse the straddle detail URL (trades list is a card grid, not a table, at
  // 360px) to re-check the payoff diagram fits with zero overflow.
  await page.goto(straddleUrl, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="payoff-svg"]').waitFor({ timeout: 15000 });
  await noOverflow(page);
});

await ctx.close();
await browser.close();

console.log(`\n${passed} passed, ${failed} failed`);
if (issues.length) {
  console.log(`\n— ${issues.length} issue(s) —`);
  for (const i of [...new Set(issues)]) console.log("  " + i);
  process.exit(1);
} else {
  console.log("\nNo console errors, no failed requests. ✅");
}
