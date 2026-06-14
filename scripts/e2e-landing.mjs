/**
 * Landing/platform e2e suite (v4): restored v1 animated hero mock (rolling
 * NumberFlow tickers + rule ticks), time-to-log stats band (live metrics
 * strip removed), autoplaying demo video (lazy + pause-offscreen + unmute
 * toggle), cursor spotlight/card glow, reduced-motion fallbacks, the public
 * /pulse stats page, and admin authz + redesigned admin shell. Console errors
 * anywhere fail the run.
 *
 * Run (app already serving):
 *   BASE_URL=http://localhost:3500 node scripts/e2e-landing.mjs
 *
 * The signed-in admin-shell steps run only against localhost and expect the
 * server's ADMIN_EMAILS to include e2e-landing-admin@example.com. Against a
 * prod URL those steps are skipped — every anonymous step still runs.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const LOCAL = ["localhost", "127.0.0.1"].includes(new URL(BASE).hostname);
const TS = Date.now();
// Env-overridable; defaults are throwaway localhost values (the test server's
// ADMIN_EMAILS must include ADMIN_EMAIL).
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "e2e-landing-admin@example.com";
const USER_EMAIL = `e2e-landing-user-${TS}@example.com`;
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-Landing-12345";
const HJSON = { "Content-Type": "application/json", Origin: BASE };

const issues = [];
let passed = 0;
let failed = 0;
let skipped = 0;

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
const skip = (name) => {
  skipped++;
  console.log(`  skip ${name} (localhost only)`);
};
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const videoState = (page) =>
  page.evaluate(() => {
    const v = document.querySelector('[data-testid="walkthrough-video"]');
    return v ? { paused: v.paused, muted: v.muted, loop: v.loop, inline: v.playsInline } : null;
  });

/** Better Auth rate-limits sign-ups — retry with backoff. 422 = exists → sign in. */
async function signUpOrIn(email, name) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${BASE}/api/auth/sign-up/email`, {
      method: "POST",
      headers: HJSON,
      body: JSON.stringify({ email, password: PASSWORD, name }),
    });
    if (res.ok || res.status === 422) {
      const final = res.ok
        ? res
        : await fetch(`${BASE}/api/auth/sign-in/email`, {
            method: "POST",
            headers: HJSON,
            body: JSON.stringify({ email, password: PASSWORD }),
          });
      if (!final.ok) throw new Error(`auth ${email} failed: ${final.status}`);
      const cookie = final.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      return cookie;
    }
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 12_000));
      continue;
    }
    throw new Error(`signup ${email} failed: ${res.status} ${await res.text()}`);
  }
  throw new Error(`signup ${email}: still 429 after retries`);
}

const authed = (cookie) => (path, init) =>
  fetch(`${BASE}${path}`, { ...init, headers: { ...HJSON, cookie, ...init?.headers } });

async function contextWithCookies(browser, cookie) {
  const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
  const cookies = cookie
    .split("; ")
    .map((pair) => {
      const i = pair.indexOf("=");
      if (i <= 0) return null; // skip empty / nameless segments — Playwright rejects them
      return { name: pair.slice(0, i).trim(), value: pair.slice(i + 1), url: BASE };
    })
    .filter((c) => c && c.name);
  await ctx.addCookies(cookies);
  return ctx;
}

const browser = await chromium.launch();

// ── Default context: motion allowed ──
{
  const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
  const page = await ctx.newPage();
  watch(page);

  // The strip used to fetch /api/public/stats from the landing page — its
  // removal means that request must never fire here again.
  let publicStatsRequests = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/public/stats")) publicStatsRequests++;
  });

  console.log("— Landing (motion) —");
  await step("hero animated mock renders (KPIs, rules, chrome title)", async () => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const mock = page.getByTestId("hero-showcase");
    await mock.waitFor({ timeout: 15000 });
    for (const text of [
      "TradeMarkk — Dashboard",
      "Equity curve",
      "Today's rules",
      "Risk max 1% per trade",
      "No trades first 15 min",
      "SL before entry",
    ]) {
      if (!(await mock.getByText(text).first().isVisible())) throw new Error(`missing "${text}"`);
    }
    // Each KPI tile carries the formatted value as an aria-label (NumberFlow's
    // animated digits are aria-hidden), so screen readers announce the number.
    for (const label of ["₹18,920", "67%", "2.1R"]) {
      if ((await mock.locator(`[aria-label="${label}"]`).count()) === 0)
        throw new Error(`missing ticker "${label}"`);
    }
  });

  await step("hero is animated — tickers roll and rules tick over", async () => {
    const mock = page.getByTestId("hero-showcase");
    // Rule ticks cycle on a 1.3s interval after a 4s anti-jank warmup.
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="hero-showcase"]');
        return el && el.querySelectorAll("span.border-profit").length > 0;
      },
      { timeout: 12000 }
    );
    // Scene rollover swaps the P&L ticker to the next value (2.6s interval).
    await mock.locator('[aria-label="₹15,780"]').waitFor({ timeout: 12000 });
  });

  await step("hero screenshot stays gone (mock, not an <img>)", async () => {
    const shots = await page.locator('img[src*="/landing/dashboard"]').count();
    if (shots !== 0) throw new Error(`found ${shots} screenshot <img>s`);
  });

  await step("live metrics strip is gone; no /api/public/stats call", async () => {
    if ((await page.getByTestId("metrics-strip").count()) !== 0)
      throw new Error("metrics-strip still rendered");
    if ((await page.locator('section[aria-label="Live platform metrics"]').count()) !== 0)
      throw new Error("metrics section still rendered");
    if (publicStatsRequests > 0)
      throw new Error(`landing still fetched /api/public/stats ×${publicStatsRequests}`);
  });

  await step("time-to-log stats band restored (<15s to log a trade)", async () => {
    const band = page.locator('section[aria-label="At a glance"]');
    await band.waitFor({ timeout: 10000 });
    for (const text of ["<15s", "to log a trade", "₹0", "cost, forever"]) {
      if (!(await band.getByText(text).first().isVisible())) throw new Error(`missing "${text}"`);
    }
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

  // ── SEO / metadata ──
  console.log("— SEO —");
  await step("refreshed feature pillars cover the full product", async () => {
    // The grown feature set must be reflected honestly on the landing page.
    for (const text of [
      "Every trader type, multi-leg included",
      "Paise-accurate Indian charges & tax pack",
      "Insights, tilt & Monte-Carlo",
      "Multi-broker Chrome extension",
      "Backtesting",
    ]) {
      if ((await page.getByText(text, { exact: false }).count()) === 0)
        throw new Error(`missing feature pillar "${text}"`);
    }
    // Backtesting is honestly framed as upcoming.
    if ((await page.getByText("Coming soon", { exact: false }).count()) === 0)
      throw new Error("backtesting is not framed as coming soon");
  });

  await step("primary CTAs link to the app and GitHub", async () => {
    const start = page.getByRole("link", { name: /Start free/ }).first();
    if ((await start.getAttribute("href")) !== "/app/onboarding")
      throw new Error("Start free does not link to /app/onboarding");
    const demo = page.getByRole("link", { name: /Try the live demo/ });
    if (!/\/app\/onboarding\?mode=demo$/.test((await demo.getAttribute("href")) ?? ""))
      throw new Error("demo CTA missing ?mode=demo");
    // "Star on GitHub" appears in both the CTA band and the footer — assert
    // every instance points at GitHub rather than relying on a single match.
    const stars = page.getByRole("link", { name: /Star on GitHub/ });
    const starCount = await stars.count();
    if (starCount === 0) throw new Error("no Star on GitHub link");
    for (let i = 0; i < starCount; i++) {
      if (!/github\.com/.test((await stars.nth(i).getAttribute("href")) ?? ""))
        throw new Error("a Star on GitHub link does not point at GitHub");
    }
  });

  await step("<head> carries canonical, description, OG and Twitter tags", async () => {
    const meta = await page.evaluate(() => ({
      title: document.title,
      desc: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "",
      ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? "",
      ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? "",
      ogType: document.querySelector('meta[property="og:type"]')?.getAttribute("content") ?? "",
      twCard: document.querySelector('meta[name="twitter:card"]')?.getAttribute("content") ?? "",
      twImage: document.querySelector('meta[name="twitter:image"]')?.getAttribute("content") ?? "",
    }));
    if (!/TradeMarkk/.test(meta.title)) throw new Error(`title missing brand: "${meta.title}"`);
    if (meta.desc.length < 50) throw new Error("description too short / missing");
    if (!/\/$|thetrademarkk|localhost/.test(meta.canonical))
      throw new Error(`canonical not set: "${meta.canonical}"`);
    if (!meta.ogTitle) throw new Error("og:title missing");
    if (!/opengraph-image|\.png/.test(meta.ogImage))
      throw new Error(`og:image missing: "${meta.ogImage}"`);
    if (meta.ogType !== "website") throw new Error(`og:type not website: "${meta.ogType}"`);
    if (meta.twCard !== "summary_large_image")
      throw new Error("twitter:card not summary_large_image");
    if (!meta.twImage) throw new Error("twitter:image missing");
  });

  await step("JSON-LD graph present (Organization + WebSite + SoftwareApplication)", async () => {
    const blocks = await page.$$eval('script[type="application/ld+json"]', (els) =>
      els.map((e) => e.textContent ?? "")
    );
    if (blocks.length === 0) throw new Error("no JSON-LD script found");
    const types = new Set();
    for (const raw of blocks) {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("JSON-LD did not parse");
      }
      const nodes = parsed["@graph"] ?? [parsed];
      for (const n of nodes) types.add(n["@type"]);
    }
    for (const t of ["Organization", "WebSite", "SoftwareApplication"]) {
      if (!types.has(t))
        throw new Error(`JSON-LD missing @type ${t} (got ${[...types].join(", ")})`);
    }
  });

  await step("/robots.txt and /sitemap.xml resolve with the sitemap ref", async () => {
    const robotsRes = await fetch(`${BASE}/robots.txt`);
    if (!robotsRes.ok) throw new Error(`robots.txt → ${robotsRes.status}`);
    const robotsTxt = await robotsRes.text();
    if (!/Sitemap:/i.test(robotsTxt)) throw new Error("robots.txt missing Sitemap ref");
    if (!/Disallow:\s*\/app/.test(robotsTxt)) throw new Error("robots.txt does not disallow /app");
    const smRes = await fetch(`${BASE}/sitemap.xml`);
    if (!smRes.ok) throw new Error(`sitemap.xml → ${smRes.status}`);
    const sm = await smRes.text();
    for (const path of ["/features", "/community", "/privacy"]) {
      if (!sm.includes(path)) throw new Error(`sitemap.xml missing ${path}`);
    }
  });

  // ── Pulse: public stats page ──
  console.log("— Pulse —");
  await step("/pulse renders with real aggregates (traders > 0)", async () => {
    await page.goto(`${BASE}/pulse`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /Platform Pulse/ }).waitFor({ timeout: 15000 });
    const traders = await page
      .locator('[data-pulse-stat="Registered traders"]')
      .innerText({ timeout: 10000 });
    const n = Number(traders.replace(/[^\d]/g, ""));
    if (!Number.isFinite(n) || n <= 0)
      throw new Error(`traders KPI not a real count: "${traders}"`);
    for (const label of ["Active · 30 days", "Page views · 30 days", "Community posts"]) {
      if ((await page.locator(`[data-pulse-stat="${label}"]`).count()) === 0)
        throw new Error(`missing KPI "${label}"`);
    }
  });

  await step("/pulse trend charts render (signups, views, posts, top pages)", async () => {
    for (const id of [
      "pulse-chart-signups",
      "pulse-chart-views",
      "pulse-chart-posts",
      "pulse-top-pages",
    ]) {
      await page.getByTestId(id).scrollIntoViewIfNeeded();
      await page.getByTestId(id).waitFor({ timeout: 10000 });
    }
    // recharts mounts an svg once the responsive container has a size.
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="pulse-chart-signups"] svg.recharts-surface') !== null,
      { timeout: 10000 }
    );
  });

  await step("/pulse web vitals cards — P75 or honest empty state", async () => {
    const cards = page.locator("[data-vital]");
    if ((await cards.count()) !== 5)
      throw new Error(`expected 5 vital cards, got ${await cards.count()}`);
    for (const metric of ["LCP", "INP", "CLS", "FCP", "TTFB"]) {
      const card = page.locator(`[data-vital="${metric}"]`);
      const text = await card.innerText();
      if (!/P75|No field samples yet/.test(text))
        throw new Error(`${metric} card shows neither a P75 nor the empty state`);
    }
  });

  await step("/pulse is linked from the header nav", async () => {
    const link = page.locator('header nav a[href="/pulse"]');
    if ((await link.count()) === 0) throw new Error("no /pulse link in header nav");
    if ((await link.getAttribute("aria-current")) !== "page")
      throw new Error("Pulse nav link not marked active on /pulse");
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
  await step("reduced motion: hero mock shows its finished state", async () => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const mock = page.getByTestId("hero-showcase");
    await mock.waitFor({ timeout: 15000 });
    if ((await mock.locator('[aria-label="₹18,920"]').count()) === 0)
      throw new Error("P&L ticker hidden");
    // All three rules arrive pre-ticked instead of cycling.
    const ticked = await mock.locator("span.border-profit").count();
    if (ticked !== 3) throw new Error(`expected 3 pre-ticked rules, got ${ticked}`);
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

// ── Mobile: no horizontal overflow at small widths ──
console.log("— Mobile —");
for (const width of [360, 390]) {
  await step(`landing has no horizontal overflow at ${width}px`, async () => {
    const ctx = await browser.newContext({ viewport: { width, height: 780 } });
    const page = await ctx.newPage();
    watch(page);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    // Allow a 1px sub-pixel rounding slack.
    if (overflow > 1) throw new Error(`horizontal overflow of ${overflow}px at this width`);
    // The hero CTAs must stay reachable on a phone.
    if (
      !(await page
        .getByRole("link", { name: /Start free/ })
        .first()
        .isVisible())
    )
      throw new Error("Start free CTA not visible on mobile");
    await ctx.close();
  });
}

// ── Admin authz ──
console.log("— Admin —");

await step("signed-out /admin redirects to onboarding", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await page.waitForURL("**/app/onboarding", { timeout: 15000 });
  await ctx.close();
});

await step("anonymous admin APIs → 403", async () => {
  for (const path of ["/api/admin/overview", "/api/admin/reports"]) {
    const res = await fetch(`${BASE}${path}`);
    expect(res.status === 403, `${path} → ${res.status}, expected 403`);
  }
});

if (!LOCAL) {
  skip("non-admin user is rejected (page + APIs)");
  skip("admin sees the redesigned shell (all four sections)");
  skip("cleanup: delete e2e users");
} else {
  let userCookie = null;
  let adminCookie = null;

  await step("non-admin user is rejected (page + APIs)", async () => {
    userCookie = await signUpOrIn(USER_EMAIL, "E2E Landing User");
    const me = authed(userCookie);
    for (const path of ["/api/admin/overview", "/api/admin/reports"]) {
      const res = await me(path);
      expect(res.status === 403, `${path} as non-admin → ${res.status}, expected 403`);
    }
    const ctx = await contextWithCookies(browser, userCookie);
    const page = await ctx.newPage();
    watch(page);
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await page.getByText("Not authorized").waitFor({ timeout: 15000 });
    expect(
      (await page.getByText("Total users").count()) === 0,
      "non-admin can see admin analytics"
    );
    await ctx.close();
  });

  await step("admin sees the redesigned shell (all four sections)", async () => {
    adminCookie = await signUpOrIn(ADMIN_EMAIL, "E2E Landing Admin");
    const ctx = await contextWithCookies(browser, adminCookie);
    const page = await ctx.newPage();
    watch(page);
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });

    // Overview is the default pane: stat cards + charts from first-party data.
    await page.getByText("Total users").waitFor({ timeout: 20000 });
    await page.getByText("Active users · 7d").waitFor();

    const nav = page.getByRole("navigation", { name: "Admin sections" });
    for (const label of ["Overview", "Moderation", "Blog review", "Feedback"]) {
      if ((await nav.getByRole("button", { name: label }).count()) === 0)
        throw new Error(`nav missing "${label}"`);
    }

    await nav.getByRole("button", { name: "Moderation" }).click();
    await page
      .getByText(/Moderation queue is clear|reported by/)
      .first()
      .waitFor({ timeout: 15000 });

    await nav.getByRole("button", { name: "Blog review" }).click();
    await page.getByRole("tab", { name: "pending" }).waitFor({ timeout: 15000 });

    await nav.getByRole("button", { name: "Feedback" }).click();
    await page.getByRole("tab", { name: /^all/ }).waitFor({ timeout: 15000 });
    await ctx.close();
  });

  await step("cleanup: delete e2e users", async () => {
    for (const cookie of [userCookie, adminCookie]) {
      if (!cookie) continue;
      const res = await authed(cookie)("/api/account/delete", { method: "POST" });
      expect(res.ok, `account delete → ${res.status}`);
    }
  });
}

await browser.close();

console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}`);
if (issues.length) {
  console.log("\nIssues:");
  for (const i of issues) console.log(`  - ${i}`);
  process.exit(1);
}
console.log("Landing suite clean.");
