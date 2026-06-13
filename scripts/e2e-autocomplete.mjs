/**
 * Composer autocomplete e2e: sign up -> open the inline composer -> "@" + prefix
 * suggests community users (pick inserts @handle) -> "$ni" suggests NIFTY (pick
 * inserts $NIFTY) -> "#" suggests tags -> keyboard nav (Down/Enter) inserts ->
 * 360px mobile: dropdown stays inside the field and the signed-in header does
 * not overflow -> zero console errors.
 *
 *   BASE_URL=http://localhost:3100 node scripts/e2e-autocomplete.mjs
 *
 * Leaves its own user behind for the DB-level sweep (e2e-ac-*@example.com).
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const TS = Date.now();
const EMAIL = `e2e-ac-${TS}@example.com`;
const PASSWORD = "e2e-Passw0rd-123";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
const page = await ctx.newPage();

const issues = [];
page.on("dialog", (d) => d.accept());
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const text = m.text();
  // The composer's first POST 401s by design (attempt -> sign-in gate -> retry).
  if (text.includes("401")) return;
  issues.push(`[console] ${page.url()} :: ${text.slice(0, 220)}`);
});
page.on("pageerror", (e) => issues.push(`[pageerror] ${String(e.message).slice(0, 220)}`));

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

// Better Auth rate-limits prod sign-ups - retry the create-account submit on 429.
const submitSignup = async () => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/auth/sign-up"), { timeout: 30000 }),
      page.getByRole("button", { name: "Create free account" }).click(),
    ]).catch(() => [null]);
    if (!res || res.status() !== 429) return;
    await page.waitForTimeout(12000);
  }
};

const body = () => page.getByLabel("Your post");
const listbox = () => page.getByRole("listbox", { name: "Suggestions" });

// Type a token into the body field char-by-char so the typeahead reacts.
const typeBody = async (text) => {
  await body().click();
  await page.keyboard.type(text, { delay: 30 });
};

console.log(`Autocomplete e2e on ${BASE} as ${EMAIL}`);

await step("feed renders + sign up via composer", async () => {
  await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByText("House rules").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Write a post" }).first().click();
  await body().fill("Autocomplete check — signing up first.");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await page.getByText("Join the conversation").waitFor({ timeout: 10000 });
  await page.getByPlaceholder("Your name").fill("E2E Autocomplete");
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.getByPlaceholder("8+ characters").fill(PASSWORD);
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/community/posts") &&
        r.request().method() === "POST" &&
        r.status() === 201,
      { timeout: 40000 }
    ),
    submitSignup(),
  ]);
});

await step("reopen composer for a clean body", async () => {
  // After posting the inline composer collapses; reopen it.
  await page.getByRole("button", { name: "Write a post" }).first().click();
  await body().waitFor({ timeout: 10000 });
  await body().fill("");
});

await step("@mention: typing '@raa' suggests the seeded user; pick inserts @handle", async () => {
  await typeBody("hi @raa");
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/community/autocomplete?kind=user"), {
      timeout: 10000,
    }),
    page.waitForTimeout(400), // debounce
  ]).catch(() => {});
  await listbox().waitFor({ timeout: 8000 });
  const opt = page.getByRole("option").filter({ hasText: "@raashish_aggar" }).first();
  await opt.waitFor({ timeout: 8000 });
  await opt.click();
  const val = await body().inputValue();
  if (!val.includes("@raashish_aggar ")) throw new Error(`handle not inserted: ${val}`);
});

await step("$cashtag: typing '$ni' suggests NIFTY; pick inserts $NIFTY (uppercased)", async () => {
  await typeBody("$ni");
  await listbox().waitFor({ timeout: 8000 });
  const opt = page.getByRole("option").filter({ hasText: "$NIFTY" }).first();
  await opt.waitFor({ timeout: 8000 });
  await opt.click();
  const val = await body().inputValue();
  if (!val.includes("$NIFTY ")) throw new Error(`cashtag not inserted: ${val}`);
});

await step("#hashtag: typing '#op' suggests options tag", async () => {
  await typeBody("#op");
  await listbox().waitFor({ timeout: 8000 });
  await page.getByRole("option").filter({ hasText: "#options" }).first().waitFor({ timeout: 8000 });
});

await step("keyboard nav: ArrowDown + Enter inserts a hashtag", async () => {
  // Continuing from the open #op listbox above.
  await body().click();
  // Move caret to end and ensure the token is still active.
  await page.keyboard.press("End");
  await listbox().waitFor({ timeout: 8000 });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const val = await body().inputValue();
  if (!/#[a-z0-9-]+ /.test(val)) throw new Error(`keyboard insert produced no tag: ${val}`);
});

await step("Escape closes the dropdown without inserting", async () => {
  await typeBody(" @ra");
  await listbox().waitFor({ timeout: 8000 });
  await page.keyboard.press("Escape");
  await listbox().waitFor({ state: "detached", timeout: 5000 });
});

await step("mobile 360px: dropdown stays within the composer field (no overflow)", async () => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Write a post" }).first().click();
  await body().waitFor({ timeout: 10000 });
  await body().fill("");
  await typeBody("$ban");
  await listbox().waitFor({ timeout: 8000 });
  const overflow = await page.evaluate(() => {
    const lb = document.querySelector('[role="listbox"][aria-label="Suggestions"]');
    if (!lb) return "no listbox";
    const r = lb.getBoundingClientRect();
    if (r.right > window.innerWidth + 1 || r.left < -1) return `listbox x ${r.left}..${r.right}`;
    return null;
  });
  if (overflow) throw new Error(`dropdown overflows at 360px: ${overflow}`);
});

await step("mobile 360px: signed-in community header does not overflow", async () => {
  const overflow = await page.evaluate(() => {
    const header = document.querySelector("header");
    if (!header) return "no header";
    const r = header.getBoundingClientRect();
    if (r.right > window.innerWidth + 1) return `header right ${r.right} > ${window.innerWidth}`;
    // Also confirm no horizontal document scroll the header introduces.
    if (document.documentElement.scrollWidth > window.innerWidth + 1)
      return `doc scrollWidth ${document.documentElement.scrollWidth} > ${window.innerWidth}`;
    return null;
  });
  if (overflow) throw new Error(`header overflows at 360px: ${overflow}`);
});

await browser.close();
if (issues.length) {
  console.log(`\n${failed} step(s) failed; ${issues.length} issue(s):`);
  for (const i of issues) console.log("  " + i);
  process.exit(1);
}
console.log("\nAutocomplete e2e passed (zero console errors).");
