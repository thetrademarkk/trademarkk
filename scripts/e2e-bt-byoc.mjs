/**
 * BYOC e2e: the bring-your-own-code studio runs a real JavaScript strategy in the
 * QuickJS-WASM sandbox against LIVE HF 1-minute data, in a prod build + Chromium.
 * Verifies the default SMA-crossover template reaches a `done` result with stats,
 * with zero CSP violations (the whole point — QuickJS runs under `wasm-unsafe-eval`
 * without `unsafe-eval`) and zero page errors.
 *
 *   BASE_URL=http://localhost:3217 node scripts/e2e-bt-byoc.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3217";
const issues = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on("console", (m) => {
  const t = m.text();
  if (/Content Security Policy|unsafe-eval|Refused to/i.test(t))
    issues.push(`[CSP] ${t.slice(0, 200)}`);
  else if (m.type() === "error") issues.push(`[console] ${t.slice(0, 200)}`);
});
page.on("pageerror", (e) => issues.push(`[pageerror] ${String(e.message).slice(0, 200)}`));
page.on("response", (r) => {
  if (r.status() >= 400 && !r.url().includes("favicon"))
    issues.push(`[http ${r.status()}] ${r.url().slice(0, 90)}`);
});

let passed = 0;
let failed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}: ${String(e.message).slice(0, 240)}`);
  }
};

console.log("— BYOC studio end-to-end —");
await step("default JS strategy runs in the sandbox → done with stats", async () => {
  await page.goto(`${BASE}/backtesting/code`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("byoc-code").waitFor({ timeout: 20000 });
  await page.getByTestId("byoc-run").click();
  await page
    .waitForFunction(
      () => {
        const s = document
          .querySelector('[data-testid="byoc-result"]')
          ?.getAttribute("data-status");
        return s === "done" || s === "error";
      },
      { timeout: 90000 }
    )
    .catch(() => {});
  const status = await page.getByTestId("byoc-result").getAttribute("data-status");
  if (status !== "done") {
    const txt = await page
      .getByTestId("byoc-result")
      .innerText()
      .catch(() => "");
    throw new Error(`status=${status}: ${txt.slice(0, 160)}`);
  }
  await page.getByTestId("byoc-done").waitFor({ timeout: 5000 });
});

await step("no CSP violations / page errors (QuickJS under wasm-unsafe-eval)", async () => {
  const csp = issues.filter((i) => i.startsWith("[CSP]") || i.startsWith("[pageerror]"));
  if (csp.length) throw new Error(csp.join(" | "));
});

await ctx.close();
await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
if (issues.length) {
  console.log(`— ${issues.length} issue(s) —`);
  for (const i of [...new Set(issues)]) console.log("  " + i);
}
process.exit(failed > 0 ? 1 : 0);
