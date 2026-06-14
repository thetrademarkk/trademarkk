/**
 * Account & security e2e — the logged-in self-service auth surface.
 * Serve a prod build on :3200 with RESEND/EMAIL_FROM BLANK + AUTH_TEST_HOOK=1
 * and Google creds absent (scripts/diag-acct.mjs build && start do this):
 *
 *   1. Change password in the UI, then re-login with the NEW password (old fails).
 *   2. Enroll 2FA: read the otpauth secret from the QR/manual key, compute a TOTP
 *      in-test (base32-decode the URI secret), activate it. A FRESH login then
 *      hits the 2FA challenge and a one-time BACKUP CODE completes it.
 *   3. List active sessions and revoke one.
 *   4. Delete a throwaway account (type-to-confirm) — never a protected account.
 *   5. 360px renders cleanly; zero console errors throughout.
 *
 *   BASE_URL=http://localhost:3200 node scripts/e2e-account-settings.mjs
 *
 * Cleans up ONLY its own synthetic e2e-acct-* users. NEVER touches
 * demo@trademark.app / raashish1601@gmail.com / mahajandeepakshi03@gmail.com.
 */
import { chromium } from "playwright";
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";

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

const BASE = process.env.BASE_URL ?? "http://localhost:3200";
const TS = Date.now();
const PASSWORD = "e2e-Passw0rd-123";
const NEW_PASSWORD = "e2e-NewPassw0rd-456";
const PROTECTED = ["demo@trademark.app", "raashish1601@gmail.com", "mahajandeepakshi03@gmail.com"];

const userPw = { email: `e2e-acct-${TS}-pw@example.com`, name: "E2E Acct PW" };
const user2fa = { email: `e2e-acct-${TS}-2fa@example.com`, name: "E2E Acct 2FA" };
const userSess = { email: `e2e-acct-${TS}-sess@example.com`, name: "E2E Acct Sess" };
const userDel = { email: `e2e-acct-${TS}-del@example.com`, name: "E2E Acct Del" };
const allEmails = [userPw.email, user2fa.email, userSess.email, userDel.email];

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
    issues.push(`[step] ${name} :: ${String(e.message).slice(0, 280)}`);
    console.log(`  FAIL ${name}: ${String(e.message).slice(0, 280)}`);
  }
};

const consoleErrors = [];
const attachConsole = (page) => {
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
  // Scope to the limiters this flow trips (sign-up/in, reset, otp, delete, and
  // the per-user token-burst that retries can hit). Deliberately NOT a blanket
  // wipe — a parallel lane worker shares this table.
  await db.execute(
    `DELETE FROM rate_limits WHERE key LIKE 'su:%' OR key LIKE 'si:%' OR key LIKE 'fp:%' OR key LIKE 'otp%' OR key LIKE 'account-delete:%' OR key LIKE 'token-burst:%' OR key LIKE 'token:%'`
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

/**
 * Mark a synthetic user's email verified directly in the platform DB. With
 * RESEND blank, signup yields a session but an UNVERIFIED email, and hosted-DB
 * provisioning requires a verified email (abuse control). Flipping the flag
 * lets the e2e user complete onboarding and reach the account page — a test-only
 * shortcut for the no-inbox harness. Only ever touches the synthetic e2e user.
 */
const verifyUser = async (email) => {
  const db = dbClient();
  if (!db) return;
  await db.execute({ sql: `UPDATE user SET email_verified = 1 WHERE email = ?`, args: [email] });
};

const apiSignupIsolated = async (user) => {
  const ctx = await browser.newContext();
  try {
    await apiSignup(ctx.request, user);
  } finally {
    await ctx.close();
  }
  await verifyUser(user.email);
};

/**
 * Sign in through the onboarding UI AND finish onboarding so hosted storage is
 * provisioned and tm.mode=hosted is persisted (the account page is hosted-gated;
 * without a completed onboarding the app redirects back to the picker). Returns a
 * context with a live session that lands on the dashboard, viewport `width`.
 */
const signInUi = async (user, password, width = 1380) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  attachConsole(page);
  await page.goto(`${BASE}/app/onboarding`, { waitUntil: "domcontentloaded" });
  await page.getByText("Start free — we host it").click();
  await page.getByText("Create your free account").waitFor({ timeout: 15000 });
  await page.getByText("Already have an account?").click();
  await page.getByPlaceholder("you@example.com").fill(user.email);
  await page.getByPlaceholder("8+ characters").fill(password);
  await clearRateLimits();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // After sign-in the hosted step greets "Signed in as <email>" with a Continue
  // button — click it to provision the hosted DB (sets tm.mode=hosted).
  await page.getByText("Signed in as").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Continue" }).click();
  // connectHosted does token(404)→provision→token. The first token call burns
  // the per-user token-burst slot (1/600s), so the post-provision token retry can
  // 429 in this fast harness. Provisioning itself succeeded; clear the burst
  // limiter and reload so the signed-in auto-connect re-fetches a token cleanly.
  const setupBtn = page.getByRole("button", { name: "Start journaling" });
  try {
    await setupBtn.waitFor({ timeout: 20000 });
  } catch {
    await clearRateLimits();
    await page.goto(`${BASE}/app/onboarding`, { waitUntil: "domcontentloaded" });
    await setupBtn.waitFor({ timeout: 40000 });
  }
  // A returning-with-no-journal user is dropped at the setup step. Click through
  // it so onboarding completes and tm.mode persists.
  await setupBtn.click();
  await page.waitForURL(`${BASE}/app/dashboard`, { timeout: 60000 });
  return { ctx, page };
};

const browser = await chromium.launch();
const authedCtxs = [];
const deleteViaApi = async (ctx) => {
  try {
    await ctx.request.post(`${BASE}/api/account/delete`, { headers: { origin: BASE } });
  } catch {
    /* fall back to DB cleanup */
  }
};

/** Compute a TOTP code for an otpauth URI exactly as an authenticator app does. */
const totpForUri = (totpURI) => {
  const b32 = new URL(totpURI).searchParams.get("secret");
  const raw = new TextDecoder().decode(base32.decode(b32));
  return createOTP(raw, { period: 30, digits: 6 }).totp();
};

try {
  console.log(`Account-settings e2e on ${BASE}`);

  // ── 1. Change password then re-login with the new one ──
  await step("change password in UI, then new password signs in (old fails)", async () => {
    await apiSignupIsolated(userPw);
    const { ctx, page } = await signInUi(userPw, PASSWORD);
    await page.goto(`${BASE}/app/settings/account`, { waitUntil: "domcontentloaded" });
    await page.getByText("Change password").waitFor({ timeout: 20000 });
    await page.locator("#cp-current").fill(PASSWORD);
    await page.locator("#cp-new").fill(NEW_PASSWORD);
    await page.locator("#cp-confirm").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Update password" }).click();
    await page.getByText(/Password updated/i).waitFor({ timeout: 15000 });
    await ctx.close();

    // New password signs in via API; old one does not.
    const probe = await browser.newContext();
    await clearRateLimits();
    const ok = await probe.request.post(`${BASE}/api/auth/sign-in/email`, {
      data: { email: userPw.email, password: NEW_PASSWORD },
      headers: { origin: BASE },
    });
    if (ok.status() !== 200) throw new Error(`new password didn't sign in: ${ok.status()}`);
    await clearRateLimits();
    const old = await probe.request.post(`${BASE}/api/auth/sign-in/email`, {
      data: { email: userPw.email, password: PASSWORD },
      headers: { origin: BASE },
    });
    if (old.status() === 200) throw new Error("OLD password still signs in after change");
    await probe.close();
  });

  // ── 2. Enroll 2FA, then a fresh login is challenged + a backup code works ──
  await step("enroll 2FA (TOTP), then fresh login challenge + backup code", async () => {
    await apiSignupIsolated(user2fa);
    const { ctx, page } = await signInUi(user2fa, PASSWORD);
    await page.goto(`${BASE}/app/settings/account`, { waitUntil: "domcontentloaded" });
    await page.getByText("Two-factor authentication").waitFor({ timeout: 20000 });

    // Enroll: confirm password → get the otpauth secret + a backup code.
    await page.locator("#tf-password").fill(PASSWORD);
    await page.getByRole("button", { name: "Set up 2FA" }).click();
    // The manual key (base32 secret) is rendered in a <code> block.
    const secret = await page
      .locator("code")
      .filter({ hasText: /^[A-Z2-7]{16,}$/ })
      .first()
      .innerText({ timeout: 15000 });
    const totpURI = `otpauth://totp/x?secret=${secret.trim()}`;
    // Grab the first backup code for the later challenge.
    const backup = (
      await page.locator(".font-mono.tabular-nums >> span").first().innerText()
    ).trim();

    // Activate by entering a fresh TOTP code. The OtpInput is a controlled
    // multi-box field; type the whole code into the first box (its multi-char
    // paste handler splices it across all six and fires onComplete).
    const code = await totpForUri(totpURI);
    const otpBoxes = page.getByRole("group", { name: /verification code/i }).locator("input");
    await otpBoxes.first().click();
    await page.keyboard.type(code, { delay: 40 });
    // onComplete auto-submits at 6 digits; if the button is still around and the
    // success state hasn't appeared, click it as a fallback.
    const turnedOn = page.getByText(/Two-factor authentication is on|Turn off 2FA/i);
    const verifyBtn = page.getByRole("button", { name: /Verify & turn on/i });
    try {
      await turnedOn.waitFor({ timeout: 12000 });
    } catch {
      if (await verifyBtn.count()) await verifyBtn.click();
      await turnedOn.waitFor({ timeout: 15000 });
    }
    authedCtxs.push(ctx);

    // A FRESH login is now challenged; a backup code completes it.
    const fresh = await browser.newContext({ viewport: { width: 1380, height: 900 } });
    const fp = await fresh.newPage();
    attachConsole(fp);
    await fp.goto(`${BASE}/app/onboarding`, { waitUntil: "domcontentloaded" });
    await fp.getByText("Start free — we host it").click();
    await fp.getByText("Create your free account").waitFor({ timeout: 15000 });
    await fp.getByText("Already have an account?").click();
    await fp.getByPlaceholder("you@example.com").fill(user2fa.email);
    await fp.getByPlaceholder("8+ characters").fill(PASSWORD);
    await clearRateLimits();
    await fp.getByRole("button", { name: "Sign in", exact: true }).click();
    // The 2FA challenge appears.
    await fp.getByText("Two-factor authentication").waitFor({ timeout: 20000 });
    await fp.getByText(/Use a backup code/i).click();
    await fp.getByLabel("Backup code").fill(backup);
    await fp.getByRole("button", { name: /Verify and continue/i }).click();
    // Challenge cleared → onboarding proceeds (sign-in form gone).
    await fp
      .getByText("Two-factor authentication")
      .waitFor({ state: "detached", timeout: 30000 })
      .catch(() => {});
    const stillChallenged = await fp
      .getByLabel("Backup code")
      .isVisible()
      .catch(() => false);
    if (stillChallenged) throw new Error("backup code did not clear the 2FA challenge");
    authedCtxs.push(fresh);
  });

  // ── 3. List + revoke a session ──
  await step("list active sessions and revoke one", async () => {
    await apiSignupIsolated(userSess);
    // Create a SECOND session (API) that we'll revoke from the UI.
    const sideCtx = await browser.newContext();
    await clearRateLimits();
    await sideCtx.request.post(`${BASE}/api/auth/sign-in/email`, {
      data: { email: userSess.email, password: PASSWORD },
      headers: { origin: BASE },
    });
    const { ctx, page } = await signInUi(userSess, PASSWORD);
    await page.goto(`${BASE}/app/settings/account`, { waitUntil: "domcontentloaded" });
    await page.getByText("Active sessions").waitFor({ timeout: 20000 });
    // At least 2 sessions (this device + the API one). Revoke a non-current one.
    const revokeBtns = page.getByRole("button", { name: "Revoke" });
    await revokeBtns.first().waitFor({ timeout: 15000 });
    const before = await revokeBtns.count();
    if (before < 1) throw new Error("expected at least one revocable session");
    await revokeBtns.first().click();
    await page.getByText(/Session signed out/i).waitFor({ timeout: 15000 });
    await sideCtx.close();
    authedCtxs.push(ctx);
  });

  // ── 4. Delete a throwaway account (type-to-confirm) ──
  await step("delete a throwaway account via type-to-confirm", async () => {
    await apiSignupIsolated(userDel);
    const { ctx, page } = await signInUi(userDel, PASSWORD);
    await page.goto(`${BASE}/app/settings/account`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Delete my account/i }).click();
    await page.getByText("Delete your account?").waitFor({ timeout: 15000 });
    await page.locator("#del-confirm").fill("DELETE");
    await clearRateLimits();
    await page.getByRole("button", { name: /Permanently delete/i }).click();
    // Redirects home after deletion.
    await page.waitForURL(`${BASE}/`, { timeout: 30000 }).catch(() => {});
    await ctx.close();
    // The account no longer signs in.
    const probe = await browser.newContext();
    await clearRateLimits();
    const res = await probe.request.post(`${BASE}/api/auth/sign-in/email`, {
      data: { email: userDel.email, password: PASSWORD },
      headers: { origin: BASE },
    });
    if (res.status() === 200) throw new Error("deleted account still signs in");
    await probe.close();
  });

  // ── 5. 360px renders cleanly ──
  await step("account page renders cleanly at 360px (no horizontal overflow)", async () => {
    const userMobile = { email: `e2e-acct-${TS}-m@example.com`, name: "E2E Acct Mobile" };
    allEmails.push(userMobile.email);
    await apiSignupIsolated(userMobile);
    const { ctx, page } = await signInUi(userMobile, PASSWORD, 360);
    await page.goto(`${BASE}/app/settings/account`, { waitUntil: "domcontentloaded" });
    await page.getByText("Change password").waitFor({ timeout: 20000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    if (overflow > 2) throw new Error(`horizontal overflow at 360px: ${overflow}px`);
    authedCtxs.push(ctx);
  });

  // ── 6. Zero console errors ──
  await step("zero console errors", async () => {
    if (consoleErrors.length) throw new Error(consoleErrors.join(" | "));
  });
} finally {
  for (const ctx of authedCtxs) {
    await clearRateLimits();
    await deleteViaApi(ctx);
  }
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
      await db.execute({ sql: `DELETE FROM two_factor WHERE user_id = ?`, args: [uid] });
      await db.execute({ sql: `DELETE FROM user_databases WHERE user_id = ?`, args: [uid] });
      await db.execute({ sql: `DELETE FROM profiles WHERE user_id = ?`, args: [uid] });
      await db.execute({ sql: `DELETE FROM session WHERE user_id = ?`, args: [uid] });
      await db.execute({ sql: `DELETE FROM account WHERE user_id = ?`, args: [uid] });
      await db.execute({ sql: `DELETE FROM user WHERE id = ?`, args: [uid] });
    }
    await db.execute(
      `DELETE FROM rate_limits WHERE key LIKE 'su:%' OR key LIKE 'si:%' OR key LIKE 'fp:%' OR key LIKE 'otp%' OR key LIKE 'account-delete:%'`
    );
  }
  await browser.close();
}

if (issues.length) {
  console.log(`\n${failed} step(s) failed; ${issues.length} issue(s):`);
  for (const i of issues) console.log("  " + i);
  process.exit(1);
}
console.log(
  "\nAccount-settings e2e passed (password + 2FA + sessions + delete; zero console errors)."
);
