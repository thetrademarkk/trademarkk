/**
 * Feature e2e (BT-05): the backtest WORKER + useBacktest hook + BacktestStatus
 * machine, end-to-end in a real Chromium against a prod build.
 *
 * Verifies on /backtesting/build:
 *   - the "Run sample backtest" button drives the engine in a Web Worker;
 *   - status reaches `done` and the headline stats render (real engine output,
 *     not the pre-baked sample);
 *   - DETERMINISM: running twice yields the SAME Net P&L (same fixture + seed);
 *   - the golden NIFTY straddle's known Net P&L (₹+1,899.29) is surfaced;
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

// Run the sample backtest and return the rendered Net P&L string.
const runSampleAndReadPnl = async (page) => {
  await page.getByTestId("bt-run-sample").click();
  // Worker → done. The result card appears with the Net P&L stat.
  await page.getByTestId("bt-result").waitFor({ timeout: 30000 });
  await page.locator('[data-status="done"]').waitFor({ timeout: 30000 });
  const label = page
    .locator('[data-testid="bt-result"]')
    .getByText("Net P&L", { exact: true })
    .first();
  await label.waitFor({ timeout: 10000 });
  const txt = await label.locator("xpath=following-sibling::div[1]").textContent();
  return (txt ?? "").trim();
};

const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
const page = await ctx.newPage();
wireListeners(page);

console.log("— Worker run end-to-end —");
let firstPnl = "";
await step("Run sample backtest → status reaches done, headline stats render", async () => {
  await page.goto(`${BASE}/backtesting/build`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("bt-sample-runner").waitFor({ timeout: 20000 });
  // Before a run, the status reads idle/Ready.
  const initial = await page.getByTestId("bt-status").getAttribute("data-status");
  if (initial !== "idle") throw new Error(`expected idle before run, got ${initial}`);
  firstPnl = await runSampleAndReadPnl(page);
  if (!/[\d]/.test(firstPnl)) throw new Error(`Net P&L did not render a number: "${firstPnl}"`);
});

await step("the engine surfaces the golden straddle's known Net P&L (+₹1,899.29)", async () => {
  // The committed golden NIFTY 2024-07 slice + a 9:20 ATM short straddle nets
  // +1899.29 (pinned in the engine golden test). formatINR renders it grouped.
  if (!firstPnl.includes("1,899")) {
    throw new Error(`expected golden net ₹1,899.29, got "${firstPnl}"`);
  }
});

await step("DETERMINISM: a second run yields the SAME Net P&L", async () => {
  // Re-navigate (the runner lives at the layout level, but a fresh page is the
  // strictest determinism check — same fixture + seed must reproduce).
  await page.goto(`${BASE}/backtesting/build`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("bt-sample-runner").waitFor({ timeout: 20000 });
  const secondPnl = await runSampleAndReadPnl(page);
  if (secondPnl !== firstPnl) {
    throw new Error(`non-deterministic: "${firstPnl}" vs "${secondPnl}"`);
  }
});

console.log("— 360px —");
await step("the sample runner fits 360px with zero horizontal overflow", async () => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${BASE}/backtesting/build`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("bt-sample-runner").waitFor({ timeout: 20000 });
  await page.getByTestId("bt-run-sample").click();
  await page.getByTestId("bt-result").waitFor({ timeout: 30000 });
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
