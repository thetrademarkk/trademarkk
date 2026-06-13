/**
 * Feature e2e: psychology / discipline scoring v2.
 *
 * Verifies in a real Chromium against a running build (demo mode, no platform
 * users):
 *   - the new onboarding "Explore with sample data" path populates the journal;
 *   - /app/insights renders the three discipline sections on rich data —
 *       • a per-day discipline score (0–100) with a current value and trend line;
 *       • plan adherence with a target-hit rate + exit mix;
 *       • confidence calibration with scored 1–5 bins (and over/under flags);
 *   - on a THIN (empty) demo journal every discipline section shows its honest
 *     "not enough data" state — no fabricated score, no chart;
 *   - everything fits a 360px viewport with zero horizontal overflow;
 *   - zero console errors / page errors / failed requests throughout.
 *
 * Run (with the app already serving):
 *   BASE_URL=http://localhost:3200 node scripts/e2e-discipline.mjs
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

/* ── Pass 1: rich sample-data demo lights up all three sections ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
  const page = await ctx.newPage();
  wireListeners(page);

  console.log("— Sample-data demo —");
  await step("onboarding → setup step", async () => {
    await page.goto(`${BASE}/app/onboarding`, { waitUntil: "networkidle" });
    await page.getByText("Try without an account").click();
    await page
      .getByRole("button", { name: "Explore with sample data" })
      .waitFor({ timeout: 60000 });
  });

  await step("'Explore with sample data' seeds the journal", async () => {
    await page.getByRole("button", { name: "Explore with sample data" }).click();
    await page.waitForURL("**/app/dashboard", { timeout: 60000 });
    await page.getByText("Net P&L").first().waitFor({ timeout: 30000 });
  });

  // The discipline section is recharts-backed → wait for the section, not idle.
  const gotoInsights = async () => {
    await page.goto(`${BASE}/app/insights`, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("heading", { name: "Discipline & psychology" })
      .waitFor({ timeout: 30000 });
  };

  console.log("— Discipline score —");
  await step("per-day discipline score renders with a current value + trend", async () => {
    await gotoInsights();
    const card = page.locator('[data-insight="discipline-score"]');
    await card.waitFor({ timeout: 20000 });
    // Current score is a 0–100 integer published via a data attribute.
    const cur = await page
      .locator("[data-discipline-current]")
      .first()
      .getAttribute("data-discipline-current");
    const score = Number(cur);
    if (!Number.isInteger(score) || score < 0 || score > 100)
      throw new Error(`implausible current score "${cur}"`);
    // The recharts line must actually draw a path (animation disabled).
    await card.locator("svg .recharts-line-curve").first().waitFor({ timeout: 15000 });
    if (!(await card.getByText(/Days scored/).isVisible()))
      throw new Error("no days-scored summary");
  });

  console.log("— Plan adherence —");
  await step("plan adherence shows a target-hit rate + exit mix on planned trades", async () => {
    const card = page.locator('[data-insight="plan-adherence"]');
    await card.waitFor({ timeout: 15000 });
    const rate = await card
      .locator("[data-plan-target-rate]")
      .first()
      .getAttribute("data-plan-target-rate");
    const r = Number(rate);
    if (!Number.isInteger(r) || r < 0 || r > 100)
      throw new Error(`implausible target rate "${rate}"`);
    await card.getByText("Hit target").waitFor({ timeout: 10000 });
    await card.getByText("Hit stop").waitFor();
  });

  console.log("— Confidence calibration —");
  await step("calibration bins render and at least one is scored", async () => {
    const card = page.locator('[data-insight="confidence-calibration"]');
    await card.waitFor({ timeout: 15000 });
    const scored = await card
      .locator('[data-calibration-flag]:not([data-calibration-flag=""])')
      .count();
    if (scored < 1) throw new Error("no scored confidence bin");
    // Every rendered bin advertises its 1–5 rating.
    const bins = await card.locator("[data-calibration-bin]").count();
    if (bins < 1) throw new Error("no calibration bins rendered");
  });

  console.log("— 360px (rich) —");
  await step("discipline sections fit 360px with zero overflow", async () => {
    await page.setViewportSize({ width: 360, height: 800 });
    await gotoInsights();
    await page.locator('[data-insight="discipline-score"]').waitFor({ timeout: 20000 });
    await noOverflow(page);
  });

  await ctx.close();
}

/* ── Pass 2: empty journal → honest "not enough data" everywhere ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
  const page = await ctx.newPage();
  wireListeners(page);

  console.log("— Thin-data suppression —");
  await step("fresh empty demo journal", async () => {
    await page.goto(`${BASE}/app/onboarding`, { waitUntil: "networkidle" });
    await page.getByText("Try without an account").click();
    await page.getByRole("button", { name: "Start journaling" }).click();
    await page.waitForURL("**/app/dashboard", { timeout: 60000 });
  });

  await step("empty journal shows 'No insights yet' and fabricates no score", async () => {
    await page.goto(`${BASE}/app/insights`, { waitUntil: "domcontentloaded" });
    await page.getByText("No insights yet").waitFor({ timeout: 30000 });
    // The honesty gate: with zero trades there is no discipline score at all.
    if ((await page.locator("[data-discipline-current]").count()) > 0)
      throw new Error("a discipline score rendered on an empty journal");
    if ((await page.locator('[data-insight="discipline-score"]').count()) > 0)
      throw new Error("discipline section rendered on a totally empty journal");
  });

  await step("a single below-gate trade keeps every discipline section suppressed", async () => {
    // Log one trade with a plan + confidence — still under every MIN_SAMPLE gate.
    await page.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Add trade" }).first().click();
    await page.getByPlaceholder("NIFTY / RELIANCE").waitFor({ timeout: 10000 });
    await page.getByPlaceholder("NIFTY / RELIANCE").fill("RELIANCE");
    // Equity needs no strike/expiry — keeps this single-trade seed simple.
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Equity" }).click();
    await page.getByPlaceholder("75").first().fill("10");
    await page.getByPlaceholder("120.50").first().fill("100");
    await page.getByPlaceholder("blank = open").first().fill("110");
    await page.getByPlaceholder("risk per trade").fill("90"); // stop loss
    // Target + planned entry are the two unplaceheld number inputs in the risk row.
    const targetInput = page.locator('input[name="plannedTarget"]');
    if ((await targetInput.count()) > 0) await targetInput.fill("120");
    const plannedEntry = page.locator('input[name="plannedEntry"]');
    if ((await plannedEntry.count()) > 0) await plannedEntry.fill("100");
    await page.getByRole("button", { name: "4", exact: true }).click(); // confidence 4
    await page.getByRole("button", { name: "Save trade" }).click();
    await page.locator("article, tr", { hasText: "RELIANCE" }).first().waitFor({ timeout: 15000 });

    await page.goto(`${BASE}/app/insights`, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("heading", { name: "Discipline & psychology" })
      .waitFor({ timeout: 30000 });
    // Score trend: no current score (need ≥5 days), honest empty copy.
    await page
      .locator('[data-insight="discipline-score"]')
      .getByText(/Need at least .* trading days/)
      .waitFor({ timeout: 15000 });
    if ((await page.locator("[data-discipline-current]").count()) > 0)
      throw new Error("a discipline score rendered below the trend-day gate");
    // Plan adherence: 1 planned trade < MIN_SAMPLE → empty state, no target rate.
    await page
      .locator('[data-insight="plan-adherence"]')
      .getByText(/Set planned entry, stop and target/)
      .waitFor({ timeout: 10000 });
    if ((await page.locator("[data-plan-target-rate]").count()) > 0)
      throw new Error("plan adherence published a rate below MIN_SAMPLE");
    // Calibration: 1 trade in bin 4 < MIN_SAMPLE → no scored bin.
    const scored = await page
      .locator('[data-calibration-flag]:not([data-calibration-flag=""])')
      .count();
    if (scored > 0) throw new Error("a confidence bin was scored below MIN_SAMPLE");
  });

  await step("suppressed discipline sections fit 360px", async () => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`${BASE}/app/insights`, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("heading", { name: "Discipline & psychology" })
      .waitFor({ timeout: 20000 });
    await noOverflow(page);
  });

  await ctx.close();
}

await browser.close();

console.log(`\n${passed} passed, ${failed} failed`);
if (issues.length) {
  console.log(`\n— ${issues.length} issue(s) —`);
  for (const i of [...new Set(issues)]) console.log("  " + i);
  process.exit(1);
} else {
  console.log("\nNo console errors, no failed requests. ✅");
}
