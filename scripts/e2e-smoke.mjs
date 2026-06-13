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

console.log("— Community —");
await step("per-symbol stream renders with the not-advice banner", async () => {
  // Signed-out /community never reaches networkidle (polling) → domcontentloaded.
  await page.goto(`${BASE}/community/s/NIFTY`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "$NIFTY" }).first().waitFor({ timeout: 30000 });
  await page.locator("[data-not-advice]").first().waitFor({ timeout: 15000 });
});

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

await step("share-as-image: card paints with ₹ hidden by default", async () => {
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const canvas = page.getByTestId("share-card-canvas");
  await canvas.waitFor({ timeout: 15000 });
  const hero = await canvas.getAttribute("data-hero");
  if (!hero || hero.includes("₹")) throw new Error(`₹ leaked into default hero: ${hero}`);
  // The canvas must actually be painted (it renders async after fonts load).
  const lit = await canvas.evaluate(async (c) => {
    const count = () => {
      const { data } = c.getContext("2d").getImageData(0, 0, c.width, 200);
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 40 || data[i + 1] > 40 || data[i + 2] > 40) n++;
      }
      return n;
    };
    for (let tries = 0; tries < 50; tries++) {
      if (count() >= 500) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return count();
  });
  if (lit < 500) throw new Error(`canvas looks blank (${lit} lit pixels)`);
  await page.keyboard.press("Escape");
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
await step("analytics: all seven tabs render", async () => {
  await page.goto(`${BASE}/app/analytics`, { waitUntil: "networkidle" });
  // One closed trade exists (quick-add above) → hour chart has data.
  await page.getByText("By entry hour").waitFor({ timeout: 20000 });
  for (const tab of ["Setup", "Instrument", "Distribution"]) {
    await page.getByRole("tab", { name: tab }).click();
  }
  await page.getByText("R-multiple distribution").waitFor();
  // Options tab — the single quick-add trade is EQ, so strategy grouping + DTE
  // buckets must show their honest empty states (no options trades yet).
  await page.getByRole("tab", { name: "Options" }).click();
  await page.getByText("By strategy").waitFor({ timeout: 15000 });
  await page.getByText("Days to expiry").waitFor();
  // Monte Carlo tab — one closed EQ trade carries no R, so the simulator must
  // show its honest "not enough data" gate (needs MIN_TRADES R-bearing trades),
  // never a fabricated cone.
  await page.getByRole("tab", { name: "Monte Carlo" }).click();
  await page.getByTestId("mc-gate").waitFor({ timeout: 15000 });
  await page
    .getByText(/Not enough data yet/)
    .first()
    .waitFor();
  // More-statistics pack — one closed trade is below every MIN_SAMPLE gate, so
  // the per-bucket charts must show honest empty states, not fabricated bars.
  await page.getByRole("tab", { name: "More" }).click();
  await page.getByText("Hold duration").waitFor({ timeout: 15000 });
  await page.getByText("Day × time of day").waitFor();
  await page.getByText(/No hold-duration bucket has/).waitFor({ timeout: 10000 });
});

console.log("— Insights —");
await step("insights: honest 'not enough data' state below min sample", async () => {
  // Only one closed trade exists at this point — every insight must stay suppressed.
  await page.goto(`${BASE}/app/insights`, { waitUntil: "networkidle" });
  await page.getByText("Not enough data yet").waitFor({ timeout: 15000 });
});

await step("insights: no tilt card sneaks past the gate on thin data", async () => {
  const tiltCards = await page.locator('[data-insight^="tilt-"]').count();
  if (tiltCards > 0) throw new Error(`${tiltCards} tilt card(s) rendered with one trade`);
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

console.log("— Workflow polish —");
await step("bulk multi-select + batch-tag tags the trade", async () => {
  await page.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  await page.locator("table tbody tr").first().waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Select" }).click();
  await page.getByLabel("Select all trades").click();
  const bar = page.getByTestId("bulk-action-bar");
  await bar.waitFor({ timeout: 10000 });
  await bar.getByRole("button", { name: "Add tag" }).click();
  const tagBtn = page.locator("[data-radix-popper-content-wrapper] button").first();
  await tagBtn.waitFor({ timeout: 8000 });
  await tagBtn.click();
  await page
    .getByText(/Tagged \d+ trade/)
    .first()
    .waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Clear" }).click();
});

await step("plan a trade dialog opens + logs a plan", async () => {
  await page.getByRole("button", { name: "Plan a trade" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Log plan").waitFor({ timeout: 8000 });
  await dialog.getByPlaceholder("NIFTY / RELIANCE").fill("SMOKEPLAN");
  await dialog.getByLabel("Planned entry").fill("100");
  await dialog.getByRole("button", { name: "Log plan" }).click();
  await page.getByText("Plan logged").first().waitFor({ timeout: 8000 });
  await page.keyboard.press("Escape");
});

await step("note template: save current, then apply on a fresh form", async () => {
  await page.keyboard.press("Control+q");
  await page.getByPlaceholder("NIFTY / RELIANCE").waitFor({ timeout: 10000 });
  await page.getByPlaceholder(/What was the thesis/).fill("Smoke template thesis.");
  await page.getByRole("button", { name: "Templates" }).click();
  await page.getByText("Save current as template").click();
  await page.getByPlaceholder("Template name…").fill("Smoke template");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByText(/Template "Smoke template" saved/)
    .first()
    .waitFor({ timeout: 8000 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+q");
  await page.getByPlaceholder("NIFTY / RELIANCE").waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Templates" }).click();
  await page.getByRole("menuitem", { name: "Smoke template" }).click();
  await page
    .getByText(/Applied "Smoke template"/)
    .first()
    .waitFor({ timeout: 8000 });
  await page.keyboard.press("Escape");
});

await step("daily prompts persist across reload", async () => {
  await page.goto(`${BASE}/app/journal`, { waitUntil: "networkidle" });
  await page.getByTestId("daily-prompts").waitFor({ timeout: 15000 });
  await page.locator("#prompt-bestTrade").fill("Smoke best trade.");
  await page.getByRole("button", { name: "Save journal" }).click();
  await page.getByText("Journal saved").first().waitFor({ timeout: 10000 });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("daily-prompts").waitFor({ timeout: 15000 });
  const v = await page.locator("#prompt-bestTrade").inputValue();
  if (v !== "Smoke best trade.") throw new Error(`daily prompt did not persist: ${v}`);
});

await step("? opens the keyboard shortcuts help sheet", async () => {
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.keyboard.press("Shift+Slash");
  await page.getByTestId("shortcuts-help").waitFor({ timeout: 8000 });
  await page.keyboard.press("Escape");
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
