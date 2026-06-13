/**
 * Generates Chrome Web Store marketing assets for the TradeMarkk extension —
 * cred-free, no platform user, no live journal DB, fully deterministic:
 *
 *   1280x800 screenshots (extension/store-assets/screenshots/*.png):
 *     - 01-signed-out      the panel's one-click sign-in hero
 *     - 02-broker-capture  the "Log in TradeMarkk" pill on a Kite order window
 *     - 03-settings        the Settings drawer (broker capture + tradebook import)
 *     - 04-byod-connect    the BYOD "connect your own database" flow
 *   440x280 small promo tile (extension/store-assets/promo/promo-440x280.png).
 *
 * Each panel state is captured against a tiny local mock that returns 401 from
 * /api/db/status (signed-out) — so NO account is created and NO database is
 * provisioned. The session-gated data screens (populated quick-log, today's
 * rules with check-offs, the P&L + streak glance) can't be shown without a live
 * journal, which would mean creating a platform user; those are listed as a
 * manual-capture checklist in extension/store-assets/store-listing.md.
 *
 * Every shot is the real panel UI captured at a phone-ish width, then composed
 * centered on a branded 1280x800 backdrop so the asset matches the store's
 * required dimensions exactly.
 *
 * Prereqs:  npm run ext:build  (extension/dist must exist).
 *   node scripts/ext-store-screenshots.mjs
 *
 * Spins two throwaway local http servers (mock app + broker fixtures) and a
 * headless Chromium with the built extension loaded; tears everything down on
 * exit. Writes only into extension/store-assets/.
 */
import { chromium } from "playwright";
import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const EXT_ID = "ibfnimbkdoiafemjonbnnjhnojodanej"; // pinned via manifest "key"
const EXT_PATH = path.join(repoRoot, "extension", "dist");
const ASSETS = path.join(repoRoot, "extension", "store-assets");
const SHOTS = path.join(ASSETS, "screenshots");
const PROMO = path.join(ASSETS, "promo");
const FIXTURE_DIR = path.join(repoRoot, "extension", "test-fixtures");

if (!existsSync(path.join(EXT_PATH, "manifest.json"))) {
  console.error("extension/dist missing — run `npm run ext:build` first");
  process.exit(1);
}
for (const d of [SHOTS, PROMO]) mkdirSync(d, { recursive: true });

const PANEL_W = 372; // the real side-panel/popup width band (compact, authentic)
const PANEL_H = 720;
const CANVAS_W = 1280;
const CANVAS_H = 800;

// Brand palette (matches extension/src/styles.css carbon-dark tokens + BrandMark).
const BRAND = {
  bg: "#0a0a0b",
  panel: "#141416",
  accent: "#34d399",
  loss: "#f87171",
  violet: "#8b5cf6",
  text: "#fafafa",
  muted: "#a1a1aa",
};

const MOCK_PORT = 3402; // signed-out app mock (401 on /api/db/status)
const FIXTURE_PORT = 3403; // Kite order-window fixture
const MOCK_URL = `http://localhost:${MOCK_PORT}`;

// ── Tiny mock app ──────────────────────────────────────────────────────────
// Default: /api/db/status → 401 ⇒ panel renders the signed-out hero.
// When `byodMode` is on: 200 with a signed-in BYOD user and no provisioned
// creds ⇒ the panel renders the "Connect your Turso database" flow. Either way
// NO account is created and NO database is provisioned.
let byodMode = false;
const mockServer = createServer((req, res) => {
  if (req.url?.startsWith("/api/db/status")) {
    if (byodMode) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          user: { id: "demo", email: "you@trademarkk.com", name: "You" },
          storageMode: "byod",
          provisioned: false,
        })
      );
      return;
    }
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "signed out" }));
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<!doctype html><title>TradeMarkk mock</title>");
});

// ── Broker fixtures (Kite order window) for the capture-pill shot ──────────
const fixtureServer = createServer((req, res) => {
  try {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(readFileSync(path.join(FIXTURE_DIR, "kite-order-window.html")));
  } catch {
    res.writeHead(404);
    res.end();
  }
});

await new Promise((r) => mockServer.listen(MOCK_PORT, r));
await new Promise((r) => fixtureServer.listen(FIXTURE_PORT, r));

const userDataDir = mkdtempSync(path.join(tmpdir(), "tm-ext-shots-"));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium",
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
  viewport: { width: PANEL_W, height: PANEL_H },
  // deviceScaleFactor MUST stay 1: the Chrome Web Store requires screenshots at
  // EXACTLY 1280x800 and the promo tile at EXACTLY 440x280 (a 2x retina export
  // is rejected), and we screenshot with explicit pixel `clip` rects.
  deviceScaleFactor: 1,
  colorScheme: "dark",
});

let failed = 0;
const done = [];
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok  ${name}`);
    done.push(name);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}: ${String(e.message).slice(0, 200)}`);
  }
};

/**
 * Captures the given panel page (at PANEL_W x PANEL_H) and composes it
 * centered on a branded CANVAS_W x CANVAS_H backdrop, written to `outFile`.
 */
async function composeShot(panelPage, outFile, caption) {
  const png = await panelPage.screenshot({ type: "png" });
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  const frame = await ctx.newPage();
  try {
    await frame.setViewportSize({ width: CANVAS_W, height: CANVAS_H });
    await frame.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>
        * { margin: 0; box-sizing: border-box; }
        html,body { width:${CANVAS_W}px; height:${CANVAS_H}px; overflow:hidden; }
        body {
          background:
            radial-gradient(1100px 700px at 78% -10%, ${BRAND.violet}22, transparent 60%),
            radial-gradient(900px 600px at 5% 110%, ${BRAND.accent}1f, transparent 55%),
            ${BRAND.bg};
          font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
          color: ${BRAND.text};
          display:flex; align-items:center; gap:64px;
          padding:0 88px;
        }
        .copy { flex:1; max-width:520px; }
        .brand { display:flex; align-items:center; gap:12px; margin-bottom:28px; }
        .brand svg { width:40px; height:40px; }
        .brand span { font-size:26px; font-weight:700; letter-spacing:-0.01em; }
        h1 { font-size:42px; line-height:1.1; font-weight:700; letter-spacing:-0.02em; margin-bottom:18px; }
        p { font-size:19px; line-height:1.5; color:${BRAND.muted}; }
        .shot {
          width:${PANEL_W}px; border-radius:18px; overflow:hidden;
          box-shadow: 0 24px 70px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06);
          background:${BRAND.panel};
        }
        .shot img { display:block; width:100%; }
      </style></head>
      <body>
        <div class="copy">
          <div class="brand">${brandMarkSvg(40)}<span>TradeMarkk</span></div>
          <h1>${caption.title}</h1>
          <p>${caption.body}</p>
        </div>
        <div class="shot"><img src="${dataUrl}" alt=""></div>
      </body></html>`,
      { waitUntil: "load" }
    );
    await frame.waitForTimeout(150);
    await frame.screenshot({
      path: outFile,
      clip: { x: 0, y: 0, width: CANVAS_W, height: CANVAS_H },
    });
  } finally {
    await frame.close();
  }
}

/** The BrandMark SVG (mirror of extension/src/ui/Brand.tsx) for the backdrop + tile. */
function brandMarkSvg(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
    <rect width="64" height="64" rx="14" fill="#0A0A0B"/>
    <rect x="12" y="22" width="8" height="20" rx="2" fill="#34D399"/>
    <rect x="15" y="14" width="2" height="36" fill="#34D399"/>
    <rect x="28" y="18" width="8" height="16" rx="2" fill="#F87171"/>
    <rect x="31" y="10" width="2" height="32" fill="#F87171"/>
    <rect x="44" y="26" width="8" height="22" rx="2" fill="#8B5CF6"/>
    <rect x="47" y="18" width="2" height="38" fill="#8B5CF6"/>
  </svg>`;
}

// ── Panel page pointed at the signed-out mock ──────────────────────────────
const panel = await ctx.newPage();
await panel.goto(`chrome-extension://${EXT_ID}/sidepanel.html`, { waitUntil: "load" });
await panel.getByText("TradeMarkk").first().waitFor({ timeout: 15000 });

// Point the panel at the local mock (so it lands in the signed-out state, not
// an "app unreachable" error against the baked-in production URL). localhost is
// already in the manifest host_permissions, so we set chrome.storage.local
// directly and reload — deterministic, avoiding the Settings Save UI race
// (a just-installed extension page can silently drop its first storage write).
await step("point panel at signed-out mock", async () => {
  await panel.evaluate(async (u) => {
    await chrome.storage.local.set({ appUrl: u });
  }, MOCK_URL);
  await panel.waitForFunction(
    async (u) => (await chrome.storage.local.get("appUrl")).appUrl === u,
    MOCK_URL,
    { timeout: 5000, polling: 200 }
  );
  await panel.reload({ waitUntil: "load" });
  await panel.getByText("Sign in to TradeMarkk").first().waitFor({ timeout: 15000 });
});

await step("01-signed-out", async () => {
  await panel.getByText("Sign in to TradeMarkk").first().waitFor({ timeout: 10000 });
  await composeShot(panel, path.join(SHOTS, "01-signed-out.png"), {
    title: "Log trades beside your broker — without leaving the page",
    body: "A Manifest V3 side panel that writes straight to your own TradeMarkk journal. Sign in once on the web app; the panel picks up your session automatically.",
  });
});

// ── Settings drawer (broker capture toggles + tradebook import) ────────────
await step("03-settings", async () => {
  await panel.getByRole("button", { name: "Settings" }).click();
  await panel.getByLabel("TradeMarkk app URL").waitFor({ timeout: 5000 });
  await panel.getByText("Broker capture").first().waitFor({ timeout: 5000 });
  // Show the real production URL in the field rather than the local mock — this
  // only fills the input (no Save), so the panel stays pointed at the mock.
  await panel.getByLabel("TradeMarkk app URL").fill("https://thetrademarkk.com");
  await composeShot(panel, path.join(SHOTS, "03-settings.png"), {
    title: "Opt-in broker capture for five brokers",
    body: "Turn on capture for Zerodha Kite, Upstox, Groww, Dhan or Fyers — Chrome asks once. It reads only the order fields you can see, never balances or holdings.",
  });
  await panel.getByRole("button", { name: "Close settings" }).click();
});

// ── BYOD connect flow ──────────────────────────────────────────────────────
// Force the panel into needs-byod-creds: a status that says BYOD-but-no-creds.
await step("04-byod-connect", async () => {
  // Reconfigure the mock to report a signed-in BYOD user with no provisioned
  // creds, then reboot the panel. Retry the reload a couple of times — a fresh
  // boot occasionally races the first status fetch.
  byodMode = true;
  const heading = panel.getByText("Connect your Turso database");
  let shown = false;
  for (let i = 0; i < 3 && !shown; i++) {
    await panel.reload({ waitUntil: "load" });
    await panel.getByText("TradeMarkk").first().waitFor({ timeout: 15000 });
    shown = await heading.waitFor({ timeout: 8000 }).then(
      () => true,
      () => false
    );
  }
  if (!shown) throw new Error("BYOD connect state never rendered");
  await composeShot(panel, path.join(SHOTS, "04-byod-connect.png"), {
    title: "Your data, your database",
    body: "Hosted or bring-your-own Turso database — journal writes go directly to your DB, never through our servers. Byte-identical to a trade logged on the web.",
  });
  byodMode = false;
});

// ── Broker-capture pill on a real Kite order-window fixture ────────────────
await step("02-broker-capture", async () => {
  // Register the real built Kite content bundle on the fixture origin — the
  // same chrome.scripting path the Settings toggle uses (Chrome's native
  // permission prompt is unreachable from Playwright, so we skip the prompt,
  // never the code path). localhost is within the manifest host permissions.
  await panel.evaluate(async () => {
    await chrome.scripting.registerContentScripts([
      {
        id: "tm-capture-kite-shots",
        js: ["content-kite.js"],
        matches: ["http://localhost:3403/*"],
        runAt: "document_idle",
      },
    ]);
  });
  const kite = await ctx.newPage();
  try {
    await kite.setViewportSize({ width: CANVAS_W, height: CANVAS_H });
    await kite.goto(`http://localhost:${FIXTURE_PORT}/`, { waitUntil: "load" });
    await kite.locator("[data-fixture-row='INFY'] [data-fixture='buy']").click();
    await kite.locator(".order-window.buy").waitFor({ timeout: 5000 });
    await kite.locator(".order-window input[name='quantity']").fill("75");
    await kite.locator(".order-window input[name='price']").fill("1520.40");
    const pill = kite.locator("[data-tm-capture]");
    await pill.waitFor({ timeout: 5000 });
    await kite.waitForTimeout(150);
    await kite.screenshot({
      path: path.join(SHOTS, "02-broker-capture.png"),
      clip: { x: 0, y: 0, width: CANVAS_W, height: CANVAS_H },
    });
  } finally {
    await kite.close();
    await panel
      .evaluate(async () => {
        await chrome.scripting.unregisterContentScripts({ ids: ["tm-capture-kite-shots"] });
      })
      .catch(() => {});
  }
});

// ── 440x280 small promo tile (branded, static) ─────────────────────────────
await step("promo-440x280", async () => {
  const tile = await ctx.newPage();
  try {
    await tile.setViewportSize({ width: 440, height: 280 });
    await tile.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>
        *{margin:0;box-sizing:border-box;}
        html,body{width:440px;height:280px;overflow:hidden;}
        body{
          background:
            radial-gradient(420px 300px at 88% -20%, ${BRAND.violet}33, transparent 60%),
            radial-gradient(360px 260px at -10% 120%, ${BRAND.accent}26, transparent 55%),
            ${BRAND.bg};
          font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
          color:${BRAND.text}; display:flex; flex-direction:column; justify-content:center;
          padding:30px 34px;
        }
        .row{display:flex;align-items:center;gap:13px;margin-bottom:16px;}
        .row svg{width:46px;height:46px;}
        .row b{font-size:30px;font-weight:700;letter-spacing:-0.01em;}
        h2{font-size:21px;line-height:1.25;font-weight:650;margin-bottom:9px;letter-spacing:-0.01em;}
        p{font-size:14px;line-height:1.4;color:${BRAND.muted};}
      </style></head>
      <body>
        <div class="row">${brandMarkSvg(46)}<b>TradeMarkk</b></div>
        <h2>Journal every trade beside your broker</h2>
        <p>One-click logging, daily-rule discipline and broker-page capture — in a side panel.</p>
      </body></html>`,
      { waitUntil: "load" }
    );
    await tile.waitForTimeout(150);
    await tile.screenshot({
      path: path.join(PROMO, "promo-440x280.png"),
      clip: { x: 0, y: 0, width: 440, height: 280 },
    });
  } finally {
    await tile.close();
  }
});

await ctx.close();
mockServer.close();
fixtureServer.close();
rmSync(userDataDir, { recursive: true, force: true });

console.log(`\nStore assets: ${done.length} produced, ${failed} failed.`);
process.exit(failed ? 1 : 0);
