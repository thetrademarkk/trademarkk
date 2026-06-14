/**
 * Feature e2e: journal-app accessibility / perf / cohesion hardening pass.
 *
 * Runs in real Chromium against a serving prod build (demo mode, no platform
 * users — the journal runs on the client DB seeded via the onboarding
 * "Explore with sample data" path). Verifies:
 *   - data-viz charts expose an accessible name (role="img" + aria-label that
 *     states the headline numbers, never colour alone) on dashboard + analytics;
 *   - NumberFlow stat tiles announce their value to a screen reader (the rolling
 *     digits are aria-hidden, so an sr-only value must carry the number);
 *   - heavy analytics tabs LAZY-MOUNT — only the default tab's charts exist on
 *     first paint; Monte Carlo / Options panels mount only when their tab opens;
 *   - n-gate empty states stay honest on a SPARSE journal (no fabricated chart);
 *   - the tax report renders and its print layout hides app chrome;
 *   - 360px has zero horizontal overflow on every audited surface;
 *   - zero console errors / page errors / failed requests throughout.
 *
 * Run (with the app already serving):
 *   BASE_URL=http://localhost:3400 node scripts/e2e-journal-a11y.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3400";
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
    issues.push(`[step] ${name} :: ${String(e.message).slice(0, 260)}`);
    console.log(`  FAIL ${name}: ${String(e.message).slice(0, 260)}`);
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

const seedSample = async (page) => {
  await page.goto(`${BASE}/app/onboarding`, { waitUntil: "networkidle" });
  await page.getByText("Try without an account").click();
  await page.getByRole("button", { name: "Explore with sample data" }).waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Explore with sample data" }).click();
  await page.waitForURL("**/app/dashboard", { timeout: 60000 });
  await page.getByText("Net P&L").first().waitFor({ timeout: 30000 });
};

const seedEmpty = async (page) => {
  await page.goto(`${BASE}/app/onboarding`, { waitUntil: "networkidle" });
  await page.getByText("Try without an account").click();
  await page.getByRole("button", { name: "Start journaling" }).click();
  await page.waitForURL("**/app/dashboard", { timeout: 60000 });
};

/* ── Pass 1: rich sample data — chart a11y + stat tiles + lazy tabs ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
  const page = await ctx.newPage();
  wireListeners(page);

  console.log("— Seed sample data —");
  await step("'Explore with sample data' seeds the journal", () => seedSample(page));

  console.log("— Dashboard chart a11y —");
  await step("equity curve exposes an accessible name with values", async () => {
    await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
    const chart = page.locator('[role="img"][aria-label*="Equity curve"]');
    await chart.first().waitFor({ timeout: 30000 });
    const label = await chart.first().getAttribute("aria-label");
    if (!/Ends at/.test(label ?? ""))
      throw new Error(`equity aria-label lacks a value: "${label}"`);
  });

  await step("KPI stat tiles announce their value (NumberFlow is aria-hidden)", async () => {
    // The visible Net P&L tile rolls its digits aria-hidden — assert the sr-only
    // value (a currency string) exists, and that the rolling digits are hidden.
    const netTile = page.locator(".micro-label", { hasText: "Net P&L" }).first();
    await netTile.waitFor({ timeout: 15000 });
    const card = netTile.locator("xpath=ancestor::*[contains(@class,'p-4')][1]");
    const srText = await card.locator("span.sr-only").first().innerText({ timeout: 5000 });
    if (!/₹/.test(srText))
      throw new Error(`stat tile sr-only value not a currency string: "${srText}"`);
    const hidden = await card.locator('[aria-hidden="true"]').count();
    if (hidden < 1) throw new Error("NumberFlow ticker is not aria-hidden");
  });

  await step("month heatmap day cells carry signed-P&L aria labels", async () => {
    const dayBtn = page.locator('button[aria-label*="₹"]').first();
    await dayBtn.waitFor({ timeout: 15000 });
    const label = await dayBtn.getAttribute("aria-label");
    if (!/[+\-]₹/.test(label ?? ""))
      throw new Error(`calendar cell label lacks signed P&L: "${label}"`);
  });

  console.log("— Analytics chart a11y + lazy tabs —");
  const gotoAnalytics = async () => {
    await page.goto(`${BASE}/app/analytics`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Time" }).waitFor({ timeout: 30000 });
  };

  await step("default Time tab: GroupBar charts have aria-label summaries", async () => {
    await gotoAnalytics();
    const chart = page.locator('[role="img"][aria-label*="bar chart of net profit and loss"]');
    await chart.first().waitFor({ timeout: 20000 });
    const n = await chart.count();
    if (n < 1) throw new Error("no labelled GroupBar charts on the Time tab");
  });

  await step("heavy tabs lazy-mount — Monte Carlo absent until its tab is open", async () => {
    // On the default Time tab, the Monte-Carlo panel must not be mounted.
    if ((await page.locator('[data-testid="mc-ready"], [data-testid="mc-gate"]').count()) > 0)
      throw new Error("Monte Carlo mounted on first paint (should be lazy)");
    if (
      (await page.locator('[data-testid="dte-buckets"], [data-testid="strategy-groups"]').count()) >
      0
    )
      throw new Error("Options panel mounted on first paint (should be lazy)");
  });

  await step("opening Monte Carlo mounts it with an accessible equity cone", async () => {
    await page.getByRole("tab", { name: "Monte Carlo" }).click();
    // Either the gate or the ready panel mounts (depends on R-bearing trade count).
    await page
      .locator('[data-testid="mc-ready"], [data-testid="mc-gate"]')
      .first()
      .waitFor({ timeout: 30000 });
    const ready = await page.locator('[data-testid="mc-ready"]').count();
    if (ready > 0) {
      const cone = page.locator('[data-testid="equity-cone"]');
      await cone.waitFor({ timeout: 30000 });
      const label = await cone.getAttribute("aria-label");
      if (!/Monte Carlo equity cone/.test(label ?? ""))
        throw new Error(`equity cone aria-label missing: "${label}"`);
    }
  });

  await step("More tab: heatmap cells expose per-slot aria labels", async () => {
    await page.getByRole("tab", { name: "More" }).click();
    await page.getByText("Day × time of day").waitFor({ timeout: 20000 });
    // At least one populated cell should be a labelled role=img.
    const cell = page.locator('[data-cell] [role="img"], [data-cell][role="img"]');
    // The cell div itself carries role=img when it has trades.
    const labelled = page.locator('div[role="img"][aria-label*=":"]');
    await labelled.first().waitFor({ timeout: 15000 });
    if ((await labelled.count()) < 1 && (await cell.count()) < 1)
      throw new Error("no labelled heatmap cells");
  });

  console.log("— Tax report —");
  await step("tax report renders an FY summary", async () => {
    await page.goto(`${BASE}/app/reports`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: /Tax/ }).click();
    await page
      .getByText(/summary/)
      .first()
      .waitFor({ timeout: 20000 });
  });

  await step("print layout hides app chrome (print:hidden on controls)", async () => {
    // Emulate print media and assert the page header / control bar collapse.
    await page.emulateMedia({ media: "print" });
    const headerVisible = await page
      .getByRole("heading", { name: "Reports" })
      .isVisible()
      .catch(() => false);
    if (headerVisible) throw new Error("Reports page header still visible under print media");
    await page.emulateMedia({ media: "screen" });
  });

  await ctx.close();
}

/* ── Pass 2: sparse journal — honesty gates stay honest ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
  const page = await ctx.newPage();
  wireListeners(page);

  console.log("— Sparse-data honesty gates —");
  await step("fresh empty demo journal", () => seedEmpty(page));

  await step("analytics shows honest empty states, not broken charts", async () => {
    await page.goto(`${BASE}/app/analytics`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Time" }).waitFor({ timeout: 30000 });
    // GroupBar empty state copy on the default tab.
    await page.getByText("Not enough data yet.").first().waitFor({ timeout: 20000 });
  });

  await step("Monte Carlo gate is honest below MIN_TRADES", async () => {
    await page.getByRole("tab", { name: "Monte Carlo" }).click();
    await page.locator('[data-testid="mc-gate"]').waitFor({ timeout: 20000 });
    if ((await page.locator('[data-testid="mc-ready"]').count()) > 0)
      throw new Error("Monte Carlo ran on an empty journal");
  });

  await step("tax report shows the honest empty FY card", async () => {
    await page.goto(`${BASE}/app/reports`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: /Tax/ }).click();
    await page.locator('[data-testid="tax-empty"]').waitFor({ timeout: 20000 });
  });

  console.log("— 360px overflow —");
  for (const path of ["/app/dashboard", "/app/analytics", "/app/insights", "/app/reports"]) {
    await step(`360px no overflow: ${path}`, async () => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(400);
      await noOverflow(page);
    });
  }

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
