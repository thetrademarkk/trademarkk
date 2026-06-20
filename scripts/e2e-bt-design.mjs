/**
 * Feature e2e — the backtesting universe re-based on the JOURNAL violet 4-theme
 * (the amber TAPE skin removed). Validates against a PROD build (strict CSP
 * breaks `next dev`). Deterministic — no live data run — so it is CI-safe:
 *
 *   - the old `.bt-terminal` amber scope is GONE, and backtesting reads the same
 *     journal --accent-solid (violet) as :root — no scoped re-point;
 *   - the landing hero mounts the payoff curve (violet accent) + a Coverage Seam,
 *     and the recent-runs rail is ALWAYS visible (ghost rung when empty);
 *   - the builder defaults to %-of-spot strike selection (the "Spot %" tab is
 *     active on a fresh leg) and the ATM/Exact modes stay reachable;
 *   - the Results dossier renders the 01·02·03 numbered tiers, the mono verdict
 *     figure, FILLED-PILL evidence tabs (journal style), and a Coverage Seam;
 *   - zero console / page errors; no 390px horizontal overflow.
 *
 * Run (with a PROD build serving):
 *   BASE_URL=http://localhost:3000 node scripts/e2e-bt-design.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const issues = [];
const browser = await chromium.launch();

let passed = 0;
let failed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    issues.push(`[step] ${name} :: ${String(e.message).slice(0, 260)}`);
    console.log(`  FAIL ${name}: ${String(e.message).slice(0, 260)}`);
  }
};

const wireListeners = (page) => {
  page.on("console", (m) => {
    if (m.type() === "error") issues.push(`[console] ${page.url()} :: ${m.text().slice(0, 250)}`);
  });
  page.on("pageerror", (e) =>
    issues.push(`[pageerror] ${page.url()} :: ${String(e.message).slice(0, 250)}`)
  );
};

const noOverflow = async (page) => {
  const o = await page.evaluate(() => {
    const el = document.scrollingElement;
    return { sw: el.scrollWidth, cw: el.clientWidth };
  });
  if (o.sw > o.cw + 1) throw new Error(`horizontal overflow ${o.sw} > ${o.cw}`);
};

const clearDraft = (page) =>
  page.addInitScript(() => {
    try {
      localStorage.removeItem("tmk.bt.draft.nocode");
      localStorage.removeItem("tm.trade-draft");
    } catch {}
  });

const ctx = await browser.newContext({ viewport: { width: 1380, height: 1000 } });
const page = await ctx.newPage();
wireListeners(page);

// ── Foundation: no amber scope; backtesting shares the journal violet ───────
console.log("— Foundation (de-ambered, journal violet) —");

await step(
  "the amber .bt-terminal scope is gone — backtesting uses the journal accent",
  async () => {
    await page.goto(`${BASE}/backtesting`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("bt-recent-rail").waitFor({ timeout: 15000 });
    const r = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement)
        .getPropertyValue("--accent-solid")
        .trim()
        .toLowerCase();
      const el = document.querySelector('[data-testid="bt-recent-rail"]') || document.body;
      const scoped = getComputedStyle(el).getPropertyValue("--accent-solid").trim().toLowerCase();
      return { root, scoped, hasTerminal: !!document.querySelector(".bt-terminal") };
    });
    if (r.hasTerminal) throw new Error("the .bt-terminal amber scope must be removed");
    if (r.scoped === "#e8b23a") throw new Error("backtesting still resolves the amber accent");
    if (r.scoped !== r.root)
      throw new Error(`backtesting accent (${r.scoped}) diverges from journal (${r.root})`);
  }
);

// ── Landing: live-instrument hero + always-visible recent rail ─────────────
console.log("— Landing —");

await step("the hero mounts the payoff curve (violet accent) + a Coverage Seam", async () => {
  const svg = page.getByTestId("bt-payoff-svg").first();
  await svg.waitFor({ timeout: 10000 });
  const stroke = await svg.locator("path[stroke]").last().getAttribute("stroke");
  if (!stroke || !stroke.includes("--accent-solid"))
    throw new Error(`hero curve should stroke the accent token, got "${stroke}"`);
  const seams = await page.getByTestId("bt-coverage-seam").count();
  if (seams < 1) throw new Error("no Coverage Seam found on the landing");
});

await step("the recent-runs rail is ALWAYS visible (ghost rung when empty)", async () => {
  await page.getByTestId("bt-recent-rail").waitFor({ timeout: 8000 });
  await page.getByTestId("bt-recent-empty").waitFor({ timeout: 8000 });
});

await step("the sample card leads with the mono verdict number", async () => {
  const verdict = page.locator(".bt-verdict").first();
  await verdict.waitFor({ timeout: 8000 });
  const txt = (await verdict.textContent())?.trim() ?? "";
  if (!/[\d]/.test(txt)) throw new Error(`verdict number did not render a figure: "${txt}"`);
});

// ── Builder: the %-of-spot strike default (the explicit requirement) ───────
console.log("— Builder (%-of-spot default) —");

await step("a fresh leg defaults to the 'Spot %' strike mode", async () => {
  await clearDraft(page);
  await page.goto(`${BASE}/backtesting/build`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("bt-step-setup").waitFor({ timeout: 15000 });
  await page.getByTestId("bt-continue").click();
  await page.getByTestId("bt-step-legs").waitFor({ timeout: 10000 });
  await page.getByTestId("bt-percent-mode").first().waitFor({ timeout: 8000 });
  const spotTab = page.getByRole("tab", { name: "Spot %" }).first();
  if ((await spotTab.getAttribute("data-state")) !== "active")
    throw new Error("the 'Spot %' tab should be the active default strike mode");
});

await step("the absolute-strike (Exact) and ATM modes stay reachable", async () => {
  await page.getByRole("tab", { name: "ATM ±" }).first().click();
  await page
    .locator('[role="listbox"][aria-label^="Strike ladder"]')
    .first()
    .waitFor({ timeout: 8000 });
  await page.getByRole("tab", { name: "Exact" }).first().click();
  await page.getByTestId("bt-exact-strike").first().waitFor({ timeout: 8000 });
  await page.getByRole("tab", { name: "Spot %" }).first().click();
  await page.getByTestId("bt-percent-mode").first().waitFor({ timeout: 8000 });
});

// ── Results: the 01·02·03 dossier + FILLED-PILL tabs + seam ─────────────────
console.log("— Results dossier (sample report) —");

await step("the sample full report renders the numbered 01·02·03 dossier", async () => {
  await page.goto(`${BASE}/backtesting`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("bt-sample-full-toggle").click();
  await page.getByTestId("bt-results-done").waitFor({ timeout: 15000 });
  await page.getByTestId("bt-tier-verdict").waitFor({ timeout: 8000 });
  await page.getByTestId("bt-tier-evidence").waitFor({ timeout: 8000 });
  await page.getByTestId("bt-tier-blotter").waitFor({ timeout: 8000 });
  const nums = await page.locator(".bt-section-num").allTextContents();
  const joined = nums.join(" ");
  if (!joined.includes("01") || !joined.includes("02") || !joined.includes("03"))
    throw new Error(`expected 01/02/03 dossier numbers, got "${joined}"`);
});

await step("the evidence tabs are FILLED journal pills (no amber underline)", async () => {
  const active = page.locator('[role="tab"][data-state="active"]').first();
  await active.waitFor({ timeout: 8000 });
  const box = await active.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, shadow: cs.boxShadow };
  });
  // The journal pill active state is a filled surface (non-transparent bg) — the
  // opposite of the old amber inset-underline (transparent bg + inset shadow).
  if (box.bg === "rgba(0, 0, 0, 0)" || box.bg === "transparent")
    throw new Error(`active evidence tab should be a filled pill, got bg "${box.bg}"`);
});

await step("a Coverage Seam carries the real/sub/gap grammar", async () => {
  const seams = page.getByTestId("bt-coverage-seam").filter({ has: page.locator("i") });
  if ((await seams.count()) < 1) throw new Error("no Coverage Seam in the results report");
  const kinds = await page
    .getByTestId("bt-coverage-seam")
    .first()
    .locator("i")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-seam-kind")));
  if (!kinds.includes("real"))
    throw new Error(`seam should carry a 'real' segment, got ${JSON.stringify(kinds)}`);
});

// ── Responsive: xs/mobile cleanliness ──────────────────────────────────────
console.log("— Responsive 390px —");

await step("the landing has no horizontal overflow at 390px", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/backtesting`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("bt-recent-rail").waitFor({ timeout: 10000 });
  await noOverflow(page);
});

await step("the explore grid has no horizontal overflow at 390px", async () => {
  await page.goto(`${BASE}/backtesting/explore`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("preset-grid").waitFor({ timeout: 12000 });
  await noOverflow(page);
});

await ctx.close();
await browser.close();

console.log(`\n${passed} passed, ${failed} failed`);
if (issues.length) {
  console.log(`\n— ${issues.length} issue(s) —`);
  for (const i of [...new Set(issues)]) console.log("  " + i);
  process.exit(1);
} else {
  console.log("\nNo console errors, no page errors. ✅");
}
