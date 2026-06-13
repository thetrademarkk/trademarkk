/**
 * Feature e2e: goals & risk limits.
 *
 * Verifies in a real Chromium against a running build (demo mode, no platform
 * users):
 *   - the "Goals & risk limits" settings section saves and persists limits;
 *   - importing a losing tradebook dated today trips BOTH guardrails with the
 *     "stop for today" banners (honest copy, ₹ limit shown) on dashboard AND
 *     trades;
 *   - dismissing a banner silences only that breach and survives reload
 *     (per-day localStorage);
 *   - the weekly goals widget tracks profit-goal % and journaling days;
 *   - everything fits a 360px viewport with zero horizontal overflow;
 *   - zero console errors / page errors / failed requests throughout.
 *
 * Run (with the app already serving):
 *   BASE_URL=http://localhost:3200 node scripts/e2e-goals.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3200";
const issues = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
const page = await ctx.newPage();

page.on("console", (m) => {
  if (m.type() === "error") issues.push(`[console] ${page.url()} :: ${m.text().slice(0, 250)}`);
});
page.on("pageerror", (e) =>
  issues.push(`[pageerror] ${page.url()} :: ${String(e.message).slice(0, 250)}`)
);
page.on("response", (r) => {
  if (r.status() >= 400) issues.push(`[http ${r.status()}] ${r.url()}`);
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
    issues.push(`[step] ${name} :: ${String(e.message).slice(0, 200)}`);
    console.log(`  FAIL ${name}: ${String(e.message).slice(0, 200)}`);
  }
};

// ── CSV fixtures dated TODAY (host runs IST → today's IST day) ──
const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const HEAD =
  "symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time,expiry_date";
const row = (sym, side, qty, price, hh, mm, id) =>
  `${sym},,${today},NFO,FO,,${side},false,${qty},${price},${id},O${id},${today}T${pad(hh)}:${pad(mm)}:00,2026-06-25`;
// Three round trips, each ≈ ₹600 gross loss → total well past a ₹500 cap.
const LOSING_CSV = [
  HEAD,
  row("BANKNIFTY24JUN52000CE", "buy", 30, "300.00", 9, 21, "L1"),
  row("BANKNIFTY24JUN52000CE", "sell", 30, "280.00", 9, 35, "L2"),
  row("BANKNIFTY24JUN52100CE", "buy", 30, "250.00", 10, 5, "L3"),
  row("BANKNIFTY24JUN52100CE", "sell", 30, "230.00", 10, 18, "L4"),
  row("BANKNIFTY24JUN52200CE", "buy", 30, "200.00", 11, 2, "L5"),
  row("BANKNIFTY24JUN52200CE", "sell", 30, "180.00", 11, 30, "L6"),
].join("\n");
// One ₹6,000-gross winner — flips the week net comfortably past a ₹1,000 goal.
const WINNING_CSV = [
  HEAD,
  row("NIFTY24JUN23000CE", "buy", 75, "100.00", 13, 10, "W1"),
  row("NIFTY24JUN23000CE", "sell", 75, "180.00", 13, 45, "W2"),
].join("\n");

const importCsv = async (csv, count) => {
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

const banners = () => page.getByTestId("risk-banners");
const lossBanner = () => page.locator('[data-breach="loss"]');
const tradesBanner = () => page.locator('[data-breach="trades"]');
const noOverflow = async () => {
  const o = await page.evaluate(() => {
    const el = document.scrollingElement;
    return { sw: el.scrollWidth, cw: el.clientWidth };
  });
  if (o.sw > o.cw) throw new Error(`horizontal overflow ${o.sw} > ${o.cw}`);
};

// ── Setup: fresh demo journal ──
console.log("— Setup —");
await step("demo onboarding → empty dashboard", async () => {
  await page.goto(`${BASE}/app/onboarding`, { waitUntil: "networkidle" });
  await page.getByText("Try without an account").click();
  await page.getByText("Set up your journal").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Start journaling" }).click();
  await page.waitForURL("**/app/dashboard", { timeout: 60000 });
  await page.getByText("Net P&L").first().waitFor({ timeout: 30000 });
});

await step("no goals yet → topbar Goals entry present, no widget, no banner", async () => {
  // The dashboard empty nudge was removed; the topbar "Goals" link is the entry.
  await page.getByRole("link", { name: "Weekly goals" }).first().waitFor({ timeout: 15000 });
  if (
    await page
      .getByTestId("weekly-goals")
      .isVisible()
      .catch(() => false)
  )
    throw new Error("configured weekly-goals widget shown before goals set");
  if (
    await banners()
      .isVisible()
      .catch(() => false)
  )
    throw new Error("banner with no limits set");
});

// ── Configure goals ──
console.log("— Settings —");
await step("goals section saves limits", async () => {
  await page.goto(`${BASE}/app/settings`, { waitUntil: "networkidle" });
  await page.getByText("Goals & risk limits").waitFor({ timeout: 15000 });
  await page.locator("#goal-max-loss").fill("500");
  await page.locator("#goal-max-trades").fill("2");
  await page.locator("#goal-weekly-profit").fill("1000");
  await page.locator("#goal-journal-days").fill("3");
  await page.getByRole("button", { name: "Save goals" }).click();
  await page.getByText("Goals saved").waitFor({ timeout: 10000 });
});

await step("limits persist across reload (journal DB settings)", async () => {
  await page.goto(`${BASE}/app/settings`, { waitUntil: "networkidle" });
  for (const [sel, want] of [
    ["#goal-max-loss", "500"],
    ["#goal-max-trades", "2"],
    ["#goal-weekly-profit", "1000"],
    ["#goal-journal-days", "3"],
  ]) {
    const v = await page.locator(sel).inputValue();
    if (v !== want) throw new Error(`${sel} = "${v}", want "${want}"`);
  }
});

await step("widget live, 0% progress, still no banner", async () => {
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "networkidle" });
  await page.getByTestId("weekly-goals").waitFor({ timeout: 15000 });
  await page.getByText("Profit goal").waitFor();
  await page.getByText("of 3 days").waitFor();
  if (
    await banners()
      .isVisible()
      .catch(() => false)
  )
    throw new Error("banner before any trade");
});

// ── Engineer the breach ──
console.log("— Breach —");
await step("import 3 losing trades dated today", async () => {
  await importCsv(LOSING_CSV, 3);
});

await step("trades page: max-loss banner with honest ₹ copy", async () => {
  await page.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  await lossBanner().waitFor({ timeout: 15000 });
  const text = await lossBanner().innerText();
  if (!text.includes("Daily max loss hit — stop for today")) throw new Error(`title: ${text}`);
  if (!/past your ₹500 limit/.test(text)) throw new Error(`limit copy missing: ${text}`);
  // Paise-exact loss (charges engine decides the exact figure) past the cap.
  const m = text.match(/down ₹([\d,]+\.\d{2}) today/);
  if (!m) throw new Error(`paise loss missing: ${text}`);
  const loss = Number(m[1].replace(/,/g, ""));
  if (!(loss > 1800 && loss < 2400)) throw new Error(`implausible loss ₹${loss} for the fixture`);
});

await step("trades page: trade-limit banner (3 of cap 2)", async () => {
  const text = await tradesBanner().innerText();
  if (!text.includes("Daily trade limit reached — stop for today"))
    throw new Error(`title: ${text}`);
  if (!text.includes("3 trades today against your cap of 2")) throw new Error(`copy: ${text}`);
});

await step("dashboard shows both banners; profit progress honestly 0%", async () => {
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "networkidle" });
  await lossBanner().waitFor({ timeout: 15000 });
  await tradesBanner().waitFor();
  const pct = await page.getByTestId("goal-profit").getAttribute("data-pct");
  if (pct !== "0") throw new Error(`losing week shows ${pct}% toward profit goal`);
});

// ── Per-day dismissal ──
console.log("— Dismissal —");
await step("dismissing max-loss leaves the trade-limit banner", async () => {
  await page.getByRole("button", { name: "Dismiss max-loss warning for today" }).click();
  if (
    await lossBanner()
      .isVisible()
      .catch(() => false)
  )
    throw new Error("loss banner persists");
  await tradesBanner().waitFor({ timeout: 5000 });
});

await step("dismissal survives reload (per-day localStorage)", async () => {
  await page.reload({ waitUntil: "networkidle" });
  await tradesBanner().waitFor({ timeout: 15000 });
  if (
    await lossBanner()
      .isVisible()
      .catch(() => false)
  )
    throw new Error("loss banner came back");
  const stored = await page.evaluate(() => localStorage.getItem("tm.risk-dismissed"));
  const parsed = JSON.parse(stored ?? "{}");
  if (parsed.date !== today || !parsed.kinds?.includes("loss"))
    throw new Error(`bad dismissal record: ${stored}`);
});

await step("dismissing the second banner clears the stack across pages", async () => {
  await page.getByRole("button", { name: "Dismiss trade-limit warning for today" }).click();
  await page.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  await page.getByText("3 trades").first().waitFor({ timeout: 15000 });
  if (
    await banners()
      .isVisible()
      .catch(() => false)
  )
    throw new Error("banners survive dismissal");
});

// ── Weekly progress ──
console.log("— Weekly goals —");
await step("journaling today moves the process goal to 1 of 3", async () => {
  await page.goto(`${BASE}/app/journal`, { waitUntil: "networkidle" });
  await page.getByPlaceholder(/What worked/).fill("Goals e2e review.");
  await page.getByRole("button", { name: "Save journal" }).click();
  await page.getByText("Journal saved").waitFor({ timeout: 10000 });
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "networkidle" });
  await page.getByTestId("goal-journal").waitFor({ timeout: 15000 });
  await page.getByTestId("goal-journal").getByText("of 3 days").waitFor();
  const pct = await page.getByTestId("goal-journal").getAttribute("data-pct");
  if (pct !== "33") throw new Error(`journal pct ${pct}, want 33`);
});

await step("a winning trade completes the profit goal (100%), no banner re-spawn", async () => {
  await importCsv(WINNING_CSV, 1);
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "networkidle" });
  await page.getByTestId("weekly-goals").waitFor({ timeout: 15000 });
  const pct = await page.getByTestId("goal-profit").getAttribute("data-pct");
  if (pct !== "100") throw new Error(`profit pct ${pct}, want 100`);
  // 4th trade of the day, but today's dismissals must hold.
  if (
    await banners()
      .isVisible()
      .catch(() => false)
  )
    throw new Error("dismissed banner re-spawned");
});

// ── Mobile fit ──
console.log("— 360px —");
await step("banner + widget fit 360px with zero overflow", async () => {
  await page.evaluate(() => localStorage.removeItem("tm.risk-dismissed"));
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "networkidle" });
  // The day is net-positive now, so only the trade-count breach is live —
  // the loss banner staying gone is itself the honest behavior.
  await tradesBanner().waitFor({ timeout: 15000 });
  if (
    await lossBanner()
      .isVisible()
      .catch(() => false)
  )
    throw new Error("loss banner shown on a net-positive day");
  await page.getByTestId("weekly-goals").waitFor();
  await noOverflow();
  await page.goto(`${BASE}/app/settings`, { waitUntil: "networkidle" });
  await page.getByText("Goals & risk limits").waitFor({ timeout: 15000 });
  await noOverflow();
});

await browser.close();

console.log(`\n${passed} passed, ${failed} failed`);
if (issues.length) {
  console.log(`\n— ${issues.length} issue(s) —`);
  for (const i of [...new Set(issues)]) console.log("  " + i);
  process.exit(1);
} else {
  console.log("\nNo console errors, no failed requests. ✅");
}
