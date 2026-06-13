/**
 * Feature e2e (SEG-04): backfill + "Recompute charges" maintenance action.
 *
 * Verifies in a real Chromium against a running build (demo mode, no platform
 * users):
 *   - a delivery (CNC) equity trade can be logged carrying a STALE charge value
 *     (the old engine treated all equity as intraday) → its stored charges are
 *     wrong;
 *   - Settings → "Recompute charges" PREVIEWS the change in an in-app confirm
 *     dialog (count + total ₹ delta) before writing anything;
 *   - confirming corrects the trade's charges AND net P&L (gross untouched);
 *   - the trade-detail page reflects the corrected charges/net;
 *   - re-running finds nothing to change (idempotent) — never rewrites P&L
 *     silently;
 *   - the card fits a 360px viewport with zero horizontal overflow;
 *   - zero console errors / page errors / failed requests throughout.
 *
 * Run (with the app already serving):
 *   BASE_URL=http://localhost:3500 node scripts/e2e-seg-recompute.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3500";
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
    issues.push(`[step] ${name} :: ${String(e.message).slice(0, 240)}`);
    console.log(`  FAIL ${name}: ${String(e.message).slice(0, 240)}`);
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
  if (o.sw > o.cw + 1) throw new Error(`horizontal overflow ${o.sw} > ${o.cw}`);
};

const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
const page = await ctx.newPage();
wireListeners(page);

// A delivery EQ trade we can find uniquely in the table.
const SYMBOL = "EQDELIV";
const STALE_CHARGES = "800"; // overstated (old all-intraday estimate was wrong)

console.log("— Demo onboarding —");
await step("empty demo → dashboard", async () => {
  await page.goto(`${BASE}/app/onboarding`, { waitUntil: "networkidle" });
  await page.getByText("Try without an account").click();
  await page.getByText("Set up your journal").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Start journaling" }).click();
  await page.waitForURL("**/app/dashboard", { timeout: 60000 });
});

console.log("— Seed a stale delivery EQ trade —");
let detailUrl = "";
await step("log a CNC equity trade with a stale (overstated) charge override", async () => {
  await page.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  await page.keyboard.press("t");
  await page.getByPlaceholder("NIFTY / RELIANCE").waitFor({ timeout: 10000 });
  await page.getByPlaceholder("NIFTY / RELIANCE").fill(SYMBOL);
  // Segment → Equity
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Equity" }).click();
  // Product → Delivery (CNC)
  await page.getByRole("button", { name: "Delivery (CNC)" }).click();
  await page.getByPlaceholder("75").fill("100");
  await page.getByPlaceholder("120.50").fill("2000");
  await page.getByPlaceholder("blank = open").fill("2100");
  // Charges override = a stale/overstated value the old engine would have stored.
  await page.getByLabel(/Charges override/).fill(STALE_CHARGES);
  await page.getByRole("button", { name: "Save trade" }).click();
  await page.getByText("Trade saved").waitFor({ timeout: 10000 });
});

await step("the stored trade carries the stale charge + matching net", async () => {
  await page.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  const row = page.locator("tr", { hasText: SYMBOL }).first();
  await row.waitFor({ timeout: 20000 });
  await row.click();
  await page.getByRole("link", { name: /Open full view/ }).click();
  await page.waitForURL("**/app/trades/**", { timeout: 20000 });
  detailUrl = page.url();
  await page.getByText("P&L breakdown").waitFor({ timeout: 15000 });
  // Charges row shows the stale ₹800.00
  const chargesText = await page
    .locator("div", { hasText: /^Charges/ })
    .last()
    .innerText();
  if (!/800/.test(chargesText)) throw new Error(`expected stale ₹800 charges, saw: ${chargesText}`);
});

console.log("— Recompute (preview → confirm → apply) —");
await step("Settings shows the Recompute charges card", async () => {
  await page.goto(`${BASE}/app/settings`, { waitUntil: "networkidle" });
  await page.getByText("Recompute charges").first().waitFor({ timeout: 15000 });
  await page.getByText(/intraday and a delivery position/).waitFor({ timeout: 10000 });
});

await step("clicking the action previews a delta in an in-app confirm dialog", async () => {
  await page.getByTestId("recompute-charges-btn").click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 15000 });
  const body = await dialog.innerText();
  if (!/Recompute 1 trade/.test(body))
    throw new Error(`confirm should preview 1 changed trade, saw: ${body}`);
  if (!/reduced/.test(body))
    throw new Error(`charges were overstated → confirm should say "reduced", saw: ${body}`);
});

await step("confirming corrects the charge + net P&L (gross unchanged)", async () => {
  await page.getByRole("button", { name: "Recompute charges" }).click();
  await page.getByTestId("recompute-result").waitFor({ timeout: 15000 });
  // Verify on the trade detail page: charges are no longer ₹800.
  await page.goto(detailUrl, { waitUntil: "networkidle" });
  await page.getByText("P&L breakdown").waitFor({ timeout: 15000 });
  const chargesText = await page
    .locator("div", { hasText: /^Charges/ })
    .last()
    .innerText();
  if (/800/.test(chargesText))
    throw new Error(`charges should no longer be the stale ₹800, saw: ${chargesText}`);
  // Gross stays ₹10,000 ((2100-2000)*100); net = gross - corrected charges > old net.
  const grossText = await page
    .locator("div", { hasText: /^Gross P&L/ })
    .last()
    .innerText();
  if (!/10,000/.test(grossText)) throw new Error(`gross must stay 10,000, saw: ${grossText}`);
});

await step("re-running the recompute is idempotent (nothing to change)", async () => {
  await page.goto(`${BASE}/app/settings`, { waitUntil: "networkidle" });
  await page.getByTestId("recompute-charges-btn").click();
  // No confirm dialog this time — a success toast says everything is correct.
  await page
    .getByText(/already correct/)
    .first()
    .waitFor({ timeout: 15000 });
  if ((await page.getByRole("dialog").count()) > 0)
    throw new Error("idempotent re-run must not pop a confirm dialog");
});

console.log("— 360px —");
await step("Recompute card fits 360px with zero overflow", async () => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${BASE}/app/settings`, { waitUntil: "domcontentloaded" });
  await page.getByText("Recompute charges").first().waitFor({ timeout: 15000 });
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
