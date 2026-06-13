/**
 * Feature e2e (BT-06): the no-code BACKTEST BUILDER — 5-node wizard, live payoff
 * rail, interactive strike ladder, and Run, end-to-end in a real Chromium
 * against a prod build (strict CSP breaks `next dev`; CSP allows worker/wasm).
 *
 * Desktop verifies:
 *   - validation BLOCKS Continue on empty legs (and allows it once a leg exists);
 *   - the always-mounted live payoff rail updates + shows breakevens + the
 *     auto-classified strategy name (Short Straddle) as legs change;
 *   - the strike ladder is keyboard-navigable (arrow keys move the selection);
 *   - Run → the RunResult headline (Net P&L) appears;
 *   - zero console errors / page errors / failed requests.
 * Mobile (360px) verifies:
 *   - the mini-payoff PEER bar is visible (not behind a tap);
 *   - the bottom-sheet preview opens.
 *
 * Run (with a PROD build serving):  BASE_URL=http://localhost:3600 node scripts/e2e-bt-builder.mjs
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

const openFresh = async (page) => {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("tmk.bt.draft.nocode");
    } catch {}
  });
  await page.goto(`${BASE}/backtesting/build`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("bt-stepper").first().waitFor({ timeout: 20000 });
};

// ── Desktop ──────────────────────────────────────────────────────────────
const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
const page = await ctx.newPage();
wireListeners(page);

console.log("— Desktop builder —");

await step("the wizard mounts at Setup with the live payoff rail present", async () => {
  await openFresh(page);
  await page.getByTestId("bt-step-setup").waitFor({ timeout: 10000 });
  // The always-mounted rail is present from step 1.
  await page.getByTestId("bt-live-rail").first().waitFor({ timeout: 10000 });
});

await step("validation BLOCKS Continue on an invalid Setup (inverted date range)", async () => {
  // Invert the date range so Setup is invalid. The Continue button reflects the
  // invalid state via aria-disabled; clicking it (validate-on-Continue) reveals
  // the inline error and never advances.
  await page.getByTestId("bt-date-from").fill("2026-06-14");
  await page.getByTestId("bt-date-to").fill("2026-01-01");
  const cont = page.getByTestId("bt-continue");
  if ((await cont.getAttribute("aria-disabled")) !== "true") {
    throw new Error("Continue was not marked invalid for an inverted range");
  }
  await cont.click({ force: true }); // force past aria-disabled to trigger the handler
  await page.getByTestId("bt-errors").waitFor({ timeout: 8000 });
  if (!(await page.getByTestId("bt-step-setup").isVisible())) {
    throw new Error("advanced past an invalid Setup step");
  }
});

await step("fixing Setup then ALLOWS Continue into Legs", async () => {
  await openFresh(page); // reset to valid defaults
  await page.getByTestId("bt-step-setup").waitFor({ timeout: 10000 });
  await page.getByTestId("bt-continue").click();
  await page.getByTestId("bt-step-legs").waitFor({ timeout: 10000 });
});

await step("live rail shows the Short Straddle label + two breakevens on the default", async () => {
  await openFresh(page);
  await page.getByTestId("bt-continue").click(); // → Legs
  await page.getByTestId("bt-step-legs").waitFor({ timeout: 10000 });
  // Default = ATM short CE + PE → Short Straddle, two breakevens.
  const label = page.getByTestId("bt-strategy-label").first();
  await label.waitFor({ timeout: 10000 });
  const labelText = (await label.textContent())?.trim();
  if (labelText !== "Short Straddle")
    throw new Error(`expected Short Straddle, got "${labelText}"`);
  const be = (await page.getByTestId("bt-breakevens").first().textContent())?.trim() ?? "";
  if (!be.includes("·")) throw new Error(`expected two breakevens, got "${be}"`);
});

await step("the strike ladder is keyboard-navigable (arrow keys move selection)", async () => {
  // Focus the first leg's ladder listbox and press ArrowRight → selection moves
  // to a higher offset rung.
  const ladder = page.locator('[role="listbox"]').first();
  await ladder.focus();
  const before = await page
    .locator("[data-rung-offset][data-selected]")
    .first()
    .getAttribute("data-rung-offset");
  await ladder.press("ArrowRight");
  const after = await page
    .locator("[data-rung-offset][data-selected]")
    .first()
    .getAttribute("data-rung-offset");
  if (Number(after) <= Number(before)) {
    throw new Error(`ladder did not advance: before=${before} after=${after}`);
  }
  // Recentre to ATM so the run stays a clean straddle.
  await ladder.press("0");
});

await step("Run from Review surfaces a RunResult Net P&L headline", async () => {
  await openFresh(page);
  for (let i = 0; i < 4; i++) await page.getByTestId("bt-continue").click();
  await page.getByTestId("bt-step-review").waitFor({ timeout: 10000 });
  await page.getByTestId("bt-run").click();
  await page.getByTestId("bt-result").waitFor({ timeout: 30000 });
  await page.locator('[data-status="done"]').waitFor({ timeout: 30000 });
  const pnl = page
    .locator('[data-testid="bt-result"]')
    .getByText("Net P&L", { exact: true })
    .first();
  await pnl.waitFor({ timeout: 10000 });
  const txt = (await pnl.locator("xpath=following-sibling::div[1]").textContent())?.trim() ?? "";
  if (!/[\d]/.test(txt)) throw new Error(`Net P&L did not render a number: "${txt}"`);
});

// ── Mobile 360px ─────────────────────────────────────────────────────────
console.log("— Mobile 360px —");
await step("the mini-payoff PEER bar is visible (not behind a tap) + sheet opens", async () => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openFresh(page);
  await page.getByTestId("bt-continue").click(); // → Legs (so a payoff exists)
  await page.getByTestId("bt-step-legs").waitFor({ timeout: 10000 });
  const mini = page.getByTestId("bt-mobile-payoff");
  await mini.waitFor({ timeout: 10000 });
  if (!(await mini.isVisible())) throw new Error("mobile mini-payoff PEER bar is not visible");
  // The sparkline is a peer element, always present (not behind the tap).
  await page.getByTestId("bt-mini-sparkline").waitFor({ timeout: 5000 });
  await noOverflow(page);
  // Open the bottom-sheet preview.
  await page.getByTestId("bt-mobile-preview-open").click();
  await page.locator('[data-testid="bt-live-rail"]').last().waitFor({ timeout: 8000 });
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
