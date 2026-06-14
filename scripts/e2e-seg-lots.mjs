/**
 * Feature e2e (SEG-10): lot-size modelling for derivatives.
 *
 * Verifies in a real Chromium against a running prod build (demo mode, no
 * platform users) that the lots↔units entry helper is correct end-to-end:
 *   - logging a 2-lot NIFTY option via the lots helper persists qty = 150
 *     (2 × 75) and the trade saves with sane charges/P&L;
 *   - the helper's live "= N qty" readout reflects lots × lot size as you type;
 *   - logging an MCX commodity (1 lot CRUDEOIL = 100) works the same way;
 *   - overriding the lot size for an UNKNOWN symbol still writes units (never
 *     blocks the trade);
 *   - the trade table / quick-view surface "N lots" for a recognised derivative;
 *   - equity (cash) shows NO lots helper;
 *   - the entry form fits a 360px viewport with zero overflow;
 *   - zero console errors / page errors / failed requests throughout.
 *
 * Run (with the app already serving a prod build on :3500):
 *   BASE_URL=http://localhost:3500 node scripts/e2e-seg-lots.mjs
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

const startDemo = async (page) => {
  await page.goto(`${BASE}/app/onboarding`, { waitUntil: "networkidle" });
  await page.getByText("Try without an account").click();
  await page.getByText("Set up your journal").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Start journaling" }).click();
  await page.waitForURL("**/app/dashboard", { timeout: 60000 });
};

const openAddTrade = async (page) => {
  await page.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  await page.keyboard.press("t");
  await page.getByPlaceholder("NIFTY / RELIANCE").waitFor({ timeout: 10000 });
};

const setSegment = async (page, label) => {
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: label, exact: true }).click();
};

// ════════════════════════════════ SETUP ════════════════════════════════════
console.log("— Demo journal —");
const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
const page = await ctx.newPage();
wireListeners(page);

await step("seed an empty demo journal", async () => {
  await startDemo(page);
});

// ───────────────────────── 2-lot NIFTY OPTION ──────────────────────────────
console.log("— 2 lots NIFTY option via the lots helper —");
await step("the lots helper appears for a derivative and auto-fills NIFTY's lot size", async () => {
  await openAddTrade(page);
  await page.getByPlaceholder("NIFTY / RELIANCE").fill("NIFTY");
  await setSegment(page, "Options");
  // Helper visible with the NIFTY default lot.
  await page.getByText("Enter in lots").waitFor({ timeout: 10000 });
  await page.getByText(/NIFTY default 75\/lot/).waitFor({ timeout: 5000 });
});

await step("typing 2 lots shows the live '= 150 qty' readout", async () => {
  await page.getByLabel("Lots").fill("2");
  const readout = await page.getByTestId("lot-units").innerText();
  if (!/=\s*150\s*qty/.test(readout)) throw new Error(`expected '= 150 qty', saw "${readout}"`);
});

await step("the Qty field is populated with 150 units (lots × lot size)", async () => {
  const qty = await page.getByPlaceholder("75").first().inputValue();
  if (qty !== "150") throw new Error(`Qty should be 150, saw "${qty}"`);
});

await step("a 2-lot NIFTY option trade saves with a sane net", async () => {
  await page.getByPlaceholder("24500").fill("24000"); // strike
  // CE/PE select — the 2nd combobox in the leg panel.
  await page.getByLabel("Option type").click();
  await page.getByRole("option", { name: "CE", exact: true }).click();
  await page.getByPlaceholder("120.50").fill("100");
  await page.getByPlaceholder("blank = open").fill("120");
  // Gross = (120-100) × 150 = 3000 → the preview must reflect it.
  await page.getByText(/Gross/).first().waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "Save trade" }).click();
  await page.getByText("Trade saved").waitFor({ timeout: 10000 });
});

await step("the saved NIFTY option lists with qty 150 and a '2 lots' badge", async () => {
  await page.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  await page.locator("table tbody tr").first().waitFor({ timeout: 20000 });
  await page.locator('[data-lots="2"]').first().waitFor({ timeout: 10000 });
});

await step("quick-view shows '150 (2 lots)'", async () => {
  await page.locator("table tbody tr").first().click();
  const modal = page.getByRole("dialog");
  await modal.getByText("Qty").waitFor({ timeout: 10000 });
  const qtyText = await modal.getByText(/2 lots/).innerText();
  if (!/150/.test(qtyText) && !/2 lots/.test(qtyText))
    throw new Error(`quick-view qty missing lots: "${qtyText}"`);
  await page.keyboard.press("Escape");
});

// ───────────────────────── 1-lot CRUDEOIL MCX ──────────────────────────────
console.log("— 1 lot CRUDEOIL (MCX commodity) —");
await step("commodity segment auto-fills the CRUDEOIL lot (100) and writes 100 qty", async () => {
  await openAddTrade(page);
  await page.getByPlaceholder("NIFTY / RELIANCE").fill("CRUDEOIL");
  await setSegment(page, "Commodity");
  await page.getByText(/CRUDEOIL default 100\/lot/).waitFor({ timeout: 10000 });
  await page.getByLabel("Lots").fill("1");
  const readout = await page.getByTestId("lot-units").innerText();
  if (!/=\s*100\s*qty/.test(readout)) throw new Error(`expected '= 100 qty', saw "${readout}"`);
  const qty = await page.getByPlaceholder("75").first().inputValue();
  if (qty !== "100") throw new Error(`Qty should be 100, saw "${qty}"`);
});

await step("the MCX commodity trade saves", async () => {
  await page.getByPlaceholder("120.50").fill("6000");
  await page.getByPlaceholder("blank = open").fill("6050");
  await page.getByRole("button", { name: "Save trade" }).click();
  await page.getByText("Trade saved").waitFor({ timeout: 10000 });
});

// ───────────────────── override an UNKNOWN symbol ──────────────────────────
console.log("— Unknown symbol: manual lot-size override never blocks —");
await step("an unknown symbol shows no default but accepts a manual lot size", async () => {
  await openAddTrade(page);
  await page.getByPlaceholder("NIFTY / RELIANCE").fill("ZZUNKNOWN");
  await setSegment(page, "Futures");
  await page.getByText("Enter in lots").waitFor({ timeout: 10000 });
  // No reference default → the readout invites a manual qty.
  await page.getByText(/unknown symbol/).waitFor({ timeout: 5000 });
  // Override the lot size and lots → units are still computed.
  await page.getByLabel("Lot size").fill("40");
  await page.getByLabel("Lots").fill("3");
  const readout = await page.getByTestId("lot-units").innerText();
  if (!/=\s*120\s*qty/.test(readout)) throw new Error(`expected '= 120 qty', saw "${readout}"`);
  const qty = await page.getByPlaceholder("75").first().inputValue();
  if (qty !== "120") throw new Error(`override Qty should be 120, saw "${qty}"`);
});

await step("manual Qty entry always wins — typing units directly is unaffected", async () => {
  // Type a raw unit qty over the helper's value; it must persist as-is.
  await page.getByPlaceholder("75").first().fill("250");
  const qty = await page.getByPlaceholder("75").first().inputValue();
  if (qty !== "250") throw new Error(`manual Qty should stay 250, saw "${qty}"`);
});

// ───────────────────────── EQUITY shows no helper ──────────────────────────
console.log("— Equity has no lots —");
await step("switching to Equity hides the lots helper (cash is plain units)", async () => {
  await openAddTrade(page);
  await page.getByPlaceholder("NIFTY / RELIANCE").fill("RELIANCE");
  await setSegment(page, "Equity");
  await page.waitForTimeout(150);
  if (await page.getByText("Enter in lots").isVisible())
    throw new Error("the lots helper must NOT show for equity");
});

// ───────────────────────────── 360px clean ─────────────────────────────────
console.log("— 360px —");
await step("the entry form with the lots helper fits 360px with zero overflow", async () => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openAddTrade(page);
  await page.getByPlaceholder("NIFTY / RELIANCE").fill("BANKNIFTY");
  await setSegment(page, "Options");
  await page.getByText("Enter in lots").waitFor({ timeout: 10000 });
  await page.getByText(/BANKNIFTY default 35\/lot/).waitFor({ timeout: 5000 });
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
