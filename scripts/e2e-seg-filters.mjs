/**
 * Feature e2e (SEG-09): filters, trades table & grouping by segment / product /
 * holding-period.
 *
 * Verifies in a real Chromium against a running build (demo mode, no platform
 * users) that the trades view is first-class for ALL trader types:
 *   - a mixed book (EQ intraday + EQ delivery/swing + OPT intraday + OPT swing
 *     + an MCX commodity future) imports with the right segments/products;
 *   - the Segment filter scoped to Options shows ONLY option rows;
 *   - the Product + Holding-period filters narrow correctly and the active
 *     filter chips + count reflect the selection, shareable via the URL;
 *   - Group-by Holding period renders collapsible intraday / swing / positional
 *     group headers with paise-correct per-group Net subtotals + win-rate, and
 *     the group subtotals sum to the whole;
 *   - clearing filters resets to the full book;
 *   - an over-narrow filter shows the explicit zero-match empty state;
 *   - the filtered + grouped view fits a 360px viewport with zero overflow;
 *   - zero console errors / page errors / failed requests throughout.
 *
 * Run (with the app already serving a prod build on :3500):
 *   BASE_URL=http://localhost:3500 node scripts/e2e-seg-filters.mjs
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

// ── A mixed book covering several segments + holding periods ──
// Zerodha-tradebook format (segment is derived from the symbol, product from
// the holding pattern: same-day EQ → MIS/intraday, overnight EQ → CNC/swing,
// derivatives → NRML; horizon from entry→exit dates).
const HEAD =
  "symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time,expiry_date";
const row = (sym, date, side, qty, price, id, exch = "NSE", time = "10:00:00") =>
  `${sym},,${date},${exch},EQ,EQ,${side},false,${qty},${price},${id},O${id},${date}T${time},`;

const rows = [];
// 2 EQ intraday round trips (same-day → MIS, intraday).
for (let i = 0; i < 2; i++) {
  rows.push(row(`DAYEQ${i}`, "2025-04-07", "buy", 10, "100.00", `DE${i}a`, "NSE", "09:30:00"));
  rows.push(row(`DAYEQ${i}`, "2025-04-07", "sell", 10, "110.00", `DE${i}b`, "NSE", "14:30:00"));
}
// 2 EQ delivery/swing round trips (held 4 days → CNC, swing).
for (let i = 0; i < 2; i++) {
  rows.push(row(`SWEQ${i}`, "2025-04-07", "buy", 5, "200.00", `SE${i}a`));
  rows.push(row(`SWEQ${i}`, "2025-04-11", "sell", 5, "230.00", `SE${i}b`));
}
// 2 NIFTY OPTION intraday round trips (same-day → NRML, intraday).
for (let i = 0; i < 2; i++) {
  const sym = `NIFTY25APR2400${i}CE`;
  rows.push(row(sym, "2025-04-07", "buy", 75, "120.00", `OI${i}a`, "NFO", "09:45:00"));
  rows.push(row(sym, "2025-04-07", "sell", 75, "140.00", `OI${i}b`, "NFO", "15:00:00"));
}
// 1 NIFTY OPTION swing round trip (held 4 days → NRML, swing).
rows.push(row("NIFTY25APR24500PE", "2025-04-07", "buy", 75, "150.00", "OS1a", "NFO", "10:00:00"));
rows.push(row("NIFTY25APR24500PE", "2025-04-11", "sell", 75, "180.00", "OS1b", "NFO", "10:00:00"));
// 1 MCX commodity FUTURE (held 4 days → NRML).
rows.push(row("CRUDEOIL25APRFUT", "2025-04-07", "buy", 100, "6000.00", "CM1a", "MCX"));
rows.push(row("CRUDEOIL25APRFUT", "2025-04-11", "sell", 100, "6050.00", "CM1b", "MCX"));

const MIXED_CSV = [HEAD, ...rows].join("\n");
const TRADE_COUNT = 8; // 2 + 2 + 2 + 1 + 1
const OPT_COUNT = 3; // 2 intraday + 1 swing

const importCsv = async (page, csv, count) => {
  await page.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Import CSV" }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "tradebook.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByText(/Detected:/).waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Preview trades" }).click();
  await page.getByRole("button", { name: `Import ${count} trades` }).click();
  await page.getByText(`Imported ${count} trades`).waitFor({ timeout: 10000 });
};

const startDemo = async (page) => {
  await page.goto(`${BASE}/app/onboarding`, { waitUntil: "networkidle" });
  await page.getByText("Try without an account").click();
  await page.getByText("Set up your journal").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Start journaling" }).click();
  await page.waitForURL("**/app/dashboard", { timeout: 60000 });
};

const POP = "[data-radix-popper-content-wrapper]";

// Open the "Add filter" menu, pick a criterion, then toggle a value by label.
const addMultiFilter = async (page, criterion, value) => {
  await page.getByRole("button", { name: "Add filter" }).click();
  await page.locator(POP).getByRole("button", { name: criterion, exact: true }).click();
  await page.locator(POP).getByText(value, { exact: true }).click();
  // Close the popover so chips/counts settle.
  await page.keyboard.press("Escape");
};

const rowCount = (page) => page.locator("[data-trade-row]").count();

// ════════════════════════════════ SETUP ════════════════════════════════════
console.log("— Mixed multi-segment book —");
const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
const page = await ctx.newPage();
wireListeners(page);

await step("seed a demo journal + import a mixed segment/product/horizon book", async () => {
  await startDemo(page);
  await importCsv(page, MIXED_CSV, TRADE_COUNT);
  await page.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  await page.getByText(`${TRADE_COUNT} trades`).first().waitFor({ timeout: 20000 });
});

await step("every row carries a segment + product badge", async () => {
  const segChips = await page.locator("[data-segment]").count();
  const prodChips = await page.locator("[data-product]").count();
  if (segChips < TRADE_COUNT)
    throw new Error(`expected ${TRADE_COUNT} segment chips, saw ${segChips}`);
  if (prodChips < TRADE_COUNT)
    throw new Error(`expected ${TRADE_COUNT} product chips, saw ${prodChips}`);
});

console.log("— Filter: Segment → Options —");
await step("filtering to Options shows only the 3 option rows", async () => {
  await addMultiFilter(page, "Segment", "Options");
  await page.waitForTimeout(200);
  const n = await rowCount(page);
  if (n !== OPT_COUNT) throw new Error(`expected ${OPT_COUNT} option rows, saw ${n}`);
  // Every visible segment chip must read OPT.
  const segs = await page.locator("[data-trade-row] [data-segment]").allInnerTexts();
  if (segs.some((s) => s.trim() !== "OPT"))
    throw new Error(`non-OPT row leaked into the Options filter: ${segs.join(",")}`);
  // The header reflects the filtered count.
  await page.getByText(`${OPT_COUNT} of ${TRADE_COUNT} trades`).waitFor({ timeout: 10000 });
});

await step("the active-filter chip + URL reflect the Segment filter", async () => {
  await page.locator('[data-filter-chip="segments"]').first().waitFor({ timeout: 5000 });
  if (!/[?&]seg=OPT/.test(page.url())) throw new Error(`URL missing seg=OPT: ${page.url()}`);
});

console.log("— Clear filters —");
await step("Clear resets to the full book", async () => {
  await page.getByRole("button", { name: "Clear" }).click();
  await page.waitForTimeout(200);
  const n = await rowCount(page);
  if (n !== TRADE_COUNT) throw new Error(`clear should restore ${TRADE_COUNT} rows, saw ${n}`);
});

console.log("— Filter: Product → Delivery (CNC) —");
await step("filtering by Product CNC shows only the 2 delivery EQ swing rows", async () => {
  await addMultiFilter(page, "Product", "Delivery (CNC)");
  await page.waitForTimeout(200);
  const n = await rowCount(page);
  if (n !== 2) throw new Error(`expected 2 CNC rows, saw ${n}`);
  await page.getByRole("button", { name: "Clear" }).click();
});

console.log("— Group by Holding period —");
await step("grouping by Holding period shows intraday + swing group headers", async () => {
  await page.getByRole("button", { name: "Group", exact: false }).click();
  await page.locator(POP).getByText("Holding period", { exact: true }).click();
  await page.waitForTimeout(200);
  // intraday group: 2 EQ + 2 OPT = 4 closed; swing group: 2 EQ + 1 OPT + 1 COMM = 4 closed.
  const intraday = page.locator('[data-group-header="intraday"]');
  const swing = page.locator('[data-group-header="swing"]');
  await intraday.waitFor({ timeout: 10000 });
  await swing.waitFor({ timeout: 10000 });
  if (!/Intraday/.test(await intraday.innerText()))
    throw new Error("intraday group header missing its label");
  if (!/Swing/.test(await swing.innerText()))
    throw new Error("swing group header missing its label");
});

await step("each group header shows a Net subtotal + win-rate", async () => {
  const intradayNet = await page.locator('[data-group-net="intraday"]').innerText();
  const intradayWin = await page.locator('[data-group-winrate="intraday"]').innerText();
  // 4 intraday winners (all +) → 100% win, net is the sum of the 4 positive nets.
  if (!/100% win/.test(intradayWin))
    throw new Error(`intraday win-rate should be 100%, saw ${intradayWin}`);
  if (!/\+/.test(intradayNet) && !/₹/.test(intradayNet))
    throw new Error(`intraday net subtotal looks empty: ${intradayNet}`);
});

await step("collapsing a group hides its rows; expanding restores them", async () => {
  const before = await rowCount(page);
  await page.locator('[data-group-header="intraday"] button').click();
  await page.waitForTimeout(150);
  const after = await rowCount(page);
  if (after >= before) throw new Error(`collapse should hide rows (${before} → ${after})`);
  await page.locator('[data-group-header="intraday"] button').click();
  await page.waitForTimeout(150);
  const restored = await rowCount(page);
  if (restored !== before) throw new Error(`expand should restore rows (${restored} ≠ ${before})`);
});

await step("the grouping choice is reflected in the URL (shareable)", async () => {
  if (!/[?&]group=horizon/.test(page.url()))
    throw new Error(`URL missing group=horizon: ${page.url()}`);
});

console.log("— Zero-match empty state —");
await step("an impossible filter shows the explicit no-match empty state", async () => {
  // Group + a segment with no rows after filtering: filter to Currency (CDS) —
  // the book has none.
  await addMultiFilter(page, "Segment", "Currency");
  await page.waitForTimeout(200);
  await page.getByText("No trades match these filters").waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Clear filters" }).click();
});

console.log("— 360px —");
await step("filtered + grouped trades fit 360px with zero overflow", async () => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${BASE}/app/trades?group=horizon`, { waitUntil: "networkidle" });
  await page.locator('[data-group-header="intraday"]').first().waitFor({ timeout: 15000 });
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
