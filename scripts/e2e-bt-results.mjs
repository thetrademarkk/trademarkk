/**
 * Feature e2e (BT-07): the RESULTS UI — verdict → evidence → drill-down. Drives
 * the golden NIFTY 9:20 ATM short straddle through the BT-06 builder, then asserts
 * the full results surface end-to-end in a real Chromium against a PROD build
 * (strict CSP breaks `next dev`; CSP allows worker/wasm).
 *
 * Verifies:
 *   - the 6 stat cards render in the R24 lead order;
 *   - Net P&L surfaces the golden +₹1,899.29;
 *   - the verdict headline is NEUTRAL (no "good"/"profitable strategy" language);
 *   - tap Net P&L → the charges breakdown closes to the net (gross − charges = net);
 *   - the coverage / quality chips render;
 *   - switch to Returns → the monthly heatmap lazy-mounts with a hatched no-data cell;
 *   - switch to Risk → the lazy content mounts (cone or honest low-sample note);
 *   - open a blotter row → the trade-quick-view modal opens;
 *   - 360px clean with zero horizontal overflow;
 *   - zero console errors / page errors / failed requests.
 *
 * Run (with a PROD build already serving):
 *   BASE_URL=http://localhost:3600 node scripts/e2e-bt-results.mjs
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

const freshBuild = async (page) => {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("tmk.bt.draft.nocode");
      localStorage.removeItem("tmk.bt.prevrun");
    } catch {}
  });
  await page.goto(`${BASE}/backtesting/build`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("bt-stepper").first().waitFor({ timeout: 20000 });
};

const runGolden = async (page) => {
  for (let i = 0; i < 4; i++) await page.getByTestId("bt-continue").click();
  await page.getByTestId("bt-step-review").waitFor({ timeout: 10000 });
  await page.getByTestId("bt-run").click();
  await page.getByTestId("bt-results-done").waitFor({ timeout: 30000 });
  await page.locator('[data-status="done"]').waitFor({ timeout: 30000 });
};

const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
const page = await ctx.newPage();
wireListeners(page);

console.log("— Results UI (desktop) —");

await step("the 6 stat cards render in the R24 lead order", async () => {
  await freshBuild(page);
  await runGolden(page);
  const keys = await page
    .locator("[data-stat-key]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-stat-key")));
  const expected = ["netPnl", "winRate", "maxDrawdown", "expectancy", "profitFactor", "sharpe"];
  if (JSON.stringify(keys.slice(0, 6)) !== JSON.stringify(expected)) {
    throw new Error(`stat order ${JSON.stringify(keys)}`);
  }
});

await step("Net P&L surfaces the golden +₹1,899.29", async () => {
  const tile = page.locator('[data-stat-key="netPnl"]').first();
  const txt = (await tile.locator(".font-money").first().textContent())?.trim() ?? "";
  if (!txt.includes("1,899.29")) throw new Error(`expected +₹1,899.29, got "${txt}"`);
});

await step("the verdict headline is NEUTRAL (not evaluative)", async () => {
  const h = (await page.getByTestId("bt-verdict-headline").textContent())?.toLowerCase() ?? "";
  if (!h.includes("net p&l")) throw new Error(`headline missing the descriptive core: "${h}"`);
  for (const banned of ["good strategy", "profitable strategy", "great", "winner", "strong"]) {
    if (h.includes(banned)) throw new Error(`headline is evaluative: contains "${banned}"`);
  }
});

await step("coverage / quality chips render", async () => {
  await page.getByTestId("bt-quality-chips").waitFor({ timeout: 8000 });
  const chips = await page.locator("[data-chip-kind]").count();
  if (chips < 1) throw new Error("no quality chips rendered");
});

await step("tap Net P&L → charges breakdown sums to net (gross − charges = net)", async () => {
  await page.getByTestId("bt-stat-netPnl").click();
  await page.getByTestId("bt-charges-waterfall").waitFor({ timeout: 8000 });
  const rows = await page
    .locator('[data-testid="bt-charges-waterfall"] dl > div')
    .evaluateAll((els) =>
      els.map((e) => {
        const dt = e.querySelector("dt")?.textContent?.trim() ?? "";
        const dd = e.querySelector("dd")?.textContent?.trim() ?? "";
        return { dt, dd };
      })
    );
  const grossRow = rows.find((r) => r.dt.startsWith("Gross"));
  const netRow = rows.find((r) => r.dt === "Net P&L");
  if (!grossRow || !netRow) throw new Error("missing gross / net rows");
  const gross = Number(grossRow.dd.replace(/[^0-9.-]/g, ""));
  const net = Number(netRow.dd.replace(/[^0-9.-]/g, ""));
  const deductions = rows
    .filter((r) => r !== grossRow && r !== netRow)
    .reduce((s, r) => s + Number(r.dd.replace(/[^0-9.-]/g, "")), 0); // each already negative
  const recomputed = Math.round((gross + deductions) * 100) / 100;
  if (Math.abs(recomputed - net) > 0.01) {
    throw new Error(
      `waterfall does not close: gross ${gross} + deductions ${deductions} = ${recomputed} != net ${net}`
    );
  }
  if (Math.abs(net - 1899.29) > 0.01) throw new Error(`net should be 1899.29, got ${net}`);
});

await step("Returns tab lazy-mounts the monthly heatmap with a hatched no-data cell", async () => {
  await page.getByTestId("bt-tab-returns").click();
  await page.getByTestId("bt-returns-tab").waitFor({ timeout: 8000 });
  // The golden run is a 2-day July slice → most months have no data → hatched.
  const hatched = await page.locator('[data-no-data="true"]').count();
  if (hatched < 1) throw new Error("expected at least one hatched no-data month cell");
});

await step("Risk tab lazy-mounts (cone or honest low-sample note)", async () => {
  await page.getByTestId("bt-tab-risk").click();
  await page.getByTestId("bt-risk-tab").waitFor({ timeout: 8000 });
  // 2 trade-days < MIN_TRADES(30) → the honest low-sample note, not a fake cone.
  await page.getByTestId("bt-cone-lowsample").waitFor({ timeout: 8000 });
});

await step("open a blotter row → the trade-quick-view modal opens", async () => {
  // Scroll the blotter into view and click the first row.
  await page.getByTestId("bt-blotter").scrollIntoViewIfNeeded();
  await page.locator("[data-row-day]").first().click();
  await page.getByTestId("bt-trade-quick-view").waitFor({ timeout: 8000 });
  await page.keyboard.press("Escape");
});

console.log("— 360px —");
await step("the results UI fits 360px with zero horizontal overflow", async () => {
  await page.setViewportSize({ width: 360, height: 800 });
  await freshBuild(page);
  await runGolden(page);
  await noOverflow(page);
  // Tap-to-derive still works on mobile.
  await page.getByTestId("bt-stat-netPnl").click();
  await page.getByTestId("bt-charges-waterfall").waitFor({ timeout: 8000 });
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
