/**
 * Extension end-to-end: loads the built MV3 extension into a persistent
 * Chromium profile beside the app and walks the full companion flow —
 * signed-out panel → sign-in tab → auto-detected session → quick trade log →
 * trade visible in the web journal → rule check-off → synced on the web
 * dashboard → broker-page capture (Kite order-window fixture → prefilled
 * quick log → journal row, plus changed-DOM silent degradation) → account
 * deletion (cleans up the provisioned Turso DB).
 *
 * Prereqs:  npm run ext:build   and the app serving on BASE_URL.
 *   BASE_URL=http://localhost:3400 node scripts/e2e-extension.mjs
 */
import { chromium } from "playwright";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3400";
const EXT_ID = "ibfnimbkdoiafemjonbnnjhnojodanej"; // pinned via manifest "key"
const EXT_PATH = path.resolve("extension/dist");
const EMAIL = `e2e-ext-${Date.now()}@example.com`;
const PASSWORD = "e2e-Passw0rd-123";

if (!existsSync(path.join(EXT_PATH, "manifest.json"))) {
  console.error("extension/dist missing — run `npm run ext:build` first");
  process.exit(1);
}

const issues = [];
let failed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    issues.push(`[step] ${name} :: ${String(e.message).slice(0, 200)}`);
    console.log(`  FAIL ${name}: ${String(e.message).slice(0, 200)}`);
  }
};

const userDataDir = mkdtempSync(path.join(tmpdir(), "tm-ext-e2e-"));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium", // new headless supports extensions
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
  viewport: { width: 1380, height: 900 },
});

// 401/404 resource logs are by-design here: the panel polls /api/db/status
// while signed out (401) and the token-vending flow probes before provisioning
// (404). Turso's edge also occasionally answers one request without CORS
// headers — Chromium logs a CORS error plus a bare ERR_FAILED; the libsql
// client retries and the step assertions still gate the real outcome.
// Anything else (403s, 5xx, JS errors) still fails the run.
const benign = (text) =>
  /Failed to load resource: .*(401|404)/.test(text) ||
  /turso\.io.*blocked by CORS policy/.test(text) ||
  /^Failed to load resource: net::ERR_FAILED$/.test(text);
const watchPage = (p) => {
  p.on("console", (m) => {
    if (m.type() === "error" && !benign(m.text()))
      issues.push(`[console] ${p.url()} :: ${m.text().slice(0, 250)}`);
  });
  p.on("pageerror", (e) =>
    issues.push(`[pageerror] ${p.url()} :: ${String(e.message).slice(0, 250)}`)
  );
};
ctx.on("page", watchPage);
for (const p of ctx.pages()) watchPage(p);

console.log(`Extension e2e on ${BASE} as ${EMAIL} (ext ${EXT_ID})`);

// ── Panel: signed-out state, pointed at the local app ─────────────────────
const panel = await ctx.newPage();

await step("panel loads and opens settings", async () => {
  await panel.goto(`chrome-extension://${EXT_ID}/sidepanel.html`, { waitUntil: "load" });
  await panel.getByText("TradeMarkk").first().waitFor({ timeout: 15000 });
  // The very first page of a freshly installed extension occasionally stalls
  // (SW still wiring surfaces) — one reload recovers it.
  try {
    await panel.getByRole("button", { name: "Settings" }).click({ timeout: 10000 });
    await panel.getByLabel("TradeMarkk app URL").waitFor({ timeout: 5000 });
  } catch {
    await panel.reload({ waitUntil: "load" });
    await panel.getByRole("button", { name: "Settings" }).click({ timeout: 10000 });
    await panel.getByLabel("TradeMarkk app URL").waitFor({ timeout: 5000 });
  }
});

await step("app URL override saves (self-hoster flow)", async () => {
  // A just-installed extension page can silently drop its first
  // chrome.storage.local write (observed ~1 in 3 fresh profiles) — without
  // verification the whole suite would run against the DEFAULT (production!)
  // app URL. Verify the stored value and retry through a drawer remount.
  let saved = false;
  for (let i = 0; i < 3 && !saved; i++) {
    if (
      !(await panel
        .getByLabel("TradeMarkk app URL")
        .isVisible()
        .catch(() => false))
    ) {
      await panel.getByRole("button", { name: "Settings" }).click();
      await panel.getByLabel("TradeMarkk app URL").waitFor({ timeout: 5000 });
    }
    await panel.getByLabel("TradeMarkk app URL").fill(BASE);
    await panel.getByRole("button", { name: "Save URL" }).click();
    saved = await panel
      .waitForFunction(
        async (base) => (await chrome.storage.local.get("appUrl")).appUrl === base,
        BASE,
        { timeout: 4000, polling: 250 }
      )
      .then(
        () => true,
        () => false
      );
    if (!saved) {
      await panel
        .getByRole("button", { name: "Close settings" })
        .click()
        .catch(() => undefined);
    }
  }
  if (!saved) throw new Error("app URL was never persisted to chrome.storage.local");
  // Reboot the panel so it deterministically points at BASE before sign-in.
  await panel.reload({ waitUntil: "load" });
  await panel.getByText("Sign in to TradeMarkk").first().waitFor({ timeout: 15000 });
});

let appTab;
await step("sign-in button opens an app tab on onboarding", async () => {
  const tabPromise = ctx.waitForEvent("page", { timeout: 10000 });
  await panel.getByRole("button", { name: "Sign in to TradeMarkk" }).click();
  appTab = await tabPromise;
  // Exact-origin assertion: the suite must never silently sign up on prod.
  await appTab.waitForURL(`${BASE}/app/onboarding`, { timeout: 20000 });
});

// ── Web app: create the account (hosted mode, real Turso provisioning) ────
await step("sign up + hosted provisioning", async () => {
  await appTab.waitForLoadState("networkidle");
  await appTab.getByText("Start free — we host it").click();
  await appTab.getByText("Create your free account").waitFor({ timeout: 15000 });
  await appTab.getByPlaceholder("Your name").fill("E2E Extension");
  await appTab.getByPlaceholder("you@example.com").fill(EMAIL);
  await appTab.getByPlaceholder("8+ characters").fill(PASSWORD);
  await appTab.getByRole("button", { name: "Create free account" }).click();
  await appTab.getByText("Set up your journal").waitFor({ timeout: 90000 });
  await appTab.getByRole("button", { name: "Start journaling" }).click();
  await appTab.waitForURL("**/app/dashboard", { timeout: 60000 });
});

// ── Panel auto-detects the session (signed-out polling) ───────────────────
await step("panel auto-detects the new session", async () => {
  await panel.bringToFront();
  await panel.getByText("Quick log").waitFor({ timeout: 45000 });
});

await step("glance strip renders P&L + streak", async () => {
  await panel.locator(".glance-chip").first().waitFor({ timeout: 15000 });
  if ((await panel.locator(".glance-chip").count()) < 2) throw new Error("missing glance chips");
});

// ── Hero flow: quick trade log ─────────────────────────────────────────────
await step("instrument parses with confirmation chip", async () => {
  await panel.getByLabel("Instrument", { exact: true }).fill("BANKNIFTY24JUN52000CE");
  const chip = panel.getByTestId("parse-chip");
  await chip.waitFor({ timeout: 5000 });
  const text = await chip.textContent();
  if (!text.includes("BANKNIFTY") || !text.includes("52000") || !text.includes("CE")) {
    throw new Error(`unexpected chip: ${text}`);
  }
});

await step("trade saves from the panel", async () => {
  // exact: seeded rule texts contain "entry"/"exit", and rule buttons carry
  // those words in their aria-labels.
  await panel.getByLabel("Qty", { exact: true }).fill("30");
  await panel.getByLabel("Entry", { exact: true }).fill("120.5");
  await panel.getByLabel("Exit", { exact: true }).fill("150.25");
  await panel.getByLabel("Exit", { exact: true }).press("Enter"); // Enter submits
  await panel.getByText("BANKNIFTY logged").waitFor({ timeout: 30000 });
  await panel.getByRole("button", { name: "View in journal" }).waitFor({ timeout: 5000 });
});

await step("trade appears in the web journal with correct values", async () => {
  await appTab.bringToFront();
  await appTab.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  const row = appTab.locator("tr", { hasText: "BANKNIFTY" }).first();
  await row.waitFor({ timeout: 30000 });
  const rowText = await row.textContent();
  for (const needle of ["BANKNIFTY", "52000", "CE"]) {
    if (!rowText.includes(needle)) throw new Error(`journal row missing ${needle}: ${rowText}`);
  }
});

// ── Rules sync ─────────────────────────────────────────────────────────────
let firstRule = "";
await step("rule checks off from the panel", async () => {
  await panel.bringToFront();
  await panel.getByRole("button", { name: "Log another" }).click();
  await panel.getByText(/\/\d+ followed/).waitFor({ timeout: 15000 });
  firstRule = (await panel.locator(".rule-text").first().textContent()).trim();
  await panel.locator(".rule-btn").first().click(); // "Followed" on rule 1
  await panel.locator(".rule-btn.on-followed").first().waitFor({ timeout: 10000 });
  await panel.getByText(/1\/\d+ followed/).waitFor({ timeout: 10000 });
});

await step("rule check-off is visible on the web dashboard", async () => {
  await appTab.bringToFront();
  await appTab.goto(`${BASE}/app/dashboard`, { waitUntil: "networkidle" });
  await appTab.getByText("Today's rules").waitFor({ timeout: 30000 });
  await appTab
    .getByText(/1\/\d+ followed/)
    .first()
    .waitFor({ timeout: 30000 });
  if (!firstRule) throw new Error("first rule text was empty");
});

// ── v2: broker-page capture (Kite order-window fixture) ───────────────────
// Real Kite sits behind a login, so the adapter runs against a static fixture
// replicating Kite's order-window DOM (extension/test-fixtures/). The content
// script is the REAL built bundle, registered through the same
// chrome.scripting API the settings toggle uses — Playwright cannot accept
// Chrome's native permission prompt, so the e2e skips the prompt, never the
// code path. localhost is already within the manifest's host permissions.
const FIXTURE_PORT = 3401;
const fixtureDir = path.resolve("extension/test-fixtures");
const fixtureFor = (url) => {
  if (url?.startsWith("/changed")) return "kite-order-window-changed.html";
  if (url?.startsWith("/tradebook-changed")) return "kite-tradebook-changed.html";
  if (url?.startsWith("/tradebook")) return "kite-tradebook.html";
  if (url?.startsWith("/upstox-changed")) return "upstox-order-window-changed.html";
  if (url?.startsWith("/upstox")) return "upstox-order-window.html";
  return "kite-order-window.html";
};
const fixtureServer = createServer((req, res) => {
  try {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(readFileSync(path.join(fixtureDir, fixtureFor(req.url))));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => fixtureServer.listen(FIXTURE_PORT, resolve));

let kitePage;
await step("capture: kite content script registers on the fixture origin", async () => {
  await panel.evaluate(async () => {
    await chrome.scripting.registerContentScripts([
      {
        id: "tm-capture-kite-e2e",
        js: ["content-kite.js"],
        matches: ["http://localhost:3401/*"],
        runAt: "document_idle",
      },
    ]);
  });
  const ids = await panel.evaluate(async () =>
    (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id)
  );
  if (!ids.includes("tm-capture-kite-e2e")) throw new Error(`registration missing: ${ids}`);
});

await step("capture: affordance appears on the Kite order window", async () => {
  kitePage = await ctx.newPage();
  await kitePage.goto(`http://localhost:${FIXTURE_PORT}/`, { waitUntil: "load" });
  await kitePage.locator("[data-fixture-row='INFY'] [data-fixture='buy']").click();
  await kitePage.locator(".order-window.buy").waitFor({ timeout: 5000 });
  const btn = kitePage.locator("[data-tm-capture]");
  await btn.waitFor({ timeout: 5000 });
  const label = await btn.textContent();
  if (!label.includes("Log in TradeMarkk")) throw new Error(`wrong label: ${label}`);
  // Captures are version-tagged so adapter breakage is detectable in reports.
  if ((await btn.getAttribute("data-tm-capture")) !== "1")
    throw new Error("missing adapter version tag");
});

await step("capture: click prefills the quick log (buy, limit price)", async () => {
  await kitePage.locator(".order-window input[name='quantity']").fill("75");
  await kitePage.locator(".order-window input[name='price']").fill("1520.4");
  await kitePage.locator("[data-tm-capture]").click();
  await panel.bringToFront();
  await panel.getByTestId("capture-chip").waitFor({ timeout: 10000 });
  const chip = await panel.getByTestId("capture-chip").textContent();
  if (!chip.includes("Zerodha Kite")) throw new Error(`wrong capture source chip: ${chip}`);
  const value = (label) => panel.getByLabel(label, { exact: true }).inputValue();
  if ((await value("Instrument")) !== "INFY") throw new Error("instrument not prefilled");
  if ((await value("Qty")) !== "75") throw new Error("qty not prefilled");
  if ((await value("Entry")) !== "1520.4") throw new Error("entry not prefilled");
  const buyPressed = await panel
    .getByRole("button", { name: "Buy", exact: true })
    .getAttribute("aria-pressed");
  if (buyPressed !== "true") throw new Error("buy side not selected");
});

await step("capture: captured trade saves into the journal", async () => {
  await panel.getByLabel("Exit", { exact: true }).fill("1531.2");
  await panel.getByLabel("Exit", { exact: true }).press("Enter");
  await panel.getByText("INFY logged").waitFor({ timeout: 30000 });
  await appTab.bringToFront();
  await appTab.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  await appTab.locator("tr", { hasText: "INFY" }).first().waitFor({ timeout: 30000 });
});

await step("capture: sell market order → Sell side + last-price fallback", async () => {
  await kitePage.bringToFront();
  await kitePage.locator("[data-fixture-row='NIFTY2661924500CE'] [data-fixture='sell']").click();
  await kitePage.locator(".order-window.sell").waitFor({ timeout: 5000 });
  await kitePage.locator(".order-window input[name='quantity']").fill("150");
  const btn = kitePage.locator("[data-tm-capture]");
  await btn.waitFor({ timeout: 5000 });
  await btn.click();
  await panel.bringToFront();
  await panel.getByTestId("capture-chip").waitFor({ timeout: 10000 });
  const value = (label) => panel.getByLabel(label, { exact: true }).inputValue();
  if ((await value("Instrument")) !== "NIFTY2661924500CE")
    throw new Error("instrument not prefilled");
  if ((await value("Qty")) !== "150") throw new Error("qty not prefilled");
  // The fixture's option row is a market order (price disabled at 0) — the
  // adapter must fall back to the last traded price, never capture 0.
  if ((await value("Entry")) !== "145.3")
    throw new Error(`expected LTP fallback 145.3, got "${await value("Entry")}"`);
  const sellPressed = await panel
    .getByRole("button", { name: "Sell", exact: true })
    .getAttribute("aria-pressed");
  if (sellPressed !== "true") throw new Error("sell side not selected");
  const parsed = await panel.getByTestId("parse-chip").textContent();
  if (!parsed.includes("NIFTY") || !parsed.includes("24500") || !parsed.includes("CE"))
    throw new Error(`captured option did not parse: ${parsed}`);
});

await step("capture: changed broker DOM degrades silently", async () => {
  await kitePage.goto(`http://localhost:${FIXTURE_PORT}/changed`, { waitUntil: "load" });
  await kitePage.locator("[data-fixture='open-changed']").click();
  await kitePage.locator(".ow-dialog").waitFor({ timeout: 5000 });
  await kitePage.waitForTimeout(1200); // > the content script's rescan debounce
  if ((await kitePage.locator("[data-tm-capture]").count()) !== 0)
    throw new Error("capture button injected into an unrecognized DOM");
  await kitePage.close();
});

// ── v2: Upstox order-window capture (registry-driven, second adapter) ─────
// Same opt-in path as Kite: the REAL built content-upstox.js bundle is
// registered through chrome.scripting on the localhost fixture origin (real
// Upstox Pro sits behind a login). Upstox Pro is a React app with hashed
// CSS-Modules class names, so the adapter anchors on visible "Qty"/"Price"
// labels, the buy/sell class fragment + "Confirm to buy/sell" copy + active
// side tab, and [class*='_symbol_']/[class*='ltp'] substring matchers — the
// fixture mirrors that hashed-class structure.
let upstoxPage;
await step("upstox: content script registers on the fixture origin", async () => {
  await panel.evaluate(async () => {
    await chrome.scripting.registerContentScripts([
      {
        id: "tm-capture-upstox-e2e",
        js: ["content-upstox.js"],
        matches: ["http://localhost:3401/*"],
        runAt: "document_idle",
      },
    ]);
  });
  const ids = await panel.evaluate(async () =>
    (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id)
  );
  if (!ids.includes("tm-capture-upstox-e2e")) throw new Error(`registration missing: ${ids}`);
});

await step("upstox: affordance appears on the order window", async () => {
  upstoxPage = await ctx.newPage();
  await upstoxPage.goto(`http://localhost:${FIXTURE_PORT}/upstox`, { waitUntil: "load" });
  await upstoxPage.locator("[data-fixture-row='RELIANCE'] [data-fixture='buy']").click();
  await upstoxPage.locator("._orderWindow_3c8f2._buy_3c8f2").waitFor({ timeout: 5000 });
  const btn = upstoxPage.locator("[data-tm-capture]");
  await btn.waitFor({ timeout: 5000 });
  const label = await btn.textContent();
  if (!label.includes("Log in TradeMarkk")) throw new Error(`wrong label: ${label}`);
  if ((await btn.getAttribute("data-tm-capture")) !== "1")
    throw new Error("missing adapter version tag");
});

await step("upstox: click prefills the quick log (buy, limit price)", async () => {
  await upstoxPage.locator("._orderWindow_3c8f2 ._field_3c8f2:has-text('Qty') input").fill("50");
  await upstoxPage
    .locator("._orderWindow_3c8f2 ._field_3c8f2:has-text('Price') input")
    .first()
    .fill("2980.4");
  await upstoxPage.locator("[data-tm-capture]").click();
  await panel.bringToFront();
  await panel.getByTestId("capture-chip").waitFor({ timeout: 10000 });
  const chip = await panel.getByTestId("capture-chip").textContent();
  if (!chip.includes("Upstox")) throw new Error(`wrong capture source chip: ${chip}`);
  const value = (label) => panel.getByLabel(label, { exact: true }).inputValue();
  if ((await value("Instrument")) !== "RELIANCE") throw new Error("instrument not prefilled");
  if ((await value("Qty")) !== "50") throw new Error("qty not prefilled");
  if ((await value("Entry")) !== "2980.4") throw new Error("entry not prefilled");
  const buyPressed = await panel
    .getByRole("button", { name: "Buy", exact: true })
    .getAttribute("aria-pressed");
  if (buyPressed !== "true") throw new Error("buy side not selected");
});

await step("upstox: captured trade saves into the journal", async () => {
  await panel.getByLabel("Exit", { exact: true }).fill("2991.2");
  await panel.getByLabel("Exit", { exact: true }).press("Enter");
  await panel.getByText("RELIANCE logged").waitFor({ timeout: 30000 });
  await appTab.bringToFront();
  await appTab.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  await appTab.locator("tr", { hasText: "RELIANCE" }).first().waitFor({ timeout: 30000 });
});

await step("upstox: sell market order → Sell side + last-price fallback", async () => {
  await upstoxPage.bringToFront();
  await upstoxPage
    .locator("[data-fixture-row='NSE_FO|NIFTY2661924500CE'] [data-fixture='sell']")
    .click();
  await upstoxPage.locator("._orderWindow_3c8f2._sell_3c8f2").waitFor({ timeout: 5000 });
  await upstoxPage.locator("._orderWindow_3c8f2 ._field_3c8f2:has-text('Qty') input").fill("75");
  const btn = upstoxPage.locator("[data-tm-capture]");
  await btn.waitFor({ timeout: 5000 });
  await btn.click();
  await panel.bringToFront();
  await panel.getByTestId("capture-chip").waitFor({ timeout: 10000 });
  const value = (label) => panel.getByLabel(label, { exact: true }).inputValue();
  if ((await value("Instrument")) !== "NIFTY2661924500CE")
    throw new Error("instrument not prefilled");
  if ((await value("Qty")) !== "75") throw new Error("qty not prefilled");
  // The option row is a market order (price disabled at 0) — the adapter must
  // fall back to the last traded price, never capture 0.
  if ((await value("Entry")) !== "145.3")
    throw new Error(`expected LTP fallback 145.3, got "${await value("Entry")}"`);
  const sellPressed = await panel
    .getByRole("button", { name: "Sell", exact: true })
    .getAttribute("aria-pressed");
  if (sellPressed !== "true") throw new Error("sell side not selected");
  const parsed = await panel.getByTestId("parse-chip").textContent();
  if (!parsed.includes("NIFTY") || !parsed.includes("24500") || !parsed.includes("CE"))
    throw new Error(`captured option did not parse: ${parsed}`);
  // Clear the staged capture so it doesn't bleed into later steps.
  await panel.getByRole("button", { name: "Dismiss broker capture" }).click();
});

await step("upstox: changed order DOM degrades silently", async () => {
  await upstoxPage.goto(`http://localhost:${FIXTURE_PORT}/upstox-changed`, { waitUntil: "load" });
  await upstoxPage.locator("[data-fixture='open-changed']").click();
  await upstoxPage.locator("._ow2_88aa1").waitFor({ timeout: 5000 });
  await upstoxPage.waitForTimeout(1200); // > the content script's rescan debounce
  if ((await upstoxPage.locator("[data-tm-capture]").count()) !== 0)
    throw new Error("capture button injected into an unrecognized DOM");
  await upstoxPage.close();
  // Unregister so the Upstox script can't fire on the shared fixture origin
  // during the positions-import steps below.
  await panel.evaluate(async () => {
    await chrome.scripting
      .unregisterContentScripts({ ids: ["tm-capture-upstox-e2e"] })
      .catch(() => undefined);
  });
});

// ── Positions/tradebook auto-import (Kite tradebook fixture) ──────────────
// The import content bundle is the REAL built content-kite-positions.js,
// registered through the same chrome.scripting API the Settings toggle uses
// (its registration id `tm-positions-kite` is what isImportEnabled() reads, so
// the panel's "Import from Kite" launcher appears). The panel discovers the
// broker tab by message round-trip, so it finds the localhost fixture tab the
// same way it would find a real kite.zerodha.com tab.
let tradebookPage;
await step("import: positions content script registers on the fixture origin", async () => {
  await panel.evaluate(async () => {
    await chrome.scripting.registerContentScripts([
      {
        id: "tm-positions-kite",
        js: ["content-kite-positions.js"],
        matches: ["http://localhost:3401/*"],
        runAt: "document_idle",
      },
    ]);
  });
  const ids = await panel.evaluate(async () =>
    (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id)
  );
  if (!ids.includes("tm-positions-kite")) throw new Error(`registration missing: ${ids}`);
  // Open the tradebook fixture so the content script is live before scraping.
  tradebookPage = await ctx.newPage();
  await tradebookPage.goto(`http://localhost:${FIXTURE_PORT}/tradebook`, { waitUntil: "load" });
  await tradebookPage.locator(".completed-orders").waitFor({ timeout: 5000 });
});

await step("import: launcher appears once import is enabled", async () => {
  await panel.bringToFront();
  await panel.reload({ waitUntil: "load" });
  await panel.getByText("Quick log").waitFor({ timeout: 45000 });
  await panel.getByTestId("import-launch").waitFor({ timeout: 15000 });
});

await step("import: preview shows new trades and hides dedupe", async () => {
  await panel.getByTestId("import-launch").click();
  // Scanning → preview: the fixture pairs into 2 closed round-trips (INFY eq +
  // NIFTY option); the rejected & open rows must be silently skipped.
  await panel.getByTestId("import-trades").waitFor({ timeout: 20000 });
  const summary = await panel.locator(".import-summary").first().textContent();
  if (!/2\s*new/.test(summary)) throw new Error(`expected 2 new trades, got: ${summary}`);
  const rows = panel.locator(".import-row");
  if ((await rows.count()) !== 2)
    throw new Error(`expected 2 preview rows, got ${await rows.count()}`);
  // The skipped rejected SBIN row never reaches the preview.
  if ((await panel.locator(".import-row", { hasText: "SBIN" }).count()) !== 0)
    throw new Error("rejected SBIN order leaked into the preview");
});

await step("import: importing writes the trades into the journal", async () => {
  await panel.getByTestId("import-trades").click();
  await panel.getByTestId("import-done").waitFor({ timeout: 30000 });
  const done = await panel.getByTestId("import-done").textContent();
  if (!/2 trades imported/.test(done)) throw new Error(`unexpected import result: ${done}`);
  await panel.getByRole("button", { name: "Done" }).click();
});

await step("import: imported trades appear in the web journal", async () => {
  await appTab.bringToFront();
  await appTab.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  // Assert the two SPECIFIC imported round-trips. "NIFTY" alone also matches
  // the earlier BANKNIFTY capture row, so key off the 24500 strike instead.
  const optionRow = appTab.locator("tr", { hasText: "24500" });
  await optionRow.first().waitFor({ timeout: 30000 });
  const optionText = await optionRow.first().textContent();
  if (!optionText.includes("NIFTY")) throw new Error(`imported option row wrong: ${optionText}`);
  // The imported INFY round-trip is 10 qty @ 1450 → 1470 (the earlier capture
  // INFY was 75 qty) — match the row carrying the imported avg entry.
  const infyRow = appTab.locator("tr", { hasText: "INFY" }).filter({ hasText: "1450" });
  await infyRow.first().waitFor({ timeout: 30000 });
});

await step("import: re-import is idempotent (all rows already in journal)", async () => {
  await panel.bringToFront();
  await panel.getByTestId("import-launch").click();
  await panel.getByTestId("import-trades").waitFor({ timeout: 20000 });
  const summary = await panel.locator(".import-summary").first().textContent();
  // Same fixture, same deterministic ids → 0 new, 2 already in journal.
  if (!/0\s*new/.test(summary) || !/2 already in journal/.test(summary))
    throw new Error(`re-import not deduped: ${summary}`);
  // Nothing selected → the CTA is disabled.
  const ctaDisabled = await panel.getByTestId("import-trades").isDisabled();
  if (!ctaDisabled) throw new Error("import CTA should be disabled when nothing is new");
  await panel.getByRole("button", { name: "Close import" }).click();
});

await step("import: redesigned tradebook DOM degrades silently (empty)", async () => {
  await tradebookPage.bringToFront();
  await tradebookPage.goto(`http://localhost:${FIXTURE_PORT}/tradebook-changed`, {
    waitUntil: "load",
  });
  await tradebookPage.waitForTimeout(400);
  await panel.bringToFront();
  await panel.getByTestId("import-launch").click();
  // Unrecognized markup → zero importable fills → the empty state, never a guess.
  await panel.getByText("No executed trades found").waitFor({ timeout: 20000 });
  await panel.getByRole("button", { name: "Close import" }).click();
  await tradebookPage.close();
});

// ── Sign out from the panel ────────────────────────────────────────────────
await step("panel sign-out returns to the signed-out state", async () => {
  await panel.bringToFront();
  await panel.getByRole("button", { name: "Settings" }).click();
  await panel.getByRole("button", { name: "Sign out" }).click();
  await panel.getByText("Sign in to TradeMarkk").first().waitFor({ timeout: 20000 });
});

// ── Cleanup: delete the account (also deletes the provisioned Turso DB) ───
await step("account deletion cleans up", async () => {
  await appTab.bringToFront();
  // Panel sign-out killed the session server-side; the web tab still has
  // tm.mode=hosted in localStorage and would boot into a connection error.
  // A fresh visitor state is what we want for the re-sign-in.
  await appTab.goto(`${BASE}/app/onboarding`, { waitUntil: "domcontentloaded" });
  await appTab.evaluate(() => localStorage.clear());
  await appTab.goto(`${BASE}/app/onboarding`, { waitUntil: "networkidle" });
  await appTab.getByText("Start free — we host it").click();
  await appTab.getByText("Create your free account").waitFor({ timeout: 15000 });
  await appTab.getByRole("button", { name: /Already have an account/ }).click();
  await appTab.getByPlaceholder("you@example.com").fill(EMAIL);
  await appTab.getByPlaceholder("8+ characters").fill(PASSWORD);
  await appTab.getByRole("button", { name: "Sign in", exact: true }).click();
  await appTab.waitForURL("**/app/dashboard", { timeout: 90000 });
  await appTab.goto(`${BASE}/app/settings`, { waitUntil: "networkidle" });
  await appTab.getByRole("button", { name: /Delete account/ }).click();
  await appTab.getByRole("button", { name: "Continue" }).click();
  await appTab.getByRole("button", { name: "Delete everything" }).click();
  await appTab.waitForURL((u) => !u.pathname.startsWith("/app"), { timeout: 30000 });
});

await ctx.close();
fixtureServer.close();
try {
  rmSync(userDataDir, { recursive: true, force: true });
} catch {
  /* profile dir sometimes lags on Windows — harmless temp leftovers */
}

// The panel polls /api/db/status while signed out — 401s there are by design,
// so only console/page errors and step failures count.
if (failed > 0 || issues.length > 0) {
  console.log("\nIssues:");
  for (const i of issues) console.log("  " + i);
  process.exit(1);
}
console.log("\nExtension e2e passed end to end.");
