/**
 * Feature e2e: the community mobile bottom bar (CommunityBottomNav).
 *
 * Verifies against a running prod build that /community renders the journal-style
 * 5-tab bottom bar on mobile (Feed/Ranks/Trending/Chat/Alerts), that it's hidden
 * on desktop, and that the page has no horizontal overflow at 390px.
 *
 * Run (app serving a prod build on :3000):
 *   BASE_URL=http://localhost:3000 SHOT_DIR=. node scripts/e2e-community-bottom-bar.mjs
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

const TABS = ["Feed", "Ranks", "Trending", "Chat", "Alerts"];

await step("community feed renders the mobile bottom bar with 5 tabs", async () => {
  // The feed polls (conversations/notifications), so networkidle never settles.
  await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded" });
  const bar = page.getByRole("navigation", { name: "Community" });
  await bar.waitFor({ timeout: 15000 });
  for (const t of TABS) await bar.getByText(t, { exact: true }).first().waitFor({ timeout: 6000 });
});

await step("no horizontal overflow at 390px", async () => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  if (overflow > 2) throw new Error(`horizontal overflow on mobile: ${overflow}px`);
  await page.screenshot({ path: `${SHOT_DIR}/_community-bottom-bar.png`, fullPage: false });
});

await step("bar Feed tab is active on the feed route", async () => {
  const bar = page.getByRole("navigation", { name: "Community" });
  const feed = bar.getByRole("link", { name: /Feed/ });
  const current = await feed.getAttribute("aria-current");
  if (current !== "page") throw new Error(`Feed tab should be aria-current=page, got ${current}`);
});

await step("bottom bar is hidden on desktop (>=md)", async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);
  const visible = await page
    .getByRole("navigation", { name: "Community" })
    .isVisible()
    .catch(() => false);
  if (visible) throw new Error("Community bottom bar should be hidden on desktop");
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
