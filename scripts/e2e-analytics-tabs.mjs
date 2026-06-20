/**
 * Feature e2e: the Analytics section switcher uses the journal underline tab
 * strip (like the calendar) — scrollable on a phone, with a violet underline on
 * the active tab — NOT a dropdown.
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
  "mobile shows the underline tab strip (not a dropdown), active tab underlined",
  async () => {
    await page.goto(`${BASE}/app/analytics`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Time" }).waitFor({ timeout: 15000 });
    // All 7 tabs are present in the strip.
    for (const t of [
      "Time",
      "Setup",
      "Instrument",
      "Distribution",
      "Options",
      "Monte Carlo",
      "More",
    ])
      await page.getByRole("tab", { name: t }).first().waitFor({ timeout: 6000 });
    // No dropdown switcher remains.
    const hasSelect = await page
      .getByRole("combobox", { name: "Analytics section" })
      .isVisible()
      .catch(() => false);
    if (hasSelect) throw new Error("the analytics dropdown should be gone — use the tab strip");
    // The active tab carries the violet underline (inset box-shadow), like the calendar.
    const shadow = await page
      .getByRole("tab", { name: "Time" })
      .first()
      .evaluate((el) => getComputedStyle(el).boxShadow);
    if (!shadow || shadow === "none" || !/inset/.test(shadow))
      throw new Error(`active tab should have the underline shadow, got ${shadow}`);
    // The PAGE must not overflow horizontally (the strip scrolls internally).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    if (overflow > 2) throw new Error(`horizontal page overflow on mobile: ${overflow}px`);
    await page.screenshot({ path: `${SHOT_DIR}/_analytics-tabs-mobile.png`, fullPage: false });
  }
);

await step("tapping a tab switches the section", async () => {
  await page.getByRole("tab", { name: "Monte Carlo" }).click(); // auto-scrolls the strip
  await page.waitForTimeout(300);
  const state = await page.getByRole("tab", { name: "Monte Carlo" }).getAttribute("data-state");
  if (state !== "active") throw new Error(`Monte Carlo tab should be active, got ${state}`);
});

await step("desktop shows the same tab strip", async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);
  await page.getByRole("tab", { name: "Monte Carlo" }).waitFor({ timeout: 5000 });
  await page.getByRole("tab", { name: "Distribution" }).waitFor({ timeout: 3000 });
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
