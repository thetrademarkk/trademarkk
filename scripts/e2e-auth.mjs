/**
 * Auth lane e2e — forgot-password reset, email OTP, and the GATED Google button.
 * Serve a prod build on :3100 with GOOGLE_CLIENT_ID/SECRET + RESEND/EMAIL_FROM
 * BLANK and AUTH_TEST_HOOK=1 (scripts/_authbuild.mjs does all of this):
 *
 *   1. /api/auth/config reports google:false; the onboarding hosted step renders
 *      WITHOUT a "Continue with Google" button and the email/password form works.
 *   2. Forgot-password request shows the NEUTRAL "if an account exists" message;
 *      a reset completes via a server-read token (the test hook) + new password,
 *      and the NEW password signs in (old one no longer does).
 *   3. Email OTP issue → server-read code → verify succeeds; a wrong code fails.
 *   4. 360px renders cleanly; zero console errors throughout.
 *
 *   BASE_URL=http://localhost:3100 node scripts/e2e-auth.mjs
 *
 * Cleans up ONLY its own synthetic e2e-auth-* users. NEVER touches
 * demo@trademark.app / raashish1601@gmail.com / mahajandeepakshi03@gmail.com.
 */
import { chromium } from "playwright";
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";

function loadEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? "";
    }
  } catch {
    /* rely on real env */
  }
}
loadEnv();

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const TS = Date.now();
const PASSWORD = "e2e-Passw0rd-123";
const NEW_PASSWORD = "e2e-NewPassw0rd-456";
const PROTECTED = ["demo@trademark.app", "raashish1601@gmail.com", "mahajandeepakshi03@gmail.com"];

const userReset = { email: `e2e-auth-${TS}-reset@example.com`, name: "E2E Auth Reset" };
const userOtp = { email: `e2e-auth-${TS}-otp@example.com`, name: "E2E Auth OTP" };
const userLogin = { email: `e2e-auth-${TS}-login@example.com`, name: "E2E Auth Login" };
const allEmails = [userReset.email, userOtp.email, userLogin.email];

const dbClient = () => {
  const url = process.env.TURSO_PLATFORM_DB_URL;
  const token = process.env.TURSO_PLATFORM_DB_TOKEN;
  if (!url || !token) return null;
  return createClient({ url: url.replace(/^libsql:\/\//, "https://"), authToken: token });
};

const issues = [];
let failed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    issues.push(`[step] ${name} :: ${String(e.message).slice(0, 240)}`);
    console.log(`  FAIL ${name}: ${String(e.message).slice(0, 240)}`);
  }
};

const consoleErrors = [];
const attachConsole = (page) => {
  // The first /api/db/token 404 is BY DESIGN (the client uses it to detect
  // "not provisioned yet"). The browser logs a generic "Failed to load
  // resource" with no URL in the message, so track the latest 404'd URL and
  // ignore that one expected probe.
  let last404Url = "";
  page.on("response", (r) => {
    if (r.status() === 404) last404Url = r.url();
  });
  page.on("dialog", (d) => d.accept());
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/Failed to load resource/i.test(t) && /\/api\/db\/token/.test(last404Url)) return;
    consoleErrors.push(`[console] ${page.url()} :: ${t.slice(0, 200)}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`[pageerror] ${String(e.message).slice(0, 200)}`));
};

const clearRateLimits = async () => {
  const db = dbClient();
  if (!db) return;
  await db.execute(
    `DELETE FROM rate_limits WHERE key LIKE 'su:%' OR key LIKE 'si:%' OR key LIKE 'fp:%' OR key LIKE 'otp%'`
  );
};

const apiSignup = async (api, user) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    await clearRateLimits();
    const res = await api.post(`${BASE}/api/auth/sign-up/email`, {
      data: { email: user.email, password: PASSWORD, name: user.name },
      headers: { origin: BASE },
    });
    if (res.status() === 429) {
      await new Promise((r) => setTimeout(r, 12000));
      continue;
    }
    if (![200, 201].includes(res.status()))
      throw new Error(
        `sign-up ${user.email} failed: ${res.status()} ${(await res.text()).slice(0, 120)}`
      );
    return;
  }
  throw new Error(`sign-up ${user.email} kept rate-limiting`);
};

/** Creates a user via the API in a THROWAWAY context so its session cookie
 *  never bleeds into the signed-out UI context that drives the form. */
const apiSignupIsolated = async (user) => {
  const ctx = await browser.newContext();
  try {
    await apiSignup(ctx.request, user);
  } finally {
    await ctx.close();
  }
};

const readToken = async (api, email, kind) => {
  const res = await api.get(
    `${BASE}/api/auth/test-token?email=${encodeURIComponent(email)}&kind=${kind}`,
    {
      headers: { origin: BASE },
    }
  );
  if (!res.ok()) throw new Error(`test-token ${kind} returned ${res.status()}`);
  return (await res.json()).value;
};

const browser = await chromium.launch();

// Authenticated contexts that may have provisioned a hosted Turso DB — deleted
// via the in-app account-delete API at the end (which also tears the DB down).
const authedCtxs = [];

const deleteViaApi = async (ctx) => {
  try {
    await ctx.request.post(`${BASE}/api/account/delete`, { headers: { origin: BASE } });
  } catch {
    /* fall back to direct DB cleanup below */
  }
};

try {
  console.log(`Auth e2e on ${BASE}`);

  // ── 1. Google GATE: config reports false + no button + login form works ──
  await step("/api/auth/config reports google:false (creds absent)", async () => {
    const ctx = await browser.newContext();
    const res = await ctx.request.get(`${BASE}/api/auth/config`, { headers: { origin: BASE } });
    if (!res.ok()) throw new Error(`status ${res.status()}`);
    const body = await res.json();
    if (body.google !== false)
      throw new Error(`expected google:false, got ${JSON.stringify(body)}`);
    await ctx.close();
  });

  await step("server Google init refuses when unconfigured (Provider not found)", async () => {
    const ctx = await browser.newContext();
    const res = await ctx.request.post(`${BASE}/api/auth/sign-in/social`, {
      data: { provider: "google", callbackURL: "/app/onboarding" },
      headers: { "content-type": "application/json", origin: BASE },
    });
    // With Google unregistered the social init must NOT yield an accounts.google.com URL.
    const text = await res.text();
    if (text.includes("accounts.google.com"))
      throw new Error(`Google init produced a real OAuth URL despite absent creds`);
    await ctx.close();
  });

  await step("onboarding hosted step: NO Google button, email/password form present", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
    const page = await ctx.newPage();
    attachConsole(page);
    await page.goto(`${BASE}/app/onboarding`, { waitUntil: "domcontentloaded" });
    await page.getByText("Start free — we host it").click();
    await page.getByText("Create your free account").waitFor({ timeout: 15000 });
    // The email/password form must be there.
    await page.getByPlaceholder("you@example.com").waitFor({ timeout: 10000 });
    // The Google button must be ABSENT.
    const googleVisible = await page
      .getByRole("button", { name: /Continue with Google/i })
      .isVisible()
      .catch(() => false);
    if (googleVisible) throw new Error("Google button rendered despite absent creds");
    await ctx.close();
  });

  // ── Login still works via the UI (signup via API in an isolated context, then
  //    sign in through the form in a FRESH signed-out context) ──
  await step("email/password login works end to end via the UI", async () => {
    await apiSignupIsolated(userLogin);
    const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
    const page = await ctx.newPage();
    attachConsole(page);
    await page.goto(`${BASE}/app/onboarding`, { waitUntil: "domcontentloaded" });
    await page.getByText("Start free — we host it").click();
    await page.getByText("Create your free account").waitFor({ timeout: 15000 });
    // Switch to sign-in mode.
    await page.getByText("Already have an account?").click();
    await page.getByPlaceholder("you@example.com").fill(userLogin.email);
    await page.getByPlaceholder("8+ characters").fill(PASSWORD);
    await clearRateLimits();
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    // Sign-in succeeded once the AuthForm gives way to the signed-in hosted step,
    // which greets the user by email ("Signed in as <email>") with a Continue
    // button. Asserting that proves login worked without depending on Turso
    // provisioning latency.
    await page.getByText(`Signed in as`).waitFor({ timeout: 60000 });
    await page.getByText(userLogin.email).first().waitFor({ timeout: 10000 });
    // The sign-in form must be gone.
    const formStillThere = await page
      .getByRole("button", { name: "Sign in", exact: true })
      .isVisible()
      .catch(() => false);
    if (formStillThere) throw new Error("sign-in form still visible after submit (login failed)");
    // Keep the authed context so cleanup can delete the account (tears down any
    // provisioned Turso DB) via the in-app API.
    authedCtxs.push(ctx);
  });

  // ── 2. Forgot-password: neutral message + reset completes via server token ──
  await step("forgot-password request shows the NEUTRAL message", async () => {
    await apiSignupIsolated(userReset);
    const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
    const page = await ctx.newPage();
    attachConsole(page);
    await page.goto(`${BASE}/app/onboarding`, { waitUntil: "domcontentloaded" });
    await page.getByText("Start free — we host it").click();
    await page.getByText("Create your free account").waitFor({ timeout: 15000 });
    await page.getByText("Already have an account?").click();
    await page.getByText("Forgot password?").click();
    await page.getByPlaceholder("you@example.com").fill(userReset.email);
    await clearRateLimits();
    await page.getByRole("button", { name: "Send reset link" }).click();
    await page.getByText(/if an account exists/i).waitFor({ timeout: 15000 });
    await ctx.close();
  });

  await step("reset completes via server-read token + new password signs in", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
    const api = ctx.request;
    await clearRateLimits();
    // Trigger a reset request (the email no-ops; the token lands in the DB).
    const reqRes = await api.post(`${BASE}/api/auth/request-password-reset`, {
      data: { email: userReset.email, redirectTo: "/reset-password" },
      headers: { "content-type": "application/json", origin: BASE },
    });
    if (![200, 201].includes(reqRes.status()))
      throw new Error(`request-password-reset status ${reqRes.status()}`);
    const token = await readToken(api, userReset.email, "reset");
    if (!token) throw new Error("no reset token found via test hook");

    const page = await ctx.newPage();
    attachConsole(page);
    await page.goto(`${BASE}/reset-password?token=${encodeURIComponent(token)}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByText("Set a new password").waitFor({ timeout: 15000 });
    await page.locator("#rp-password").fill(NEW_PASSWORD);
    await page.locator("#rp-confirm").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Update password" }).click();
    await page.getByText(/Password updated/i).waitFor({ timeout: 15000 });

    // New password signs in; the old one no longer does.
    await clearRateLimits();
    const ok = await api.post(`${BASE}/api/auth/sign-in/email`, {
      data: { email: userReset.email, password: NEW_PASSWORD },
      headers: { origin: BASE },
    });
    if (ok.status() !== 200) throw new Error(`new password did not sign in: ${ok.status()}`);
    await clearRateLimits();
    const old = await api.post(`${BASE}/api/auth/sign-in/email`, {
      data: { email: userReset.email, password: PASSWORD },
      headers: { origin: BASE },
    });
    if (old.status() === 200) throw new Error("OLD password still signs in after reset");
    await ctx.close();
  });

  // ── 3. Email OTP issue → server-read code → verify (and wrong code fails) ──
  await step("email OTP issue → server-read code → verify succeeds", async () => {
    const ctx = await browser.newContext();
    const api = ctx.request;
    await apiSignup(api, userOtp);
    await clearRateLimits();
    const sendRes = await api.post(`${BASE}/api/auth/email-otp/send-verification-otp`, {
      data: { email: userOtp.email, type: "email-verification" },
      headers: { "content-type": "application/json", origin: BASE },
    });
    if (![200, 201].includes(sendRes.status()))
      throw new Error(`send-verification-otp status ${sendRes.status()}`);
    const code = await readToken(api, userOtp.email, "otp");
    if (!code || !/^\d{6}$/.test(code)) throw new Error(`bad OTP from hook: ${code}`);

    // Wrong code is rejected.
    const wrong = await api.post(`${BASE}/api/auth/email-otp/verify-email`, {
      data: { email: userOtp.email, otp: "000000" },
      headers: { "content-type": "application/json", origin: BASE },
    });
    if (wrong.status() === 200) throw new Error("wrong OTP unexpectedly verified");

    // Correct code verifies the email.
    const good = await api.post(`${BASE}/api/auth/email-otp/verify-email`, {
      data: { email: userOtp.email, otp: code },
      headers: { "content-type": "application/json", origin: BASE },
    });
    if (![200, 201].includes(good.status()))
      throw new Error(
        `correct OTP failed to verify: ${good.status()} ${(await good.text()).slice(0, 120)}`
      );
    await ctx.close();
  });

  // ── 4. 360px renders cleanly (mobile auth surface) ──
  await step("auth surface renders cleanly at 360px (no horizontal overflow)", async () => {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } });
    const page = await ctx.newPage();
    attachConsole(page);
    await page.goto(`${BASE}/app/onboarding`, { waitUntil: "domcontentloaded" });
    await page.getByText("Start free — we host it").click();
    await page.getByText("Create your free account").waitFor({ timeout: 15000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    if (overflow > 2) throw new Error(`horizontal overflow at 360px: ${overflow}px`);
    // The reset page too.
    await page.goto(`${BASE}/reset-password?token=probe`, { waitUntil: "domcontentloaded" });
    await page.getByText("Set a new password").waitFor({ timeout: 10000 });
    const ov2 = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    if (ov2 > 2) throw new Error(`reset page horizontal overflow at 360px: ${ov2}px`);
    await ctx.close();
  });

  // ── 5. Zero console errors throughout ──
  await step("zero console errors", async () => {
    if (consoleErrors.length) throw new Error(consoleErrors.join(" | "));
  });
} finally {
  // ── Cleanup: delete ONLY this run's synthetic users. ──
  // First, in-app account delete for any provisioned context (tears down DBs).
  for (const ctx of authedCtxs) {
    await clearRateLimits();
    await deleteViaApi(ctx);
  }
  // Then a direct-DB sweep for the rest (users that never provisioned).
  const db = dbClient();
  if (db) {
    for (const email of allEmails) {
      if (PROTECTED.includes(email)) continue; // belt-and-suspenders
      const u = await db.execute({ sql: `SELECT id FROM user WHERE email = ?`, args: [email] });
      const uid = u.rows[0]?.id;
      if (!uid) continue;
      await db.execute({
        sql: `DELETE FROM verification WHERE value = ? OR identifier LIKE ?`,
        args: [uid, `%${email}`],
      });
      await db.execute({ sql: `DELETE FROM user_databases WHERE user_id = ?`, args: [uid] });
      await db.execute({ sql: `DELETE FROM profiles WHERE user_id = ?`, args: [uid] });
      await db.execute({ sql: `DELETE FROM session WHERE user_id = ?`, args: [uid] });
      await db.execute({ sql: `DELETE FROM account WHERE user_id = ?`, args: [uid] });
      await db.execute({ sql: `DELETE FROM user WHERE id = ?`, args: [uid] });
    }
    await db.execute(
      `DELETE FROM rate_limits WHERE key LIKE 'su:%' OR key LIKE 'si:%' OR key LIKE 'fp:%' OR key LIKE 'otp%'`
    );
  }
  await browser.close();
}

if (issues.length) {
  console.log(`\n${failed} step(s) failed; ${issues.length} issue(s):`);
  for (const i of issues) console.log("  " + i);
  process.exit(1);
}
console.log("\nAuth e2e passed (reset + OTP + gated Google; zero console errors).");
