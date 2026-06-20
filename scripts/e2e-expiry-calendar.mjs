/**
 * Feature e2e: the journal calendar's "Upcoming expiries" tab (NSE/BSE/MCX/NCDEX).
 *
 * Verifies against a running prod build (demo mode) that the tab renders the
 * cross-exchange expiry calendar, surfaces NIFTY + F&O stocks, and that the
 * exchange filter narrows the list — with zero console errors.
 *
 * Run (app serving a prod build on :3000):
 *   BASE_URL=http://localhost:3000 SHOT_DIR=. node scripts/e2e-expiry-calendar.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? ".";
const issues = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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

await step("seed demo journal (with IndexedDB settle)", async () => {
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

await step("calendar page shows the two tabs", async () => {
  await page.goto(`${BASE}/app/calendar`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /P&L calendar/ }).waitFor({ timeout: 15000 });
  await page.getByRole("tab", { name: /Upcoming expiries/ }).waitFor({ timeout: 5000 });
});

await step("Upcoming expiries tab renders cross-exchange day cards", async () => {
  await page.getByRole("tab", { name: /Upcoming expiries/ }).click();
  await page.getByTestId("upcoming-expiries").waitFor({ timeout: 10000 });
  // NIFTY (an index) must appear in the nearest expiries.
  await page.getByText("NIFTY", { exact: true }).first().waitFor({ timeout: 8000 });
  // Single-stock F&O are summarized as ONE "Stocks" chip (no individual names).
  await page.getByText("Stocks", { exact: true }).first().waitFor({ timeout: 8000 });
});

await step("Options/Futures dropdown switches contract type", async () => {
  const view = page.getByTestId("upcoming-expiries");
  await view.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Futures" }).click();
  await view.waitFor();
  await page.getByText("NIFTY", { exact: true }).first().waitFor({ timeout: 6000 });
  await view.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Options" }).click();
  await page.getByText("NIFTY", { exact: true }).first().waitFor({ timeout: 6000 });
  await view.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "All contracts" }).click();
});

await step("exchange filter narrows to NCDEX agri only", async () => {
  await page.getByRole("button", { name: "NCDEX" }).click();
  await page.getByTestId("upcoming-expiries").waitFor();
  // GUARSEED is an NCDEX agri contract; NIFTY must disappear under the filter.
  await page.getByText("GUARSEED", { exact: true }).first().waitFor({ timeout: 8000 });
  await page.waitForTimeout(300);
  if (await page.getByText("NIFTY", { exact: true }).first().isVisible())
    throw new Error("NIFTY should be hidden under the NCDEX filter");
  // back to all
  await page.getByRole("button", { name: "All exchanges" }).click();
  await page.screenshot({ path: `${SHOT_DIR}/_expiry-calendar.png`, fullPage: false });
});

await step("mobile (390px) reflows without horizontal overflow", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.getByTestId("upcoming-expiries").waitFor();
  await page.getByText("NIFTY", { exact: true }).first().waitFor({ timeout: 6000 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  if (overflow > 2) throw new Error(`horizontal overflow on mobile: ${overflow}px`);
  await page.screenshot({ path: `${SHOT_DIR}/_expiry-calendar-mobile.png`, fullPage: false });
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
