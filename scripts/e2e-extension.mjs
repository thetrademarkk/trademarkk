/**
 * Extension end-to-end: loads the built MV3 extension into a persistent
 * Chromium profile beside the app and walks the full companion flow —
 * signed-out panel → sign-in tab → auto-detected session → quick trade log →
 * trade visible in the web journal → rule check-off → synced on the web
 * dashboard → account deletion (cleans up the provisioned Turso DB).
 *
 * Prereqs:  npm run ext:build   and the app serving on BASE_URL.
 *   BASE_URL=http://localhost:3400 node scripts/e2e-extension.mjs
 */
import { chromium } from "playwright";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
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
// (404). Chromium logs every non-2xx load as a console error; anything else
// (403s, 5xx, JS errors) still fails the run.
const benign = (text) => /Failed to load resource: .*(401|404)/.test(text);
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
  await panel.getByText("TradeMark").first().waitFor({ timeout: 15000 });
  await panel.getByRole("button", { name: "Settings" }).click();
  await panel.getByLabel("TradeMark app URL").waitFor({ timeout: 5000 });
});

await step("app URL override saves (self-hoster flow)", async () => {
  await panel.getByLabel("TradeMark app URL").fill(BASE);
  await panel.getByRole("button", { name: "Save URL" }).click();
  await panel.getByText("Sign in to TradeMark").first().waitFor({ timeout: 15000 });
});

let appTab;
await step("sign-in button opens an app tab on onboarding", async () => {
  const tabPromise = ctx.waitForEvent("page", { timeout: 10000 });
  await panel.getByRole("button", { name: "Sign in to TradeMark" }).click();
  appTab = await tabPromise;
  await appTab.waitForURL("**/app/onboarding", { timeout: 20000 });
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

// ── Sign out from the panel ────────────────────────────────────────────────
await step("panel sign-out returns to the signed-out state", async () => {
  await panel.bringToFront();
  await panel.getByRole("button", { name: "Settings" }).click();
  await panel.getByRole("button", { name: "Sign out" }).click();
  await panel.getByText("Sign in to TradeMark").first().waitFor({ timeout: 20000 });
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
