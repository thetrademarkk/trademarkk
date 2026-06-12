/**
 * End-to-end smoke test: walks every marketing page, runs the full demo flow
 * (seed → dashboard → add trade → journal → rules → all screens) in a real
 * Chromium, and reports every console error, page error and failed request.
 *
 * Setup (local only — Playwright is not a project dependency):
 *   npm i -D playwright && npx playwright install chromium
 * Run (with the app already serving on :3000):
 *   npm start &  &&  npm run e2e
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const issues = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
const page = await ctx.newPage();

page.on("console", (m) => {
  if (m.type() === "error") issues.push(`[console] ${page.url()} :: ${m.text().slice(0, 250)}`);
});
page.on("pageerror", (e) =>
  issues.push(`[pageerror] ${page.url()} :: ${String(e.message).slice(0, 250)}`)
);
page.on("response", (r) => {
  if (r.status() >= 400) issues.push(`[http ${r.status()}] ${r.url()}`);
});

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

console.log("— Marketing pages —");
for (const path of [
  "/",
  "/features",
  "/faq",
  "/docs",
  "/blog",
  "/blog/why-every-fno-trader-needs-a-journal",
  "/changelog",
  "/compare/tradezella-alternative",
]) {
  await step(`marketing ${path}`, async () => {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await page.locator("h1").first().waitFor({ timeout: 10000 });
  });
}

console.log("— Demo onboarding —");
await step("onboarding renders 3 mode cards", async () => {
  await page.goto(`${BASE}/app/onboarding`, { waitUntil: "networkidle" });
  await page.getByText("Start free — we host it").waitFor({ timeout: 15000 });
  await page.getByText("Bring your own database").waitFor();
  await page.getByText("Try without an account").waitFor();
});

await step("demo starts EMPTY → setup → dashboard", async () => {
  await page.getByText("Try without an account").click();
  await page.getByText("Set up your journal").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Start journaling" }).click();
  await page.waitForURL("**/app/dashboard", { timeout: 60000 });
  await page.getByText("Net P&L").first().waitFor({ timeout: 30000 });
});

console.log("— Dashboard —");
await step("dashboard renders fresh journal (rules checklist, empty states)", async () => {
  await page.getByText("Equity curve").waitFor({ timeout: 15000 });
  // 6 starter rules seeded by setup → checklist shows "0/6 followed".
  await page
    .getByText(/0\/6 followed/)
    .first()
    .waitFor({ timeout: 20000 });
  await page.getByText("No trades yet").waitFor({ timeout: 15000 });
});

console.log("— Trades —");
await step("quick-add: equity trade saves", async () => {
  await page.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  await page.keyboard.press("t");
  await page.getByPlaceholder("NIFTY / RELIANCE").waitFor({ timeout: 10000 });
  await page.getByPlaceholder("NIFTY / RELIANCE").fill("TESTSTOCK");
  // switch segment to Equity (no strike/CE-PE needed)
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Equity" }).click();
  await page.getByPlaceholder("75").fill("10");
  await page.getByPlaceholder("120.50").fill("500");
  await page.getByPlaceholder("blank = open").fill("510");
  await page.getByRole("button", { name: "Save trade" }).click();
  await page.getByText("Trade saved").waitFor({ timeout: 10000 });
});

await step("trades list renders the new trade", async () => {
  await page.locator("table tbody tr").first().waitFor({ timeout: 20000 });
});

await step("search filter finds it", async () => {
  await page.getByPlaceholder("Symbol…").fill("TESTSTOCK");
  await page.getByText("TESTSTOCK").first().waitFor({ timeout: 10000 });
  await page.getByPlaceholder("Symbol…").fill("");
});

await step("trade quick-view modal → full detail page", async () => {
  await page.locator("table tbody tr").first().click();
  const modal = page.getByRole("dialog");
  await modal.getByText("Net P&L").waitFor({ timeout: 15000 });
  await modal.getByRole("link", { name: /Open full view/ }).click();
  await page.getByText("P&L breakdown").waitFor({ timeout: 15000 });
  await page.getByText("Execution").waitFor();
});

console.log("— Journal —");
await step("journal saves an entry", async () => {
  await page.goto(`${BASE}/app/journal`, { waitUntil: "networkidle" });
  await page.getByPlaceholder(/What worked/).fill("E2E smoke test review.");
  await page.getByRole("button", { name: "Save journal" }).click();
  await page.getByText("Journal saved").waitFor({ timeout: 10000 });
});

console.log("— Rules —");
await step("rules: toggle a daily check + add a rule", async () => {
  await page.goto(`${BASE}/app/rules`, { waitUntil: "networkidle" });
  await page.getByText("Today's rules").waitFor({ timeout: 15000 });
  await page.locator('button[title="followed"]').first().click();
  await page.getByPlaceholder(/No trades after/).fill("E2E test rule");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("E2E test rule").first().waitFor({ timeout: 10000 });
});

console.log("— Calendar —");
await step("calendar heatmap renders", async () => {
  await page.goto(`${BASE}/app/calendar`, { waitUntil: "networkidle" });
  await page.getByText("Month:").waitFor({ timeout: 15000 });
});

console.log("— Analytics —");
await step("analytics: all four tabs render", async () => {
  await page.goto(`${BASE}/app/analytics`, { waitUntil: "networkidle" });
  // One closed trade exists (quick-add above) → hour chart has data.
  await page.getByText("By entry hour").waitFor({ timeout: 20000 });
  for (const tab of ["Setup", "Instrument", "Distribution"]) {
    await page.getByRole("tab", { name: tab }).click();
  }
  await page.getByText("R-multiple distribution").waitFor();
});

console.log("— Insights —");
await step("insights: honest 'not enough data' state below min sample", async () => {
  // Only one closed trade exists at this point — every insight must stay suppressed.
  await page.goto(`${BASE}/app/insights`, { waitUntil: "networkidle" });
  await page.getByText("Not enough data yet").waitFor({ timeout: 15000 });
});

console.log("— Playbooks —");
await step("playbooks render with stats", async () => {
  await page.goto(`${BASE}/app/playbooks`, { waitUntil: "networkidle" });
  await page.getByText("Opening Range Breakout").waitFor({ timeout: 15000 });
});

console.log("— Reports —");
await step("reports: weekly + monthly render", async () => {
  await page.goto(`${BASE}/app/reports`, { waitUntil: "networkidle" });
  await page
    .getByText(/review/)
    .first()
    .waitFor({ timeout: 15000 });
  // The report's own period selector shows "Weekly" (the topbar one shows a day range).
  await page.getByRole("combobox").filter({ hasText: "Weekly" }).click();
  await page.getByRole("option", { name: "Monthly" }).click();
  await page
    .getByText(/review/)
    .first()
    .waitFor();
});

console.log("— Settings —");
await step("settings sections render", async () => {
  await page.goto(`${BASE}/app/settings`, { waitUntil: "networkidle" });
  await page.getByText("Storage & data").waitFor({ timeout: 15000 });
  await page.getByText("Account & charges").waitFor();
  await page.getByText("Appearance").waitFor();
  await page.getByText("Danger zone").waitFor();
});

await step("demo data persists across reload (IndexedDB)", async () => {
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "networkidle" });
  await page.getByText("Net P&L").first().waitFor({ timeout: 30000 });
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
