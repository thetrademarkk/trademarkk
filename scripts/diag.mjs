// Verifies: header/content left-edge alignment on all public pages + top loader.
import { chromium } from "playwright";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const browser = await chromium.launch();
const page = await browser
  .newContext({ viewport: { width: 1380, height: 900 } })
  .then((c) => c.newPage());
let failed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    console.log("  ok ", name);
  } catch (e) {
    failed++;
    console.log("  FAIL", name, "::", String(e.message).slice(0, 150));
  }
};

const PAGES = [
  "/",
  "/features",
  "/docs",
  "/blog",
  "/faq",
  "/community",
  "/changelog",
  "/blog/why-every-fno-trader-needs-a-journal",
];

for (const path of PAGES) {
  await step(`alignment ${path}`, async () => {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    const headerLeft = await page
      .locator('header a[aria-label="TradeMark"]')
      .evaluate((el) => el.getBoundingClientRect().left);
    // Alignment = the content container's padded edge matches the header's.
    const mainLeft = await page.evaluate(() => {
      const el = document.querySelector("main [class*='max-w-5xl']");
      if (!el) return -999;
      const r = el.getBoundingClientRect();
      return r.left + parseFloat(getComputedStyle(el).paddingLeft);
    });
    const diff = Math.abs(headerLeft - mainLeft);
    if (diff > 2)
      throw new Error(
        `header ${headerLeft.toFixed(1)} vs content ${mainLeft.toFixed(1)} (diff ${diff.toFixed(1)}px)`
      );
  });
}

await step("top loader appears on route change", async () => {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const sawLoader = page.evaluate(
    () =>
      new Promise((resolve) => {
        const obs = new MutationObserver(() => {
          if (document.getElementById("nprogress")) {
            obs.disconnect();
            resolve(true);
          }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => resolve(Boolean(document.getElementById("nprogress"))), 6000);
      })
  );
  await page.locator('header nav a[href="/features"]').click();
  if (!(await sawLoader)) throw new Error("#nprogress never appeared");
});

await browser.close();
console.log(failed === 0 ? "\n✅ Verified." : `\n❌ ${failed} failed`);
if (failed) process.exit(1);
