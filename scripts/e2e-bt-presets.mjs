/**
 * Feature e2e (BT-10): the PRESET CATALOGUE + Explore/Templates discovery
 * surface + the mandatory CoverageBadge, end-to-end in a real Chromium against a
 * prod build (strict CSP breaks `next dev`; CSP allows worker/wasm).
 *
 * Desktop verifies:
 *   - /backtesting/explore renders the preset grid with cards + CoverageBadges;
 *   - the honest "educational examples, not recommendations" banner is present;
 *   - filters (index / category) narrow the grid and clear restores it;
 *   - "Open in builder" on a preset hydrates the wizard with the preset's legs;
 *   - a LOCAL-data-backed NIFTY preset "Run" → results render WITH a CoverageBadge;
 *   - a non-local (BANKNIFTY/SENSEX) preset shows the honest LOCKED state, NOT a
 *     fabricated result;
 *   - zero console errors / page errors / failed requests.
 * Mobile (360px) verifies the grid + a card are clean (no horizontal overflow).
 *
 * Run (with a PROD build serving):  BASE_URL=http://localhost:3600 node scripts/e2e-bt-presets.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3600";
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
    if (r.status() >= 400 && !r.url().includes("/_vercel"))
      issues.push(`[http ${r.status()}] ${r.url()}`);
  });
};

const noOverflow = async (page) => {
  const o = await page.evaluate(() => {
    const el = document.scrollingElement;
    return { sw: el.scrollWidth, cw: el.clientWidth };
  });
  if (o.sw > o.cw) throw new Error(`horizontal overflow ${o.sw} > ${o.cw}`);
};

const clearDraft = async (page) => {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("tmk.bt.draft.nocode");
    } catch {}
  });
};

// ── Desktop ──────────────────────────────────────────────────────────────
const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
const page = await ctx.newPage();
wireListeners(page);

console.log("— Desktop Explore —");

await step("the Explore grid renders preset cards with CoverageBadges", async () => {
  await clearDraft(page);
  await page.goto(`${BASE}/backtesting/explore`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("preset-grid").waitFor({ timeout: 20000 });
  const cards = page.getByTestId("preset-card");
  const count = await cards.count();
  if (count < 10) throw new Error(`expected >=10 preset cards, got ${count}`);
  // Every card carries the MANDATORY coverage badge.
  const badges = page.getByTestId("preset-card").locator('[data-testid="coverage-badge"]');
  if ((await badges.count()) < count)
    throw new Error(`coverage badge missing on some cards (${await badges.count()} < ${count})`);
});

await step("the honest 'educational, not recommendations' banner is present", async () => {
  const banner = page.getByTestId("explore-disclaimer");
  await banner.waitFor({ timeout: 8000 });
  const txt = (await banner.textContent())?.toLowerCase() ?? "";
  if (!txt.includes("not trade recommendations"))
    throw new Error(`banner copy missing the disclaimer: "${txt.slice(0, 80)}"`);
});

await step("a SENSEX card surfaces LOW coverage honestly (no hiding)", async () => {
  const sensex = page.locator('[data-preset-id="sensex-iron-condor"]');
  await sensex.waitFor({ timeout: 8000 });
  const bucket = await sensex
    .locator('[data-testid="coverage-badge"]')
    .first()
    .getAttribute("data-coverage-bucket");
  if (!["low", "medium"].includes(bucket))
    throw new Error(`SENSEX coverage should be low/medium, got "${bucket}"`);
});

await step("filtering by index narrows the grid, clearing restores it", async () => {
  const all = await page.getByTestId("preset-card").count();
  await page.getByTestId("filter-index-NIFTY").click();
  await page.waitForTimeout(150);
  const niftyOnly = await page.getByTestId("preset-card").count();
  if (niftyOnly >= all) throw new Error(`index filter did not narrow (${niftyOnly} >= ${all})`);
  // Every visible card is now NIFTY.
  const ids = await page
    .getByTestId("preset-card")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-preset-id")));
  if (!ids.every((id) => id?.startsWith("nifty-")))
    throw new Error(`non-NIFTY card visible under NIFTY filter: ${ids.join(",")}`);
  await page.getByTestId("filter-clear").click();
  await page.waitForTimeout(150);
  if ((await page.getByTestId("preset-card").count()) !== all)
    throw new Error("clearing the filter did not restore all cards");
});

await step("category filter combines correctly", async () => {
  await page.getByTestId("filter-category-hedged").click();
  await page.waitForTimeout(150);
  const n = await page.getByTestId("preset-card").count();
  if (n < 1) throw new Error("hedged filter produced no cards");
  await page.getByTestId("filter-clear").click();
  await page.waitForTimeout(150);
});

await step("'Open in builder' hydrates the wizard with the preset's legs", async () => {
  // Iron condor = 4 legs; open it in the builder and assert 4 leg rows appear.
  const card = page.locator('[data-preset-id="nifty-iron-condor"]');
  await card.waitFor({ timeout: 8000 });
  await card.getByTestId("preset-open-builder").click();
  await page.waitForURL(/\/backtesting\/build/, { timeout: 15000 });
  await page.getByTestId("bt-step-legs").waitFor({ timeout: 15000 });
  // The strike ladders (one per leg) reflect the 4-leg condor.
  const ladders = page.locator('[role="listbox"]');
  await ladders.first().waitFor({ timeout: 10000 });
  const legCount = await ladders.count();
  if (legCount !== 4) throw new Error(`expected 4 hydrated legs, got ${legCount}`);
});

await step("a LOCAL-data NIFTY preset Runs and renders results WITH a CoverageBadge", async () => {
  await clearDraft(page);
  await page.goto(`${BASE}/backtesting/build?preset=nifty-short-straddle&run=1`, {
    waitUntil: "domcontentloaded",
  });
  // Auto-run kicks off from the Review step.
  await page.getByTestId("bt-result").waitFor({ timeout: 30000 });
  await page.locator('[data-status="done"]').waitFor({ timeout: 30000 });
  // MANDATORY coverage badge on the run result.
  await page.getByTestId("bt-result-coverage").waitFor({ timeout: 10000 });
  const badge = page
    .getByTestId("bt-result-coverage")
    .locator('[data-testid="coverage-badge"]')
    .first();
  await badge.waitFor({ timeout: 8000 });
  // A real Net P&L number rendered (not a fabricated/placeholder).
  const tile = page.locator('[data-stat-key="netPnl"]').first();
  await tile.waitFor({ timeout: 10000 });
  const txt = (await tile.locator(".font-money").first().textContent())?.trim() ?? "";
  if (!/[\d]/.test(txt)) throw new Error(`Net P&L did not render a number: "${txt}"`);
});

await step("a non-local preset shows the honest LOCKED state (NOT a result)", async () => {
  await clearDraft(page);
  await page.goto(`${BASE}/backtesting/explore`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("preset-grid").waitFor({ timeout: 15000 });
  const banknifty = page.locator('[data-preset-id="banknifty-short-strangle"]');
  await banknifty.waitFor({ timeout: 8000 });
  if ((await banknifty.getAttribute("data-runnable")) !== "0")
    throw new Error("BANKNIFTY preset should be locked on local data");
  // The Run control is the honest "Locked" button, not a Run link.
  await banknifty.getByTestId("preset-run-locked").waitFor({ timeout: 5000 });
  if ((await banknifty.getByTestId("preset-run").count()) !== 0)
    throw new Error("a locked preset must not expose a Run action");
});

// ── Mobile 360px ─────────────────────────────────────────────────────────
console.log("— Mobile 360px —");
await step("Explore grid + cards are clean at 360px (no horizontal overflow)", async () => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${BASE}/backtesting/explore`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("preset-grid").waitFor({ timeout: 15000 });
  await page.getByTestId("preset-card").first().waitFor({ timeout: 8000 });
  await noOverflow(page);
  // Filters are reachable on mobile too.
  await page.getByTestId("filter-index-NIFTY").click();
  await page.waitForTimeout(150);
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
