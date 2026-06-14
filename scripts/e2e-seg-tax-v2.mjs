/**
 * Feature e2e (SEG-07): Tax pack v2 — three-way income classification with the
 * capital-gains (STCG / LTCG) path.
 *
 * Verifies in a real Chromium against a running build (demo mode, no platform
 * users) that the Reports → Tax & charges tab:
 *   - classifies into THREE heads: speculative (intraday EQ), non-speculative
 *     business (F&O), and capital gains (delivery EQ);
 *   - splits realised delivery-equity capital gains into STCG (held ≤ 12 months)
 *     and LTCG (held > 12 months) correctly;
 *   - shows the ₹1.25L LTCG exemption note + the STCG 20% / LTCG 12.5% rate
 *     labels + the "not tax advice — verify with a CA" disclaimer;
 *   - excludes open (unrealised) delivery positions;
 *   - the CSV export carries the three-way split + STCG / LTCG section;
 *   - fits a 360px viewport with zero overflow;
 *   - zero console errors / page errors / failed requests throughout.
 *
 * Run (with the app already serving):
 *   BASE_URL=http://localhost:3500 node scripts/e2e-seg-tax-v2.mjs
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

// ── Date helpers (host runs IST) ──
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const today = ymd(now);
// open position opened a few days ago (still live → unrealised, excluded)
const openDate = ymd(new Date(now.getTime() - 4 * 86_400_000));

// All trades in ONE financial year (FY 2024-25: 1 Apr 2024 → 31 Mar 2025) so a
// single FY view holds the whole picture.
// STCG delivery EQ: bought 2024-05-01, sold 2024-09-01 (~4 months → short term).
// LTCG delivery EQ: bought 2023-05-01, sold 2024-09-01 (~16 months → long term),
//   close date 2024-09-01 → realised in FY 2024-25.
// Intraday EQ (speculative): same-day round trip on 2024-06-10.
// F&O (non-speculative business): NIFTY future round trip 2024-06-10..2024-06-12.

const HEAD =
  "symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time,expiry_date";
const eqRow = (sym, date, side, qty, price, id) =>
  `${sym},,${date},NSE,EQ,EQ,${side},false,${qty},${price},${id},O${id},${date}T10:00:00,`;

const rows = [];
// 3 STCG delivery winners (held ~4 months)
for (let i = 0; i < 3; i++) {
  const s = `STCGEQ${i}`;
  rows.push(eqRow(s, "2024-05-01", "buy", 10, "100.00", `S${i}a`));
  rows.push(eqRow(s, "2024-09-01", "sell", 10, "150.00", `S${i}b`));
}
// 3 LTCG delivery winners (held ~16 months, realised in FY 2024-25)
for (let i = 0; i < 3; i++) {
  const s = `LTCGEQ${i}`;
  rows.push(eqRow(s, "2023-05-01", "buy", 10, "100.00", `L${i}a`));
  rows.push(eqRow(s, "2024-09-01", "sell", 10, "200.00", `L${i}b`));
}
// 3 intraday EQ round trips (same day → MIS → speculative)
for (let i = 0; i < 3; i++) {
  const s = `DAYEQ${i}`;
  rows.push(`${s},,2024-06-10,NSE,EQ,EQ,buy,false,20,100.00,D${i}a,OD${i}a,2024-06-10T09:30:00,`);
  rows.push(`${s},,2024-06-10,NSE,EQ,EQ,sell,false,20,101.00,D${i}b,OD${i}b,2024-06-10T14:30:00,`);
}
// NIFTY futures (overnight → NRML → non-speculative business). The importer
// pairs same-symbol/expiry fills into ONE round trip, so these collapse to a
// single non-speculative-business trade.
for (let i = 0; i < 3; i++) {
  rows.push(
    `NIFTY,,2024-06-10,NFO,FUT,FUTIDX,buy,false,50,24000.00,F${i}a,OF${i}a,2024-06-10T10:00:00,2024-06-27`
  );
  rows.push(
    `NIFTY,,2024-06-12,NFO,FUT,FUTIDX,sell,false,50,24100.00,F${i}b,OF${i}b,2024-06-12T14:00:00,2024-06-27`
  );
}
// 1 still-OPEN delivery EQ position (buy, no sell → unrealised → excluded)
rows.push(eqRow("OPENEQ", openDate, "buy", 8, "300.00", "OP1"));

const CSV = [HEAD, ...rows].join("\n");
// 3 STCG + 3 LTCG + 3 intraday + 1 merged FUT round trip + 1 open = 11.
const COUNT = 11;

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

const openTaxTab = async (page) => {
  await page.goto(`${BASE}/app/reports`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /Tax & charges/ }).click();
  // The FY picker is always present (even in the empty state). Select FY 2024-25,
  // where all the trades realised, BEFORE waiting for the classification card.
  await page.getByLabel("Financial year").click();
  await page.getByRole("option", { name: "FY 2024-25" }).click();
  await page.getByTestId("tax-classification").waitFor({ timeout: 20000 });
};

const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
const page = await ctx.newPage();
wireListeners(page);

console.log("— Seed + import a mixed all-trader-type book —");
await step("seed a demo journal + import the mixed book", async () => {
  await startDemo(page);
  await importCsv(page, CSV, COUNT);
});

console.log("— Three-way income classification —");
await step("the Tax tab shows the three income heads with correct counts", async () => {
  await openTaxTab(page);
  const card = page.getByTestId("tax-classification");
  const tradesOf = async (bucket) =>
    (await card.locator(`tr[data-bucket="${bucket}"] [data-bucket-trades]`).innerText()).trim();
  const spec = await tradesOf("speculative");
  const biz = await tradesOf("business");
  const cg = await tradesOf("capital-gains");
  if (spec !== "3") throw new Error(`speculative trades expected 3, saw ${spec}`);
  // 3 NIFTY future fills pair into ONE round trip → 1 non-spec business trade.
  if (biz !== "1") throw new Error(`non-spec business trades expected 1, saw ${biz}`);
  if (cg !== "6") throw new Error(`capital-gains trades expected 6 (3 STCG + 3 LTCG), saw ${cg}`);
});

console.log("— STCG / LTCG capital-gains split —");
await step("the capital-gains card splits STCG and LTCG correctly", async () => {
  const cgCard = page.getByTestId("tax-capital-gains");
  await cgCard.waitFor({ timeout: 15000 });
  const stcg = (await cgCard.locator('tr[data-cg="stcg"] [data-cg-trades]').innerText()).trim();
  const ltcg = (await cgCard.locator('tr[data-cg="ltcg"] [data-cg-trades]').innerText()).trim();
  if (stcg !== "3") throw new Error(`STCG trades expected 3 (held ~4m), saw ${stcg}`);
  if (ltcg !== "3") throw new Error(`LTCG trades expected 3 (held ~16m), saw ${ltcg}`);
});

await step("the open (unrealised) delivery position is excluded from capital gains", async () => {
  // 6 closed CNC trades only — the still-open OPENEQ is not counted.
  const cgCard = page.getByTestId("tax-capital-gains");
  const stcg = Number(
    (await cgCard.locator('tr[data-cg="stcg"] [data-cg-trades]').innerText()).trim()
  );
  const ltcg = Number(
    (await cgCard.locator('tr[data-cg="ltcg"] [data-cg-trades]').innerText()).trim()
  );
  if (stcg + ltcg !== 6) throw new Error(`expected 6 realised CG trades, saw ${stcg + ltcg}`);
});

await step("LTCG exemption note + STCG/LTCG rate labels + disclaimer are present", async () => {
  const cgCard = page.getByTestId("tax-capital-gains");
  const text = await cgCard.innerText();
  if (!/1,25,000/.test(text) && !/1.25L/i.test(text))
    throw new Error(`expected the ₹1.25L LTCG exemption, saw: ${text.slice(0, 300)}`);
  if (!/STCG\s*20%/.test(text))
    throw new Error(`expected STCG 20% label, saw: ${text.slice(0, 300)}`);
  if (!/LTCG\s*12\.5%/.test(text))
    throw new Error(`expected LTCG 12.5% label, saw: ${text.slice(0, 300)}`);
  if (!/not\s+a tax-liability computation/i.test(text))
    throw new Error("expected the not-a-tax-computation note");
});

await step("the top-level disclaimer (not tax advice) is present", async () => {
  if ((await page.getByText(/not tax advice/i).count()) < 1)
    throw new Error("missing the not-tax-advice disclaimer");
});

console.log("— CSV export carries the three-way split + STCG/LTCG —");
await step("the CSV download includes the three-way split + STCG/LTCG section", async () => {
  const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
  await page.getByRole("button", { name: "CSV" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let csv = "";
  for await (const chunk of stream) csv += chunk.toString();
  for (const section of [
    "Income classification (three-way)",
    "Capital gains — STCG / LTCG (delivery equity)",
    "STCG (held",
    "LTCG (held",
  ]) {
    if (!csv.includes(section)) throw new Error(`CSV missing section: ${section}`);
  }
  if (!/STCG 20%/.test(csv)) throw new Error("CSV missing STCG 20% rate label");
  if (!/LTCG 12.5%/.test(csv)) throw new Error("CSV missing LTCG 12.5% rate label");
});

console.log("— 360px —");
await step("the Tax tab fits 360px with zero overflow", async () => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openTaxTab(page);
  await page.getByTestId("tax-capital-gains").waitFor({ timeout: 15000 });
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
