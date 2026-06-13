// Horizontal-overflow audit at phone widths: flags any route where the page
// scrolls sideways and names the widest offending element.
import { chromium } from "playwright";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const WIDTHS = [360, 390];
const PUBLIC = [
  "/",
  "/features",
  "/pulse",
  "/faq",
  "/docs",
  "/blog",
  "/blog/why-every-fno-trader-needs-a-journal",
  "/changelog",
  "/compare/tradezella-alternative",
  "/community",
  "/community/leaderboard",
  "/community/messages",
  "/community/notifications",
  "/community/s/NIFTY",
  "/backtesting",
];
const APP = [
  "/app/dashboard",
  "/app/trades",
  "/app/journal",
  "/app/calendar",
  "/app/analytics",
  "/app/insights",
  "/app/rules",
  "/app/playbooks",
  "/app/reports",
  "/app/backtesting",
  "/app/settings",
];

const browser = await chromium.launch();
let bad = 0;

for (const width of WIDTHS) {
  const ctx = await browser.newContext({
    viewport: { width, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();

  // demo session for app routes
  await page.goto(`${BASE}/app/onboarding`, { waitUntil: "networkidle" });
  await page.getByText("Try without an account").click();
  const setup = page.getByText("Set up your journal");
  await Promise.race([
    setup.waitFor({ timeout: 60000 }).catch(() => {}),
    page.waitForURL("**/app/dashboard", { timeout: 60000 }).catch(() => {}),
  ]);
  if (await setup.isVisible().catch(() => false))
    await page.getByRole("button", { name: "Start journaling" }).click();
  await page.waitForURL("**/app/dashboard", { timeout: 60000 });

  for (const path of [...PUBLIC, ...APP]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    const res = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflow = doc.scrollWidth - doc.clientWidth;
      if (overflow <= 1) return null;
      // find widest offenders
      const out = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.right > doc.clientWidth + 1 || r.left < -1) {
          const cls = (el.className?.toString?.() ?? "").slice(0, 60);
          out.push(`${el.tagName.toLowerCase()}.${cls} → right=${Math.round(r.right)}`);
          if (out.length >= 4) break;
        }
      }
      return { overflow, out };
    });
    if (res) {
      bad++;
      console.log(`OVERFLOW ${width}px ${path} (+${res.overflow}px)`);
      for (const o of res.out) console.log(`   ${o}`);
    } else {
      console.log(`ok       ${width}px ${path}`);
    }
  }
  await ctx.close();
}
await browser.close();
console.log(
  bad === 0 ? "\nNO horizontal overflow anywhere." : `\n${bad} route/width combos overflow`
);
process.exit(bad ? 1 : 0);
