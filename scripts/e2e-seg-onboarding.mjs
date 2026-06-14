/**
 * Feature e2e (SEG-08): onboarding asks the trader type, sets trade-form +
 * dashboard defaults, and seeds matching sample data.
 *
 * Verifies in a real Chromium against a running build (demo mode, no platform
 * users):
 *   - the setup step shows a clean trader-type picker (lucide icons);
 *   - picking "Swing & positional" then "Start journaling" makes the Add-trade
 *     form default to Equity + CNC (delivery);
 *   - picking "Swing & positional" then "Explore with sample data" seeds
 *     multi-day CNC equity samples and the dashboard reads a POSITIONAL style;
 *   - picking "F&O" defaults the form to Options + NRML and seeds option samples
 *     (the analytics Options tab + payoff data render);
 *   - skipping the picker (leaving the default) yields the Mixed neutral default
 *     (Equity + MIS);
 *   - the picker fits a 360px viewport with zero overflow;
 *   - zero console errors / page errors / failed requests throughout.
 *
 * Run (with the app already serving):
 *   BASE_URL=http://localhost:3500 node scripts/e2e-seg-onboarding.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3500";
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
  if (o.sw > o.cw + 1) throw new Error(`horizontal overflow ${o.sw} > ${o.cw}`);
};

/** Demo onboarding → land on the setup step (picker + form visible). */
const startDemoToSetup = async (page) => {
  await page.goto(`${BASE}/app/onboarding`, { waitUntil: "networkidle" });
  await page.getByText("Try without an account").click();
  await page.getByText("Set up your journal").waitFor({ timeout: 60000 });
  await page.getByText("What do you trade most?").waitFor({ timeout: 20000 });
};

/** Pick a trader-type card by its visible label. */
const pickType = async (page, label) => {
  await page.getByRole("button", { name: label, pressed: false }).click();
};

/** Open the Add-trade form and wait until the trader-profile default applied. */
const openTradeForm = async (page, expectedProduct) => {
  await page.getByRole("button", { name: "Add trade" }).first().click();
  await page.getByRole("heading", { name: "Add trade" }).waitFor({ timeout: 15000 });
  // The SEG-08 default is applied in an effect once the trader_profile query
  // resolves — wait for the expected product button to become pressed before
  // reading the segment, so we never race the async default.
  await page
    .getByRole("button", { name: expectedProduct, pressed: true })
    .waitFor({ timeout: 15000 });
};

/** The Segment select's displayed label, retried until it stabilises non-empty. */
const segmentValue = async (page) => {
  const trigger = page.getByRole("combobox", { name: "Segment" });
  await trigger.waitFor({ timeout: 10000 });
  for (let i = 0; i < 20; i++) {
    const txt = ((await trigger.textContent()) ?? "").trim();
    if (txt) return txt;
    await page.waitForTimeout(100);
  }
  return "";
};

// ════════════════════════════ SWING & POSITIONAL ════════════════════════════
console.log("— Swing & positional → EQ+CNC defaults + multi-day samples —");
let ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
let page = await ctx.newPage();
wireListeners(page);

await step("the setup step renders the trader-type picker", async () => {
  await startDemoToSetup(page);
  for (const label of ["Intraday equity", "Swing & positional", "F&O", "Commodity", "Currency"]) {
    if ((await page.getByRole("button", { name: label }).count()) < 1)
      throw new Error(`missing trader-type card: ${label}`);
  }
});

await step(
  "picking Swing & 'Start journaling' defaults the trade form to Equity + CNC",
  async () => {
    await pickType(page, "Swing & positional");
    await page.getByRole("button", { name: "Start journaling" }).click();
    await page.waitForURL("**/app/dashboard", { timeout: 60000 });
    await openTradeForm(page, "Delivery (CNC)");
    const seg = await segmentValue(page);
    if (!/Equity/i.test(seg)) throw new Error(`expected Equity segment default, saw: ${seg}`);
  }
);

await ctx.close();

// Fresh context: Swing + sample data → multi-day CNC samples + positional dash.
ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
page = await ctx.newPage();
wireListeners(page);

await step("picking Swing & 'Explore with sample data' seeds a positional book", async () => {
  await startDemoToSetup(page);
  await pickType(page, "Swing & positional");
  await page.getByRole("button", { name: "Explore with sample data" }).click();
  await page.waitForURL("**/app/dashboard", { timeout: 90000 });
});

await step("the dashboard reads a positional trading style", async () => {
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  const style = page.getByTestId("trading-style");
  await style.waitFor({ timeout: 30000 });
  const text = await style.innerText();
  if (!/positional/i.test(text))
    throw new Error(`expected a positional style verdict, saw: ${text}`);
});

await step("the seeded sample trades are held multi-day (no intraday bucket)", async () => {
  await page.goto(`${BASE}/app/analytics`, { waitUntil: "domcontentloaded" });
  // The "Holding period" card breaks the closed trades into horizon buckets,
  // one row per horizon (data-horizon). A pure swing/CNC book has a swing or
  // positional row and NO intraday row.
  await page.getByText("Holding period", { exact: false }).first().waitFor({ timeout: 30000 });
  await page.locator('[data-horizon="swing"], [data-horizon="positional"]').first().waitFor({
    timeout: 20000,
  });
  if ((await page.locator('[data-horizon="intraday"]').count()) > 0)
    throw new Error("swing samples must be multi-day, but an Intraday horizon bucket appeared");
});

await ctx.close();

// ════════════════════════════════════ F&O ════════════════════════════════════
console.log("— F&O → OPT+NRML defaults + option samples —");
ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
page = await ctx.newPage();
wireListeners(page);

await step(
  "picking F&O & 'Start journaling' defaults the trade form to Options + NRML",
  async () => {
    await startDemoToSetup(page);
    await pickType(page, "F&O");
    await page.getByRole("button", { name: "Start journaling" }).click();
    await page.waitForURL("**/app/dashboard", { timeout: 60000 });
    // openTradeForm waits for the NRML (derivative) product to be the pressed
    // default, confirming a derivative segment was applied; assert it's Options.
    await openTradeForm(page, "Carry-forward (NRML)");
    // OPT shows the CE / PE option-type select — a reliable proxy for Options.
    if ((await page.getByRole("combobox", { name: "Option type" }).count()) < 1)
      throw new Error("expected the OPT-only CE/PE option-type field for an F&O default");
    const seg = await segmentValue(page);
    if (!/Options/i.test(seg)) throw new Error(`expected Options segment default, saw: ${seg}`);
  }
);

await ctx.close();

ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
page = await ctx.newPage();
wireListeners(page);

await step("picking F&O & 'Explore with sample data' seeds option strategies", async () => {
  await startDemoToSetup(page);
  await pickType(page, "F&O");
  await page.getByRole("button", { name: "Explore with sample data" }).click();
  await page.waitForURL("**/app/dashboard", { timeout: 90000 });
  // The analytics Options tab renders DTE/strategy data from the seeded spreads.
  await page.goto(`${BASE}/app/analytics`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Options" }).click();
  await page
    .getByText(/DTE|strateg|expiry/i)
    .first()
    .waitFor({ timeout: 30000 });
});

await ctx.close();

// ════════════════════════════════ SKIP (MIXED) ═══════════════════════════════
console.log("— Skip the picker → Mixed default (EQ+MIS) —");
ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
page = await ctx.newPage();
wireListeners(page);

await step("not picking any type yields the Mixed neutral default (Equity + MIS)", async () => {
  await startDemoToSetup(page);
  // "A bit of everything" is the pre-selected default — don't change it.
  if ((await page.getByRole("button", { name: "A bit of everything", pressed: true }).count()) < 1)
    throw new Error("Mixed (A bit of everything) should be the default selection");
  await page.getByRole("button", { name: "Start journaling" }).click();
  await page.waitForURL("**/app/dashboard", { timeout: 60000 });
  await openTradeForm(page, "Intraday (MIS)");
  const seg = await segmentValue(page);
  if (!/Equity/i.test(seg)) throw new Error(`expected Equity segment default, saw: ${seg}`);
});

await ctx.close();

// ════════════════════════════════ 360px CLEAN ════════════════════════════════
console.log("— 360px picker —");
ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
page = await ctx.newPage();
wireListeners(page);

await step("the trader-type picker fits 360px with zero overflow", async () => {
  await startDemoToSetup(page);
  await page.getByRole("button", { name: "F&O" }).waitFor({ timeout: 20000 });
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
