/**
 * Landing-page e2e suite (v3): hero dashboard mock, autoplaying demo video
 * (lazy + pause-offscreen + unmute toggle), cursor spotlight/card glow, and
 * the reduced-motion fallbacks for all three. Console errors anywhere fail
 * the run.
 *
 * Run (app already serving):
 *   BASE_URL=http://localhost:3500 node scripts/e2e-landing.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const issues = [];
let passed = 0;
let failed = 0;

const watch = (page) => {
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

const videoState = (page) =>
  page.evaluate(() => {
    const v = document.querySelector('[data-testid="walkthrough-video"]');
    return v ? { paused: v.paused, muted: v.muted, loop: v.loop, inline: v.playsInline } : null;
  });

const browser = await chromium.launch();

// ── Default context: motion allowed ──
{
  const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
  const page = await ctx.newPage();
  watch(page);

  console.log("— Landing (motion) —");
  await step("hero dashboard mock renders (KPIs, rules, chrome title)", async () => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const mock = page.getByTestId("hero-showcase");
    await mock.waitFor({ timeout: 15000 });
    for (const text of [
      "TradeMark — Dashboard",
      "₹18,920",
      "67%",
      "2.1R",
      "Equity curve",
      "Risk max 1% per trade",
      "No trades first 15 min",
      "SL before entry",
    ]) {
      if (!(await mock.getByText(text).first().isVisible())) throw new Error(`missing "${text}"`);
    }
  });

  await step("hero screenshot is gone (mock replaced it)", async () => {
    const shots = await page.locator('img[src*="/landing/dashboard"]').count();
    if (shots !== 0) throw new Error(`found ${shots} screenshot <img>s`);
  });

  await step("video does not mount before it is scrolled into view", async () => {
    if ((await videoState(page)) !== null) throw new Error("video mounted at top of page");
  });

  await step("video autoplays muted+loop+inline on scroll into view", async () => {
    await page.getByTestId("demo-video").scrollIntoViewIfNeeded();
    await page.waitForFunction(
      () => {
        const v = document.querySelector('[data-testid="walkthrough-video"]');
        return v && !v.paused;
      },
      { timeout: 15000 }
    );
    const s = await videoState(page);
    if (!s.muted) throw new Error("not muted");
    if (!s.loop) throw new Error("not looping");
    if (!s.inline) throw new Error("not playsInline");
  });

  await step("video pauses when scrolled out of view", async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(
      () => document.querySelector('[data-testid="walkthrough-video"]')?.paused === true,
      { timeout: 5000 }
    );
  });

  await step("video resumes when scrolled back into view", async () => {
    await page.getByTestId("demo-video").scrollIntoViewIfNeeded();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="walkthrough-video"]')?.paused === false,
      { timeout: 5000 }
    );
  });

  await step("unmute affordance toggles sound", async () => {
    await page.getByRole("button", { name: "Unmute the walkthrough" }).click();
    if ((await videoState(page)).muted) throw new Error("still muted after unmute click");
    await page.getByRole("button", { name: "Mute the walkthrough" }).click();
    if (!(await videoState(page)).muted) throw new Error("not muted after mute click");
  });

  await step("cursor spotlight tracks pointermove via CSS vars", async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(700, 300);
    await page.mouse.move(710, 310);
    await page.waitForFunction(
      () => {
        const el = document.querySelector("[data-spotlight]");
        return el && el.style.getPropertyValue("--sx") !== "";
      },
      { timeout: 5000 }
    );
    const { sx, so } = await page.evaluate(() => {
      const el = document.querySelector("[data-spotlight]");
      return { sx: el.style.getPropertyValue("--sx"), so: el.style.getPropertyValue("--so") };
    });
    if (!/px$/.test(sx)) throw new Error(`--sx not a px value: "${sx}"`);
    if (so !== "1") throw new Error("spotlight opacity var not raised");
  });

  await step("bento card glow vars update + card lifts on hover", async () => {
    const card = page.locator("[data-glow]").first();
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await page.waitForFunction(
      () => {
        const el = document.querySelector("[data-glow]");
        return el && el.style.getPropertyValue("--gx") !== "";
      },
      { timeout: 5000 }
    );
    await page.waitForFunction(
      () => {
        const el = document.querySelector("[data-glow]");
        return getComputedStyle(el).transform !== "none";
      },
      { timeout: 5000 }
    );
  });

  await ctx.close();
}

// ── Reduced-motion context: poster + click-to-play, no cursor effects ──
{
  const ctx = await browser.newContext({
    viewport: { width: 1380, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  watch(page);

  console.log("— Landing (prefers-reduced-motion) —");
  await step("reduced motion: hero mock still shows its finished state", async () => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const mock = page.getByTestId("hero-showcase");
    await mock.waitFor({ timeout: 15000 });
    if (!(await mock.getByText("₹18,920").isVisible())) throw new Error("KPI hidden");
  });

  await step("reduced motion: no autoplay — poster + play button instead", async () => {
    await page.getByTestId("demo-video").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    if ((await videoState(page)) !== null) throw new Error("video mounted without consent");
    const play = page.getByRole("button", { name: "Play the product walkthrough video" });
    if (!(await play.isVisible())) throw new Error("play button missing");
  });

  await step("reduced motion: explicit click starts playback with controls", async () => {
    await page.getByRole("button", { name: "Play the product walkthrough video" }).click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="walkthrough-video"]')?.paused === false,
      { timeout: 15000 }
    );
    const hasControls = await page.evaluate(
      () => document.querySelector('[data-testid="walkthrough-video"]').controls
    );
    if (!hasControls) throw new Error("native controls missing for reduced-motion playback");
  });

  await step("reduced motion: cursor effects stay inert", async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(700, 300);
    await page.mouse.move(640, 360);
    await page.waitForTimeout(400);
    const sx = await page.evaluate(() =>
      document.querySelector("[data-spotlight]")?.style.getPropertyValue("--sx")
    );
    if (sx) throw new Error(`spotlight var set under reduced motion: "${sx}"`);
  });

  await ctx.close();
}

await browser.close();

console.log(`\n${passed} passed, ${failed} failed`);
if (issues.length) {
  console.log("\nIssues:");
  for (const i of issues) console.log(`  - ${i}`);
  process.exit(1);
}
console.log("Landing suite clean.");
