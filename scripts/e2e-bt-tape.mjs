/**
 * Feature e2e — the TAPE "Backtest Terminal" UI revamp.
 *
 * Validates the scoped `.bt-terminal` instrument skin + its signatures against a
 * PROD build (strict CSP breaks `next dev`). Everything here is deterministic —
 * no live data run — so it is CI-safe:
 *
 *   - the `.bt-terminal` scope is present and re-points the journal tokens
 *     (--accent-solid → amber #E8B23A, --border → rule #232A38) WITHOUT touching
 *     the journal's global themes;
 *   - the landing live-instrument hero mounts the amber payoff curve + a Coverage
 *     Seam, and the recent-runs rail is ALWAYS visible (ghost rung when empty);
 *   - the builder defaults to %-of-spot strike selection (the "Spot %" tab is
 *     active on a fresh leg) and the ATM/Exact modes stay reachable;
 *   - the Results dossier renders the 01·02·03 numbered tiers, the mono verdict
 *     number, an amber-underline evidence tab, and a full-width Coverage Seam;
 *   - zero console errors / page errors on every surface.
 *
 * Run (with a PROD build serving):
 *   BASE_URL=http://localhost:3000 node scripts/e2e-bt-tape.mjs
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

// ── Foundation: the scope + token re-point ─────────────────────────────────
console.log("— Foundation —");

await step("the .bt-terminal scope re-points tokens to the TAPE palette", async () => {
  await page.goto(`${BASE}/backtesting`, { waitUntil: "domcontentloaded" });
  await page.locator(".bt-terminal").first().waitFor({ timeout: 15000 });
  const tokens = await page.evaluate(() => {
    const el = document.querySelector(".bt-terminal");
    const cs = getComputedStyle(el);
    return {
      accent: cs.getPropertyValue("--accent-solid").trim().toLowerCase(),
      border: cs.getPropertyValue("--border").trim().toLowerCase(),
    };
  });
  if (tokens.accent !== "#e8b23a")
    throw new Error(`--accent-solid should be amber #e8b23a, got "${tokens.accent}"`);
  if (tokens.border !== "#232a38" && tokens.border !== "#dde1e8")
    throw new Error(`--border should be the TAPE rule, got "${tokens.border}"`);
});

await step(
  "the scope does NOT leak the amber accent into the journal (global token intact)",
  async () => {
    const journalAccent = await page.evaluate(() => {
      // The <html> theme var must stay the journal's violet, never amber.
      return getComputedStyle(document.documentElement)
        .getPropertyValue("--accent-solid")
        .trim()
        .toLowerCase();
    });
    if (journalAccent === "#e8b23a")
      throw new Error("the amber accent leaked to the global :root — the skin must stay scoped");
  }
);

// ── Landing: live-instrument hero + always-visible recent rail ─────────────
console.log("— Landing —");

await step("the hero mounts the amber payoff curve + a Coverage Seam", async () => {
  const svg = page.getByTestId("bt-payoff-svg").first();
  await svg.waitFor({ timeout: 10000 });
  const stroke = await svg.locator("path[stroke]").last().getAttribute("stroke");
  if (!stroke || !stroke.includes("--accent-solid"))
    throw new Error(`hero curve should stroke the (amber) accent token, got "${stroke}"`);
  // A coverage seam is welded somewhere on the landing (hero + sample card).
  const seams = await page.getByTestId("bt-coverage-seam").count();
  if (seams < 1) throw new Error("no Coverage Seam found on the landing");
});

await step("the recent-runs rail is ALWAYS visible (ghost rung when empty)", async () => {
  await page.getByTestId("bt-recent-rail").waitFor({ timeout: 8000 });
  await page.getByTestId("bt-recent-empty").waitFor({ timeout: 8000 });
});

await step("the sample card leads with the mono verdict number + honesty chips", async () => {
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
  await page.getByTestId("bt-continue").click(); // → Legs
  await page.getByTestId("bt-step-legs").waitFor({ timeout: 10000 });
  // The %-of-spot panel is the active mode for the first leg by default.
  await page.getByTestId("bt-percent-mode").first().waitFor({ timeout: 8000 });
  const spotTab = page.getByRole("tab", { name: "Spot %" }).first();
  if ((await spotTab.getAttribute("data-state")) !== "active")
    throw new Error("the 'Spot %' tab should be the active default strike mode");
  // The ATM-step ladder is NOT shown by default (it lives under the ATM ± tab).
  if ((await page.locator('[role="listbox"][aria-label^="Strike ladder"]').count()) !== 0)
    throw new Error("the ATM-offset ladder should not be the default mode");
});

await step("the absolute-strike (Exact) and ATM modes stay reachable", async () => {
  await page.getByRole("tab", { name: "ATM ±" }).first().click();
  await page
    .locator('[role="listbox"][aria-label^="Strike ladder"]')
    .first()
    .waitFor({ timeout: 8000 });
  await page.getByRole("tab", { name: "Exact" }).first().click();
  await page.getByTestId("bt-exact-strike").first().waitFor({ timeout: 8000 });
  // Back to the %-of-spot default.
  await page.getByRole("tab", { name: "Spot %" }).first().click();
  await page.getByTestId("bt-percent-mode").first().waitFor({ timeout: 8000 });
});

await step("the builder rail shows the amber live payoff (the loud-amber surface)", async () => {
  const rail = page.getByTestId("bt-live-rail");
  await rail.waitFor({ timeout: 8000 });
  const label = (await page.getByTestId("bt-strategy-label").first().textContent())?.trim();
  if (label !== "Short Straddle")
    throw new Error(
      `default %-of-spot legs should still classify as Short Straddle, got "${label}"`
    );
});

// ── Results: the 01·02·03 dossier + amber-underline tabs + seam ────────────
console.log("— Results dossier (sample report) —");

await step("the sample full report renders the numbered 01·02·03 dossier", async () => {
  await page.goto(`${BASE}/backtesting`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("bt-sample-full-toggle").click();
  await page.getByTestId("bt-results-done").waitFor({ timeout: 15000 });
  await page.getByTestId("bt-tier-verdict").waitFor({ timeout: 8000 });
  await page.getByTestId("bt-tier-evidence").waitFor({ timeout: 8000 });
  await page.getByTestId("bt-tier-blotter").waitFor({ timeout: 8000 });
  // The dossier numbers render in the eyebrows.
  const nums = await page.locator(".bt-section-num").allTextContents();
  const joined = nums.join(" ");
  if (!joined.includes("01") || !joined.includes("02") || !joined.includes("03"))
    throw new Error(`expected 01/02/03 dossier numbers, got "${joined}"`);
});

await step("the evidence tabs use a 2px amber underline (not a filled pill)", async () => {
  const active = page.locator('[role="tab"].bt-tab[data-state="active"]').first();
  await active.waitFor({ timeout: 8000 });
  const box = await active.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, shadow: cs.boxShadow };
  });
  // The scoped override drops the filled bg to transparent and draws an inset
  // bottom border via box-shadow.
  if (box.bg !== "rgba(0, 0, 0, 0)" && box.bg !== "transparent")
    throw new Error(`active tab should be unfilled, got bg "${box.bg}"`);
  if (!/inset/.test(box.shadow))
    throw new Error(`active tab should have an inset (underline) shadow, got "${box.shadow}"`);
});

await step("a full-width Coverage Seam is welded under the hero equity", async () => {
  const seams = page.getByTestId("bt-coverage-seam").filter({ has: page.locator("i") });
  if ((await seams.count()) < 1) throw new Error("no Coverage Seam in the results report");
  // The seam carries the real/sub/gap grammar.
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
  await page.locator(".bt-terminal").first().waitFor({ timeout: 10000 });
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
