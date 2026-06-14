/**
 * Feature e2e (BT-11): the ROBUSTNESS / WALK-FORWARD tab — the honesty rigor
 * layer on top of the BT-07 results. Runs in real Chromium against a PROD build
 * (strict CSP breaks `next dev`; CSP allows worker/wasm). Two surfaces:
 *
 *   A) POPULATED path (engine-free, deterministic): the landing's pre-baked
 *      ~60-trade-day sample → "Explore the full sample report" → Robustness tab.
 *      Asserts the two-color IS/OOS curve, the per-window table, the MC outcome
 *      distribution, and the deflated-Sharpe caution all RENDER populated.
 *
 *   B) LOW-SAMPLE honest path: the golden NIFTY 9:20 straddle (2 trade-days) via
 *      the BT-06 builder → Robustness tab → asserts every honest "not enough
 *      data / coverage" note appears instead of a fabricated split/cone.
 *
 *   + determinism: re-mounting the populated tab yields the SAME MC percentiles.
 *   + 360px clean, zero console errors / page errors / failed requests.
 *
 * Run (with a PROD build already serving):
 *   BASE_URL=http://localhost:3600 node scripts/e2e-bt-walkforward.mjs
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

const openFullSampleRobustness = async (page) => {
  await page.goto(`${BASE}/backtesting`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("bt-sample-full-toggle").click();
  await page.getByTestId("bt-sample-full-report").waitFor({ timeout: 15000 });
  await page.getByTestId("bt-tab-robustness").click();
  await page.getByTestId("bt-robustness-tab").waitFor({ timeout: 10000 });
};

const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
const page = await ctx.newPage();
wireListeners(page);

console.log("— Robustness tab · POPULATED (pre-baked sample, engine-free) —");

await step("the Robustness tab is reachable from the full sample report", async () => {
  await openFullSampleRobustness(page);
});

await step(
  "walk-forward two-color IS/OOS curve renders with a plain-language summary",
  async () => {
    await page.getByTestId("bt-wf-curve").waitFor({ timeout: 8000 });
    const summary = (await page.getByTestId("bt-wf-summary").textContent())?.toLowerCase() ?? "";
    if (!summary.includes("out-of-sample"))
      throw new Error(`wf summary not descriptive: "${summary}"`);
    // DESCRIPTIVE, never evaluative.
    for (const banned of [
      "good strategy",
      "profitable strategy",
      "great",
      "winner",
      " buy ",
      " sell ",
    ]) {
      if (summary.includes(banned)) throw new Error(`wf summary is evaluative: "${banned}"`);
    }
  }
);

await step("the per-window table renders at least one fold row", async () => {
  await page.getByTestId("bt-wf-table").waitFor({ timeout: 8000 });
  const rows = await page.locator("[data-wf-fold]").count();
  if (rows < 1) throw new Error("no walk-forward fold rows");
});

await step("the Monte-Carlo outcome distribution renders (cone + percentile tiles)", async () => {
  await page.getByTestId("bt-mc-distribution").waitFor({ timeout: 8000 });
  await page.getByTestId("equity-cone").first().waitFor({ timeout: 8000 });
  const tiles = await page.locator('[data-testid="bt-mc-distribution"] > div').count();
  if (tiles < 4) throw new Error(`expected 4 outcome tiles, got ${tiles}`);
});

await step(
  "the deflated-Sharpe overfitting caution renders (descriptive, cites the concept)",
  async () => {
    const card = page.getByTestId("bt-coach-card");
    await card.waitFor({ timeout: 8000 });
    const txt = (await card.textContent())?.toLowerCase() ?? "";
    if (!txt.includes("deflated sharpe")) throw new Error("coach does not cite the concept");
    if (!txt.includes("educational caution") && !txt.includes("not a recommendation"))
      throw new Error("coach not framed as educational");
    // Evaluative/advice phrasing must NOT appear (note: "not a recommendation" is
    // the honest disclaimer, so we match advice VERBS, not the word "recommend").
    for (const banned of [
      "buy this",
      "sell this",
      "you should trade",
      "we recommend",
      "recommend trading",
    ]) {
      if (txt.includes(banned)) throw new Error(`coach is evaluative: "${banned}"`);
    }
  }
);

await step("determinism: re-mounting the tab yields identical MC percentile tiles", async () => {
  const read = async () => page.locator('[data-testid="bt-mc-distribution"] dd').allTextContents();
  const first = await read();
  // Switch away and back → the lazy tab re-mounts and recomputes from the same seed.
  await page.getByTestId("bt-tab-returns").click();
  await page.getByTestId("bt-returns-tab").waitFor({ timeout: 8000 });
  await page.getByTestId("bt-tab-robustness").click();
  await page.getByTestId("bt-mc-distribution").waitFor({ timeout: 8000 });
  const second = await read();
  if (JSON.stringify(first) !== JSON.stringify(second))
    throw new Error(
      `MC percentiles not deterministic: ${JSON.stringify(first)} vs ${JSON.stringify(second)}`
    );
});

console.log("— Robustness tab · LOW-SAMPLE honest path (golden 2-day run) —");

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
};

await step(
  "golden run → Robustness tab shows the honest low-sample notes (no fabrication)",
  async () => {
    await freshBuild(page);
    await runGolden(page);
    await page.getByTestId("bt-tab-robustness").click();
    await page.getByTestId("bt-robustness-tab").waitFor({ timeout: 8000 });
    // 2 trade-days: walk-forward and MC both fall below their gates.
    await page.getByTestId("bt-wf-lowsample").waitFor({ timeout: 8000 });
    await page.getByTestId("bt-mc-lowsample").waitFor({ timeout: 8000 });
    // The MC honest note states MIN_TRADES isn't met.
    const mc = (await page.getByTestId("bt-mc-lowsample").textContent()) ?? "";
    if (!/too few trades to be meaningful/i.test(mc))
      throw new Error(`MC low-sample note missing the honest phrasing: "${mc}"`);
    // The deflated-Sharpe caution still renders (insufficient sample).
    const coach = page.getByTestId("bt-coach-card");
    await coach.waitFor({ timeout: 8000 });
    if ((await coach.getAttribute("data-caution")) !== "insufficient")
      throw new Error("coach should be 'insufficient' on a 2-day run");
  }
);

console.log("— 360px —");
await step("the Robustness tab fits 360px with zero horizontal overflow (populated)", async () => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openFullSampleRobustness(page);
  await page.getByTestId("bt-wf-curve").waitFor({ timeout: 8000 });
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
