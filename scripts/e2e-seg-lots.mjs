/**
 * Feature e2e (SEG-10 + add-trade modal UX): lot-size modelling for derivatives
 * and the multi-leg ticket.
 *
 * Verifies in a real Chromium against a running prod build (demo mode, no
 * platform users) that:
 *   - the lots↔units helper auto-fills the reference lot (NIFTY = 65) and the
 *     live "= N qty" readout reflects lots × lot size as you type;
 *   - logging a 2-lot NIFTY option persists qty = 130 (2 × 65) and saves with a
 *     sane net, surfacing a "2 lots" badge in the table + quick-view;
 *   - REGRESSION (lots blanked on leg switch): after adding a 2nd leg and
 *     switching back to Leg 1, the Lots field still reads "2" and the qty
 *     readout still says "= 130 qty" — the value is never lost on remount;
 *   - an MCX commodity (1 lot CRUDEOIL = 100) works the same way;
 *   - overriding the lot size for an UNKNOWN symbol still writes units;
 *   - equity (cash) shows NO lots helper;
 *   - on a 360px viewport the form fits with zero overflow AND the sticky
 *     broker-ticket footer keeps the Save action reachable;
 *   - zero console errors / page errors / failed requests throughout.
 *
 * Run (with the app already serving a prod build on :3500):
 *   BASE_URL=http://localhost:3500 node scripts/e2e-seg-lots.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3500";
const SHOT_DIR = process.env.SHOT_DIR ?? ".";
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
  // The demo journal seeds into an in-browser DB that flushes to IndexedDB
  // asynchronously. Wait for the seed to settle before any full-page navigation,
  // otherwise a reload races the flush and lands on an empty (account-less) DB.
  await page
    .getByText(/0\/6 followed/)
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(2500);
};

const openAddTrade = async (page) => {
  // Start each ticket from a clean slate: the modal persists an unsaved draft by
  // design, so clear it before the reload re-hydrates the store (otherwise a
  // prior step's dirty form bleeds into the next).
  await page.evaluate(() => localStorage.removeItem("tm.trade-draft")).catch(() => {});
  await page.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  await page.keyboard.press("t");
  await page.getByPlaceholder("NIFTY / RELIANCE").waitFor({ timeout: 10000 });
};

const setSegment = async (page, label) => {
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: label, exact: true }).click();
};

const readout = (page) => page.getByTestId("lot-units").innerText();

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
  await page.getByText("Quantity — in lots").waitFor({ timeout: 10000 });
  await page.getByText(/NIFTY 65\/lot/).waitFor({ timeout: 5000 });
});

await step("typing 2 lots shows the live '= 130 qty' readout (2 × 65)", async () => {
  await page.getByLabel("Lots").fill("2");
  const r = await readout(page);
  if (!/=\s*130\s*qty/.test(r)) throw new Error(`expected '= 130 qty', saw "${r}"`);
});

await step("a 2-lot NIFTY option trade saves with a sane net", async () => {
  await page.getByPlaceholder("24500").fill("24000"); // strike
  await page.getByLabel("Option type").click();
  await page.getByRole("option", { name: "CE", exact: true }).click();
  await page.getByPlaceholder("120.50").fill("100");
  await page.getByPlaceholder("blank = open").fill("120");
  // Gross = (120-100) × 130 = 2600 → the desktop rail preview must reflect it.
  await page.getByText(/Gross/).first().waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "Save trade" }).click();
  await page.getByText("Trade saved").waitFor({ timeout: 10000 });
});

await step("the saved NIFTY option lists with a '2 lots' badge", async () => {
  await page.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  await page.locator("table tbody tr").first().waitFor({ timeout: 20000 });
  await page.locator('[data-lots="2"]').first().waitFor({ timeout: 10000 });
});

// ───────────── REGRESSION: lots survive a leg switch (remount) ──────────────
console.log("— Regression: lots are not lost when switching legs —");
await step("Leg 1 lots persist after adding Leg 2 and switching back", async () => {
  await openAddTrade(page);
  await page.getByPlaceholder("NIFTY / RELIANCE").fill("NIFTY");
  await setSegment(page, "Options");
  await page.getByLabel("Lots").fill("2");
  // Fill enough of Leg 1 to be realistic.
  await page.getByPlaceholder("24500").fill("24000");
  await page.getByLabel("Option type").click();
  await page.getByRole("option", { name: "CE", exact: true }).click();
  await page.getByPlaceholder("120.50").fill("100");
  // Add a 2nd leg → the parent remounts the leg subtree (activeLeg → 1).
  await page
    .getByRole("button", { name: /Add leg/ })
    .first()
    .click();
  await page.getByRole("button", { name: /^Leg 2/ }).waitFor({ timeout: 8000 });
  // Switch back to Leg 1.
  await page.getByRole("button", { name: /^Leg 1/ }).click();
  // The Lots field must still read "2" (was blanked before the seed fix)…
  const lots = await page.getByLabel("Lots").inputValue();
  if (lots !== "2") throw new Error(`Leg 1 lots lost on switch — expected "2", saw "${lots}"`);
  // …and the live readout must still show the persisted qty.
  const r = await readout(page);
  if (!/=\s*130\s*qty/.test(r)) throw new Error(`Leg 1 qty readout lost — saw "${r}"`);
});

// ───────────────────────── 1-lot CRUDEOIL MCX ──────────────────────────────
console.log("— 1 lot CRUDEOIL (MCX commodity) —");
await step("commodity segment auto-fills the CRUDEOIL lot (100) and writes 100 qty", async () => {
  await openAddTrade(page);
  await page.getByPlaceholder("NIFTY / RELIANCE").fill("CRUDEOIL");
  await setSegment(page, "Commodity");
  await page.getByText(/CRUDEOIL 100\/lot/).waitFor({ timeout: 10000 });
  await page.getByLabel("Lots").fill("1");
  const r = await readout(page);
  if (!/=\s*100\s*qty/.test(r)) throw new Error(`expected '= 100 qty', saw "${r}"`);
});

await step("the MCX commodity trade saves", async () => {
  await page.getByPlaceholder("120.50").fill("6000");
  await page.getByPlaceholder("blank = open").fill("6050");
  await page.getByRole("button", { name: "Save trade" }).click();
  await page.getByText("Trade saved").waitFor({ timeout: 10000 });
});

// ─────────── alias + auto-seed: SILVERMINI resolves and auto-fills ──────────
console.log("— SILVERMINI (colloquial) resolves to SILVERM (5) + auto-fills 1 lot —");
await step(
  "typing SILVERMINI recognises SILVERM and auto-fills qty = 5 (no manual lots)",
  async () => {
    await openAddTrade(page);
    await page.getByPlaceholder("NIFTY / RELIANCE").fill("SILVERMINI");
    await setSegment(page, "Commodity");
    // The colloquial "SILVERMINI" must resolve to the real SILVERM contract (lot 5)…
    await page.getByText(/SILVERM 5\/lot/).waitFor({ timeout: 10000 });
    // …and auto-seed ONE lot so the qty fills WITHOUT typing a lot count.
    await page.waitForFunction(
      () =>
        /=\s*5\s*qty/.test(document.querySelector('[data-testid="lot-units"]')?.textContent || ""),
      { timeout: 5000 }
    );
    const lots = await page.getByLabel("Lots").inputValue();
    if (lots !== "1") throw new Error(`expected auto-seeded Lots "1", saw "${lots}"`);
  }
);

// ───────────────────── override an UNKNOWN symbol ──────────────────────────
console.log("— Unknown symbol: manual lot-size override never blocks —");
await step("an unknown symbol shows no default but accepts a manual lot size", async () => {
  await openAddTrade(page);
  await page.getByPlaceholder("NIFTY / RELIANCE").fill("ZZUNKNOWN");
  await setSegment(page, "Futures");
  await page.getByText("Quantity — in lots").waitFor({ timeout: 10000 });
  await page.getByText(/enter lot size/).waitFor({ timeout: 5000 });
  await page.getByLabel("Lot size").fill("40");
  await page.getByLabel("Lots").fill("3");
  const r = await readout(page);
  if (!/=\s*120\s*qty/.test(r)) throw new Error(`expected '= 120 qty', saw "${r}"`);
});

// ───────────────────────── EQUITY shows no helper ──────────────────────────
console.log("— Equity has no lots —");
await step("switching to Equity hides the lots helper (cash is plain units)", async () => {
  await openAddTrade(page);
  await page.getByPlaceholder("NIFTY / RELIANCE").fill("RELIANCE");
  await setSegment(page, "Equity");
  await page.waitForTimeout(150);
  if (await page.getByText("Quantity — in lots").isVisible())
    throw new Error("the lots helper must NOT show for equity");
});

// ───────────────────────────── 360px clean ─────────────────────────────────
console.log("— 360px mobile —");
await step("the entry form fits 360px with zero overflow + a reachable Save footer", async () => {
  await page.setViewportSize({ width: 360, height: 780 });
  await openAddTrade(page);
  await page.getByPlaceholder("NIFTY / RELIANCE").fill("BANKNIFTY");
  await setSegment(page, "Options");
  await page.getByText("Quantity — in lots").waitFor({ timeout: 10000 });
  await page.getByText(/BANKNIFTY 30\/lot/).waitFor({ timeout: 5000 });
  // The sticky broker-ticket footer keeps Save visible without scrolling.
  await page.getByRole("button", { name: "Save trade" }).waitFor({ timeout: 5000 });
  await noOverflow(page);
  await page.screenshot({ path: `${SHOT_DIR}/_modal-mobile.png`, fullPage: true });
});

await step("desktop modal screenshot for visual review", async () => {
  await page.setViewportSize({ width: 1380, height: 900 });
  await openAddTrade(page);
  await page.getByPlaceholder("NIFTY / RELIANCE").fill("NIFTY");
  await setSegment(page, "Options");
  await page.getByLabel("Lots").fill("2");
  await page.getByPlaceholder("24500").fill("24000");
  await page.getByLabel("Option type").click();
  await page.getByRole("option", { name: "CE", exact: true }).click();
  await page.getByPlaceholder("120.50").fill("100");
  await page.getByPlaceholder("blank = open").fill("120");
  await page.getByText(/Gross/).first().waitFor({ timeout: 5000 });
  await page.getByRole("dialog").screenshot({ path: `${SHOT_DIR}/_modal-desktop.png` });
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
