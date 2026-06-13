/**
 * Hosted-mode lifecycle test against a LIVE deployment:
 * sign up → provision real Turso DB → setup → add trade → sign out →
 * sign in → data persists → delete account (cleans up the provisioned DB).
 *
 *   BASE_URL=https://thetrademarkk.com node scripts/e2e-hosted.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = `e2e-${Date.now()}@example.com`;
const PASSWORD = "e2e-Passw0rd-123";
const issues = [];

const browser = await chromium.launch();
const page = await browser
  .newContext({ viewport: { width: 1380, height: 900 } })
  .then((c) => c.newPage());
page.on("pageerror", (e) => issues.push(`[pageerror] ${String(e.message).slice(0, 200)}`));
page.on("dialog", (d) => d.accept());

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

console.log(`Hosted lifecycle on ${BASE} as ${EMAIL}`);

await step("sign up creates account", async () => {
  // networkidle ensures React has hydrated before we click.
  await page.goto(`${BASE}/app/onboarding`, { waitUntil: "networkidle" });
  await page.getByText("Start free — we host it").click();
  await page.getByText("Create your free account").waitFor({ timeout: 15000 });
  await page.getByPlaceholder("Your name").fill("E2E Hosted");
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.getByPlaceholder("8+ characters").fill(PASSWORD);
  await page.getByRole("button", { name: "Create free account" }).click();
  // provisioning a real Turso DB takes a few seconds
  await page.getByText("Set up your journal").waitFor({ timeout: 90000 });
});

await step("setup completes → dashboard", async () => {
  await page.getByRole("button", { name: "Start journaling" }).click();
  await page.waitForURL("**/app/dashboard", { timeout: 60000 });
  await page.getByText("Net P&L").first().waitFor({ timeout: 30000 });
});

await step("trade saves to hosted DB", async () => {
  await page.keyboard.press("t");
  await page.getByPlaceholder("NIFTY / RELIANCE").fill("HOSTEDTEST");
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Equity" }).click();
  await page.getByPlaceholder("75").fill("5");
  await page.getByPlaceholder("120.50").fill("100");
  await page.getByPlaceholder("blank = open").fill("110");
  await page.getByRole("button", { name: "Save trade" }).click();
  await page.getByText("Trade saved").waitFor({ timeout: 15000 });
});

await step("sign out", async () => {
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "networkidle" });
  await page.getByText("Net P&L").first().waitFor({ timeout: 30000 });
  await page.locator("header button").last().click(); // storage/user menu
  await page.getByText("Sign out").click();
  // Signed-out users land back on onboarding (or the homepage).
  await page.waitForURL((u) => u.pathname === "/" || u.pathname.endsWith("/onboarding"), {
    timeout: 20000,
  });
});

await step("sign in again → data persisted in hosted DB", async () => {
  await page.goto(`${BASE}/app/onboarding`, { waitUntil: "networkidle" });
  await page.getByText("Start free — we host it").click();
  await page.getByText("Create your free account").waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: /Already have an account/ }).click();
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.getByPlaceholder("8+ characters").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/app/dashboard", { timeout: 90000 });
  await page.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  await page.getByText("HOSTEDTEST").first().waitFor({ timeout: 30000 });
});

await step("delete account cleans up", async () => {
  await page.goto(`${BASE}/app/settings`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Delete account/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/app"), { timeout: 30000 });
});

await browser.close();
if (failed > 0) {
  console.log("\nIssues:");
  for (const i of issues) console.log("  " + i);
  process.exit(1);
}
console.log("\n✅ Hosted lifecycle passed end to end.");
