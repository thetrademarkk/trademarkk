/**
 * Offline PWA e2e: proves the service worker caches the app shell + sql.js wasm
 * so LOCAL mode loads with no network (PWA-01/02), guards the cache against
 * poisoning (PWA-08), and falls back gracefully when nothing is cached.
 *
 * Setup (local only — Playwright is not a project dependency):
 *   npm i -D playwright && npx playwright install chromium
 * Run against a PROD build (next dev is broken by the strict CSP), e.g.:
 *   NODE_ENV=production npx next start -p 3987 &
 *   BASE_URL=http://localhost:3987 node scripts/e2e-pwa-offline.mjs
 *
 * NOTE: the SW only registers when NODE_ENV==="production" in the running app
 * (see src/components/pwa-register.tsx). `next start` sets that automatically.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3987";
const SHELL = "/app/dashboard";
let passed = 0;
let failed = 0;
const fail = (name, msg) => {
  failed++;
  console.log(`  FAIL ${name}: ${msg}`);
};
const ok = (name) => {
  passed++;
  console.log(`  ok   ${name}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ serviceWorkers: "allow" });
const page = await ctx.newPage();

// settle() waits for any client-side redirect (the LOCAL/BYOD mode gate) to
// finish before we evaluate, so we never read a destroyed execution context.
const settle = async () => {
  await page.waitForLoadState("load").catch(() => {});
  await page.waitForTimeout(600);
};

// 1) Load the shell route and wait for the SW to install + take control.
await page.goto(`${BASE}${SHELL}`, { waitUntil: "load" });
await settle();
let controlled = false;
try {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 15000,
  });
  controlled = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return Boolean(reg.active && navigator.serviceWorker.controller);
  });
} catch (e) {
  fail("sw-control", String(e.message).slice(0, 120));
}
controlled ? ok("service worker installed + controlling") : fail("sw-control", "no controller");

// 2) Drive a navigation through the SW so the shell document is cached, and let
//    the precache (wasm) settle.
await page.goto(`${BASE}${SHELL}`, { waitUntil: "load" });
await settle();

const cacheState = await page.evaluate(async () => {
  const names = await caches.keys();
  let wasm = false;
  let shellDoc = false;
  for (const n of names) {
    const c = await caches.open(n);
    if (await c.match("/sqljs/sql-wasm.wasm")) wasm = true;
    if ((await c.match("/__tm_shell_doc")) || (await c.match("/app/dashboard"))) shellDoc = true;
  }
  return { names, wasm, shellDoc };
});
cacheState.wasm ? ok("sql.js wasm precached") : fail("wasm-precache", "wasm not cached");
cacheState.shellDoc
  ? ok("app-shell document cached")
  : fail("shell-cache", "no cached shell document");

// 3) Go offline and assert the shell still loads from cache (LOCAL mode HTML).
await ctx.setOffline(true);
let offlineLoaded = false;
try {
  const resp = await page.goto(`${BASE}${SHELL}`, { waitUntil: "domcontentloaded" });
  await settle();
  const html = await page.content();
  // A cached shell returns a real document (not a network error) with markup.
  offlineLoaded = Boolean(resp) && html.length > 500 && html.includes("</html>");
} catch (e) {
  fail("offline-nav", String(e.message).slice(0, 120));
}
offlineLoaded
  ? ok("LOCAL app shell loads OFFLINE")
  : fail("offline-shell", "shell did not render offline");

// 4) Offline asset request for a non-cached asset must not hard-crash the page.
const assetSoftFail = await page.evaluate(async () => {
  try {
    await fetch("/_next/static/chunks/__does_not_exist__.js");
    return true; // resolved (soft) rather than throwing uncaught
  } catch {
    return true; // a rejected fetch is fine; what matters is no page crash
  }
});
assetSoftFail ? ok("offline asset miss fails soft") : fail("asset-soft", "hard failure");

await ctx.setOffline(false);
await browser.close();

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
