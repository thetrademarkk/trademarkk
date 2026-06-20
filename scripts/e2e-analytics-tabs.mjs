/**
 * Feature e2e: the Analytics section switcher is mobile-friendly — a dropdown on
 * a phone (7 tabs don't fit a 360px strip) and the full pill strip on desktop.
 *
 * Run (app serving a prod build on :3000):
 *   BASE_URL=http://localhost:3000 SHOT_DIR=. node scripts/e2e-analytics-tabs.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? ".";
const issues = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.on("console", (m) => {
  if (m.type() === "error") issues.push(`[console] ${m.text().slice(0, 200)}`);
});
page.on("pageerror", (e) => issues.push(`[pageerror] ${String(e.message).slice(0, 200)}`));

let passed = 0;
let failed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    issues.push(`[step] ${name} :: ${String(e.message).slice(0, 200)}`);
    console.log(`  FAIL ${name}: ${String(e.message).slice(0, 200)}`);
  }
};

await step("seed demo journal", async () => {
  await page.goto(`${BASE}/app/onboarding`, { waitUntil: "networkidle" });
  await page.getByText("Try without an account").click();
  await page.getByText("Set up your journal").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Start journaling" }).click();
  await page.waitForURL("**/app/dashboard", { timeout: 60000 });
  await page
    .getByText(/0\/6 followed/)
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(2500);
});

await step(
  "mobile shows a dropdown switcher (not a cramped pill strip) + no overflow",
  async () => {
    await page.goto(`${BASE}/app/analytics`, { waitUntil: "domcontentloaded" });
    const select = page.getByRole("combobox", { name: "Analytics section" });
    await select.waitFor({ timeout: 15000 });
    // The desktop pill tablist must be hidden on mobile.
    const tablistVisible = await page
      .getByRole("tablist")
      .first()
      .isVisible()
      .catch(() => false);
    if (tablistVisible) throw new Error("pill tablist should be hidden on mobile");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    if (overflow > 2) throw new Error(`horizontal overflow on mobile: ${overflow}px`);
    await page.screenshot({ path: `${SHOT_DIR}/_analytics-tabs-mobile.png`, fullPage: false });
  }
);

await step("the dropdown switches the analytics section", async () => {
  await page.getByRole("combobox", { name: "Analytics section" }).click();
  await page.getByRole("option", { name: "Monte Carlo" }).click();
  await page.waitForTimeout(400);
  const val = await page.getByRole("combobox", { name: "Analytics section" }).innerText();
  if (!/Monte Carlo/.test(val)) throw new Error(`dropdown should read 'Monte Carlo', saw "${val}"`);
});

await step("desktop shows the full pill strip", async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);
  await page.getByRole("tab", { name: "Monte Carlo" }).waitFor({ timeout: 5000 });
  await page.getByRole("tab", { name: "Distribution" }).waitFor({ timeout: 3000 });
  // The mobile dropdown is hidden on desktop.
  const selVisible = await page
    .getByRole("combobox", { name: "Analytics section" })
    .isVisible()
    .catch(() => false);
  if (selVisible) throw new Error("mobile dropdown should be hidden on desktop");
});

await ctx.close();
await browser.close();

console.log(`\n${passed} passed, ${failed} failed`);
if (issues.length) {
  console.log(`\n— ${issues.length} issue(s) —`);
  for (const i of [...new Set(issues)]) console.log("  " + i);
  process.exit(1);
} else {
  console.log("\nNo console errors. ✅");
}
