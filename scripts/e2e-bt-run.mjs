/**
 * Feature e2e (BT-05 worker proof, driven through the BT-06 builder): the
 * backtest WORKER + useBacktest hook + BacktestStatus machine, end-to-end in a
 * real Chromium against a prod build.
 *
 * The builder's default draft is a NIFTY 9:20 ATM short straddle; "Run backtest"
 * on the Review step adapts it onto the committed golden NIFTY 2024-07 slice and
 * drives the layout-owned worker. Verifies:
 *   - status reaches `done` and the headline stats render (real engine output);
 *   - DETERMINISM: running twice yields the SAME Net P&L (same fixture + seed);
 *   - the golden NIFTY straddle's known Net P&L (+₹1,899.29) is surfaced;
 *   - zero console errors / page errors / failed requests;
 *   - the runner fits a 360px viewport with zero horizontal overflow.
 *
 * Run (with a PROD build already serving — strict CSP breaks `next dev`):
 *   BASE_URL=http://localhost:3600 node scripts/e2e-bt-run.mjs
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

// Reset any persisted draft so we always start from the default straddle.
const freshBuild = async (page) => {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("tmk.bt.draft.nocode");
    } catch {}
  });
  await page.goto(`${BASE}/backtesting/build`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("bt-stepper").first().waitFor({ timeout: 20000 });
};

// Walk Setup → Legs → Timing → Risk → Review, then Run, returning the Net P&L.
const buildAndRun = async (page) => {
  // Default draft already has 2 legs, so each Continue is valid.
  for (let i = 0; i < 4; i++) {
    await page.getByTestId("bt-continue").click();
  }
  await page.getByTestId("bt-step-review").waitFor({ timeout: 10000 });
  await page.getByTestId("bt-run").click();
  await page.getByTestId("bt-result").waitFor({ timeout: 30000 });
  await page.locator('[data-status="done"]').waitFor({ timeout: 30000 });
  // The full BT-07 results UI renders; the Net P&L stat card carries the value.
  await page.getByTestId("bt-results-done").waitFor({ timeout: 30000 });
  const tile = page.locator('[data-stat-key="netPnl"]').first();
  await tile.waitFor({ timeout: 10000 });
  const txt = await tile.locator(".font-money").first().textContent();
  return (txt ?? "").trim();
};

const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
const page = await ctx.newPage();
wireListeners(page);

console.log("— Worker run end-to-end (via builder) —");
let firstPnl = "";
await step("Run the built straddle → status reaches done, headline stats render", async () => {
  await freshBuild(page);
  firstPnl = await buildAndRun(page);
  if (!/[\d]/.test(firstPnl)) throw new Error(`Net P&L did not render a number: "${firstPnl}"`);
});

await step("the engine surfaces the golden straddle's known Net P&L (+₹1,899.29)", async () => {
  if (!firstPnl.includes("1,899")) {
    throw new Error(`expected golden net ₹1,899.29, got "${firstPnl}"`);
  }
});

await step("DETERMINISM: a second run yields the SAME Net P&L", async () => {
  await freshBuild(page);
  const secondPnl = await buildAndRun(page);
  if (secondPnl !== firstPnl) {
    throw new Error(`non-deterministic: "${firstPnl}" vs "${secondPnl}"`);
  }
});

console.log("— 360px —");
await step("the builder + run fit 360px with zero horizontal overflow", async () => {
  await page.setViewportSize({ width: 360, height: 800 });
  await freshBuild(page);
  await noOverflow(page);
  await buildAndRun(page);
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
