/**
 * Feature e2e: share-as-image cards (trade + weekly report).
 *
 * Verifies in a real Chromium against a running build:
 *   - the branded card canvas actually paints (pixel sampling: brand top bar,
 *     dark background, hero glyphs);
 *   - ₹ P&L is hidden by default and only appears after the opt-in toggle
 *     (canvas bitmaps must differ between the two states);
 *   - PNG download works for both trade and report cards (signature + 2400×1350);
 *   - open trades show OPEN with no toggle and no ₹ anywhere;
 *   - the community-post tab still works; the dialog fits a 360px viewport;
 *   - zero console errors / page errors / failed requests throughout.
 *
 * Run (with the app already serving):
 *   BASE_URL=http://localhost:3200 node scripts/e2e-share-image.mjs
 */
import { chromium } from "playwright";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3200";
const issues = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1380, height: 900 },
  acceptDownloads: true,
});
const page = await ctx.newPage();
const dlDir = mkdtempSync(path.join(tmpdir(), "tm-share-"));

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

const canvas = () => page.getByTestId("share-card-canvas");

/** Waits for the async font+paint pass, then returns sampled pixel facts. */
const samplePixels = () =>
  canvas().evaluate(async (c) => {
    const facts = () => {
      const g = c.getContext("2d");
      const px = (x, y) => {
        const d = g.getImageData(x, y, 1, 1).data;
        return { r: d[0], g: d[1], b: d[2] };
      };
      // Count hero-band pixels that are clearly "lit" (text/glow, not bg).
      const band = g.getImageData(100, 480, 1800, 240).data;
      let lit = 0;
      for (let i = 0; i < band.length; i += 4) {
        if (band[i] > 70 || band[i + 1] > 70 || band[i + 2] > 70) lit++;
      }
      return {
        w: c.width,
        h: c.height,
        topBar: px(12, 4),
        corner: px(c.width - 8, c.height - 8),
        lit,
      };
    };
    for (let tries = 0; tries < 50; tries++) {
      if (c.width > 300 && facts().lit > 200) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return facts();
  });

const bitmapHash = () =>
  canvas().evaluate((c) => {
    const url = c.toDataURL("image/png");
    return `${url.length}:${url.slice(-80)}`;
  });

const downloadPng = async (button) => {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    button.click(),
  ]);
  const file = path.join(dlDir, download.suggestedFilename());
  await download.saveAs(file);
  const bytes = readFileSync(file);
  const sig = bytes.subarray(0, 8).toString("hex");
  if (sig !== "89504e470d0a1a0a") throw new Error(`not a PNG (${sig})`);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== 2400 || height !== 1350) throw new Error(`bad dimensions ${width}x${height}`);
  if (bytes.length < 20_000) throw new Error(`suspiciously small PNG (${bytes.length}B)`);
  return download.suggestedFilename();
};

// ── Demo journal with one closed + one open trade ──
console.log("— Setup: demo journal —");
await step("demo onboarding → empty dashboard", async () => {
  await page.goto(`${BASE}/app/onboarding`, { waitUntil: "networkidle" });
  await page.getByText("Try without an account").click();
  await page.getByText("Set up your journal").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Start journaling" }).click();
  await page.waitForURL("**/app/dashboard", { timeout: 60000 });
  await page.getByText("Net P&L").first().waitFor({ timeout: 30000 });
});

const quickAdd = async (symbol, qty, entry, exit) => {
  await page.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  await page.keyboard.press("t");
  await page.getByPlaceholder("NIFTY / RELIANCE").waitFor({ timeout: 10000 });
  await page.getByPlaceholder("NIFTY / RELIANCE").fill(symbol);
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Equity" }).click();
  await page.getByPlaceholder("75").fill(qty);
  await page.getByPlaceholder("120.50").fill(entry);
  if (exit) await page.getByPlaceholder("blank = open").fill(exit);
  await page.getByRole("button", { name: "Save trade" }).click();
  await page.getByText("Trade saved").waitFor({ timeout: 10000 });
};

await step("quick-add one closed and one open trade", async () => {
  await quickAdd("SHARECLOSED", "10", "500", "510");
  await quickAdd("SHAREOPEN", "5", "100", "");
});

const openDetail = async (symbol) => {
  await page.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Symbol…").fill(symbol);
  await page.locator("table tbody tr", { hasText: symbol }).first().click();
  await page.getByRole("link", { name: /Open full view/ }).click();
  await page.getByText("P&L breakdown").waitFor({ timeout: 15000 });
};

// ── Closed trade card ──
console.log("— Trade card (closed) —");
await step("share dialog opens on the Image tab with a painted card", async () => {
  await openDetail("SHARECLOSED");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await canvas().waitFor({ timeout: 15000 });
  const px = await samplePixels();
  if (px.w !== 2400 || px.h !== 1350) throw new Error(`canvas is ${px.w}x${px.h}`);
  // Brand top bar: accent violet (#8b5cf6) at the left edge.
  if (!(px.topBar.b > 150 && px.topBar.r > 80 && px.topBar.b > px.topBar.g))
    throw new Error(`top bar not accent: rgb(${px.topBar.r},${px.topBar.g},${px.topBar.b})`);
  // Dark brand background in the bottom-right corner (#0a0a0b + soft glow).
  if (px.corner.r > 60 || px.corner.g > 60 || px.corner.b > 60)
    throw new Error(`background not dark: rgb(${px.corner.r},${px.corner.g},${px.corner.b})`);
  if (px.lit < 200) throw new Error(`hero band looks empty (${px.lit} lit px)`);
});

await step("₹ is hidden by default (WIN/R hero, no rupee glyph)", async () => {
  const hero = await canvas().getAttribute("data-hero");
  const kind = await canvas().getAttribute("data-hero-kind");
  if (!hero || hero.includes("₹")) throw new Error(`₹ leaked: ${hero}`);
  if (!["r", "result"].includes(kind)) throw new Error(`unexpected hero kind ${kind}`);
});

await step("download PNG (default card)", async () => {
  const name = await downloadPng(page.getByRole("button", { name: "Download PNG" }));
  if (!/^trademark-SHARECLOSED-\d{4}-\d{2}-\d{2}\.png$/.test(name))
    throw new Error(`bad file name ${name}`);
  await page.getByText("Image downloaded").waitFor({ timeout: 5000 });
});

await step("opt-in toggle reveals paise-exact ₹ P&L and repaints", async () => {
  const before = await bitmapHash();
  await page.locator("#share-image-pnl").click();
  await page
    .getByTestId("share-card-canvas")
    .and(page.locator('[data-hero-kind="pnl"]'))
    .waitFor({ timeout: 10000 });
  const hero = await canvas().getAttribute("data-hero");
  if (!/^[+-]₹[\d,]+\.\d{2}$/.test(hero)) throw new Error(`hero not paise-exact ₹: ${hero}`);
  // Wait for the repaint, then prove the bitmap actually changed.
  await page.waitForTimeout(300);
  const after = await bitmapHash();
  if (before === after) throw new Error("bitmap unchanged after ₹ opt-in");
});

await step("opting back out hides ₹ again", async () => {
  await page.locator("#share-image-pnl").click();
  await page.waitForTimeout(300);
  const hero = await canvas().getAttribute("data-hero");
  if (hero.includes("₹")) throw new Error(`₹ still visible: ${hero}`);
});

await step("community-post tab still offers the composer", async () => {
  await page.getByRole("tab", { name: "Community post" }).click();
  await page.getByPlaceholder(/Share the idea/).waitFor({ timeout: 10000 });
  await page.getByRole("tab", { name: "Image" }).click();
  await canvas().waitFor({ timeout: 5000 });
  await page.keyboard.press("Escape");
});

// ── Open trade card ──
console.log("— Trade card (open) —");
await step("open trade: OPEN hero, no ₹ toggle, no ₹ anywhere", async () => {
  await openDetail("SHAREOPEN");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await canvas().waitFor({ timeout: 15000 });
  const kind = await canvas().getAttribute("data-hero-kind");
  const hero = await canvas().getAttribute("data-hero");
  if (kind !== "open" || hero !== "OPEN")
    throw new Error(`expected OPEN hero, got ${kind}/${hero}`);
  if ((await page.locator("#share-image-pnl").count()) !== 0)
    throw new Error("₹ toggle rendered for an open trade");
  const px = await samplePixels();
  if (px.lit < 200) throw new Error(`hero band looks empty (${px.lit} lit px)`);
  await page.keyboard.press("Escape");
});

// ── Weekly report card ──
console.log("— Weekly report card —");
await step("reports: share image of this week's review", async () => {
  await page.goto(`${BASE}/app/reports`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Share image" }).click();
  await canvas().waitFor({ timeout: 15000 });
  const kind = await canvas().getAttribute("data-hero-kind");
  const hero = await canvas().getAttribute("data-hero");
  if (kind !== "winrate") throw new Error(`unexpected hero kind ${kind}`);
  if (hero.includes("₹")) throw new Error(`₹ leaked: ${hero}`);
  if (!/^\d+% WIN RATE$/.test(hero)) throw new Error(`unexpected hero ${hero}`);
  const px = await samplePixels();
  if (px.lit < 200) throw new Error(`hero band looks empty (${px.lit} lit px)`);
});

await step("report ₹ opt-in + PNG download", async () => {
  await page.locator("#share-image-pnl").click();
  await page
    .getByTestId("share-card-canvas")
    .and(page.locator('[data-hero-kind="pnl"]'))
    .waitFor({ timeout: 10000 });
  const hero = await canvas().getAttribute("data-hero");
  if (!/^[+-]₹[\d,]+\.\d{2}$/.test(hero)) throw new Error(`hero not paise-exact ₹: ${hero}`);
  await page.waitForTimeout(300);
  const name = await downloadPng(page.getByRole("button", { name: "Download PNG" }));
  if (!/^trademark-week-review-\d{4}-\d{2}-\d{2}\.png$/.test(name))
    throw new Error(`bad file name ${name}`);
  await page.keyboard.press("Escape");
});

// ── Mobile fit ──
console.log("— 360px viewport —");
await step("share dialog fits a 360px screen without overflow", async () => {
  await page.setViewportSize({ width: 360, height: 740 });
  // Mobile trades list renders link cards (no table / quick-view).
  await page.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Symbol…").fill("SHARECLOSED");
  await page.locator('a[href^="/app/trades/"]', { hasText: "SHARECLOSED" }).first().click();
  await page.getByText("P&L breakdown").waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await canvas().waitFor({ timeout: 15000 });
  const scrollW = await page.evaluate(() => document.scrollingElement.scrollWidth);
  if (scrollW > 360) throw new Error(`horizontal overflow: scrollWidth ${scrollW}`);
  const box = await canvas().boundingBox();
  if (!box || box.width > 360) throw new Error(`canvas overflows: ${box?.width}px`);
  await page.keyboard.press("Escape");
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
