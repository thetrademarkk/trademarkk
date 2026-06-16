/**
 * LIVE backtest e2e (BT-08 data layer): proves the no-code builder runs the
 * user's ACTUAL strategy against the REAL HuggingFace 1-minute dataset via
 * duckdb-wasm — NOT the golden fixture. This is the end-to-end unlock proof:
 *
 *   - duckdb-wasm boots SAME-ORIGIN (the /duckdb/ self-hosted bundle), so the
 *     strict CSP `worker-src 'self' blob:` does NOT block the worker — the whole
 *     point of self-hosting instead of jsDelivr;
 *   - the engine issues real range reads to huggingface.co/datasets/.../resolve/
 *     main/... (302 → cas-bridge CDN 206) — captured from the network log;
 *   - the run reaches an HONEST terminal state: `done` with real engine stats
 *     when the window has data, or `empty` when it doesn't — never a crash and
 *     never the fixture's +₹1,899.29;
 *   - zero console errors (esp. NO CSP worker-src violation), zero page errors.
 *
 * Run (PROD build serving — strict CSP breaks `next dev`):
 *   BASE_URL=http://localhost:3217 node scripts/e2e-bt-live.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3217";
const issues = [];
const hfReads = [];
const cspErrors = [];
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
    issues.push(`[step] ${name} :: ${String(e.message).slice(0, 300)}`);
    console.log(`  FAIL ${name}: ${String(e.message).slice(0, 300)}`);
  }
};

const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
const page = await ctx.newPage();

page.on("console", (m) => {
  const t = m.text();
  if (/Content Security Policy|worker-src|Refused to create a worker/i.test(t)) {
    cspErrors.push(t.slice(0, 250));
  }
  if (m.type() === "error") issues.push(`[console] ${t.slice(0, 250)}`);
});
page.on("pageerror", (e) => issues.push(`[pageerror] ${String(e.message).slice(0, 250)}`));
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("huggingface.co") || u.includes("xethub.hf.co") || u.includes("cas-bridge")) {
    hfReads.push(u.slice(0, 120));
  }
});
page.on("response", (r) => {
  if (r.status() >= 400 && !r.url().includes("favicon"))
    issues.push(`[http ${r.status()}] ${r.url()}`);
});

const freshBuild = async () => {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("tmk.bt.draft.nocode");
    } catch {}
  });
  await page.goto(`${BASE}/backtesting/build`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("bt-stepper").first().waitFor({ timeout: 20000 });
};

console.log("— LIVE HF backtest end-to-end —");
let finalStatus = "";
let netPnl = "";

await step(
  "walk builder → Run → reach an honest terminal state (done|empty), not a crash",
  async () => {
    await freshBuild();
    for (let i = 0; i < 4; i++) {
      await page.getByTestId("bt-continue").click();
    }
    await page.getByTestId("bt-step-review").waitFor({ timeout: 10000 });
    await page.getByTestId("bt-run").click();
    await page.getByTestId("bt-result").waitFor({ timeout: 30000 });

    // duckdb-wasm boot + HF reads + engine can take a while on a cold worker. Poll
    // the status attribute directly (resilient) rather than page.waitForFunction,
    // whose injected rAF poller can reject mid-run while the heavy worker churns.
    const statusEl = page.getByTestId("bt-status");
    const terminal = new Set(["done", "empty", "error"]);
    for (let i = 0; i < 90; i++) {
      finalStatus = (await statusEl.getAttribute("data-status").catch(() => "")) ?? "";
      if (terminal.has(finalStatus)) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (finalStatus === "error") throw new Error(`run errored (not honest empty/done)`);
    if (finalStatus !== "done" && finalStatus !== "empty") {
      throw new Error(`run did not reach a terminal state in time: "${finalStatus}"`);
    }
    if (finalStatus === "done") {
      const tile = page.locator('[data-stat-key="netPnl"]').first();
      await tile.waitFor({ timeout: 10000 }).catch(() => {});
      netPnl = (
        (await tile
          .locator(".font-money")
          .first()
          .textContent()
          .catch(() => "")) ?? ""
      ).trim();
    }
    console.log(`     → terminal status: ${finalStatus}${netPnl ? `, Net P&L ${netPnl}` : ""}`);
  }
);

await step("duckdb-wasm booted SAME-ORIGIN (no CSP worker-src violation)", async () => {
  if (cspErrors.length) throw new Error(`CSP worker errors: ${cspErrors.join(" | ")}`);
});

await step("engine issued REAL HuggingFace range reads (not the fixture)", async () => {
  if (hfReads.length === 0) {
    throw new Error("no huggingface.co / xethub reads observed — fixture path or no data fetch");
  }
  console.log(`     → ${hfReads.length} HF requests, e.g. ${hfReads[0]}`);
});

await step("the result is NOT the golden fixture's +₹1,899.29", async () => {
  if (netPnl.includes("1,899")) throw new Error(`got the FIXTURE net — live path not wired`);
});

await ctx.close();
await browser.close();

console.log(`\n${passed} passed, ${failed} failed`);
if (issues.length) {
  console.log(`\n— ${issues.length} issue(s) —`);
  for (const i of [...new Set(issues)]) console.log("  " + i);
  process.exit(1);
} else {
  console.log("\nLive HF backtest verified end-to-end. ✅");
}
