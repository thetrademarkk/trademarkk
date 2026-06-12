/**
 * Security e2e:
 *  (a) security headers (CSP & friends) on / and /app/dashboard
 *  (b) demo onboarding e2e with zero console/CSP errors
 *  (c) authz spot-checks: 401 logged-out, foreign-Origin 403, cross-user
 *      delete denial, javascript: website rejection, admin-route denial,
 *      account-delete content purge. Cleans up its own users.
 *
 *   node scripts/e2e-security.mjs          (app on :3000, or set BASE_URL)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

/* ── (a) security headers ── */
const REQUIRED = {
  "content-security-policy": (v) =>
    v.includes("default-src 'self'") &&
    v.includes("frame-ancestors 'none'") &&
    v.includes("wasm-unsafe-eval"),
  "x-content-type-options": (v) => v === "nosniff",
  "x-frame-options": (v) => v === "DENY",
  "referrer-policy": (v) => v === "strict-origin-when-cross-origin",
  "permissions-policy": (v) => v.includes("camera=()"),
};
for (const path of ["/", "/app/dashboard"]) {
  const res = await fetch(`${BASE}${path}`);
  for (const [h, test] of Object.entries(REQUIRED)) {
    const v = res.headers.get(h) ?? "";
    check(`header ${h} on ${path}`, test(v), `got: ${v.slice(0, 80)}`);
  }
}

/* ── (b) demo onboarding under CSP — no console errors ── */
const browser = await chromium.launch();
const page = await browser
  .newContext({ viewport: { width: 1380, height: 900 } })
  .then((c) => c.newPage());
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(`${page.url()} :: ${m.text().slice(0, 200)}`);
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror ${String(e.message).slice(0, 200)}`));

await page.goto(`${BASE}/app/onboarding`, { waitUntil: "networkidle" });
await page.getByText("Try without an account").waitFor({ timeout: 30000 });
await page.getByText("Try without an account").click();
await page.getByText("Set up your journal").waitFor({ timeout: 60000 });
await page.getByRole("button", { name: "Start journaling" }).click();
await page.waitForURL("**/app/dashboard", { timeout: 60000 });
await page.getByText("Net P&L").first().waitFor({ timeout: 30000 });
check("demo onboarding → dashboard works under CSP", true);
check(
  "zero console errors during onboarding (CSP intact)",
  consoleErrors.length === 0,
  consoleErrors.join(" | ")
);
await browser.close();

/* ── (c) authz spot-checks ── */
const HJSON = { "Content-Type": "application/json", Origin: BASE };
const signUp = async (tag) => {
  const email = `e2e-authz-${tag}-${Date.now()}@example.com`;
  const res = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: "POST",
    headers: HJSON,
    body: JSON.stringify({ email, password: "e2e-Passw0rd-123", name: `E2E ${tag}` }),
  });
  if (!res.ok) throw new Error(`signup ${tag} failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { email, cookie };
};

// no session → 401
{
  const res = await fetch(`${BASE}/api/community/posts`, {
    method: "POST",
    headers: HJSON,
    body: JSON.stringify({ body: "no session post attempt" }),
  });
  check("POST /api/community/posts without session → 401", res.status === 401, `got ${res.status}`);
}

const a = await signUp("a");
const b = await signUp("b");

// cross-site origin → 403
{
  const res = await fetch(`${BASE}/api/community/posts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://evil.example",
      cookie: a.cookie,
    },
    body: JSON.stringify({ body: "cross-origin attempt" }),
  });
  check("POST with foreign Origin → 403", res.status === 403, `got ${res.status}`);
}

// A creates a post + comment
const postRes = await fetch(`${BASE}/api/community/posts`, {
  method: "POST",
  headers: { ...HJSON, cookie: a.cookie },
  body: JSON.stringify({ body: "E2E authz check post — please ignore", tags: [], images: [] }),
});
check("user A can create a post", postRes.status === 201, `got ${postRes.status}`);
const { id: postId } = await postRes.json();

const commentRes = await fetch(`${BASE}/api/community/posts/${postId}/comments`, {
  method: "POST",
  headers: { ...HJSON, cookie: a.cookie },
  body: JSON.stringify({ body: "E2E authz comment" }),
});
const { id: commentId } = await commentRes.json();
check("user A can comment", commentRes.status === 201, `got ${commentRes.status}`);

// B may not delete A's comment / post
{
  const res = await fetch(`${BASE}/api/community/comments/${commentId}`, {
    method: "DELETE",
    headers: { Origin: BASE, cookie: b.cookie },
  });
  check("user B cannot delete A's comment → 403", res.status === 403, `got ${res.status}`);
}
{
  const res = await fetch(`${BASE}/api/community/posts/${postId}`, {
    method: "DELETE",
    headers: { Origin: BASE, cookie: b.cookie },
  });
  check("user B cannot delete A's post → 403", res.status === 403, `got ${res.status}`);
}

// javascript: website URL must be rejected
{
  const res = await fetch(`${BASE}/api/community/profile`, {
    method: "PUT",
    headers: { ...HJSON, cookie: b.cookie },
    body: JSON.stringify({ website: "javascript:alert(1)" }),
  });
  check("PUT profile with javascript: website → 400", res.status === 400, `got ${res.status}`);
}
{
  const res = await fetch(`${BASE}/api/community/profile`, {
    method: "PUT",
    headers: { ...HJSON, cookie: b.cookie },
    body: JSON.stringify({ website: "https://example.com" }),
  });
  check("PUT profile with https website → 200", res.status === 200, `got ${res.status}`);
}

// admin endpoints deny non-admins
{
  const res = await fetch(`${BASE}/api/admin/overview`, { headers: { cookie: b.cookie } });
  check("GET /api/admin/overview as non-admin → 403", res.status === 403, `got ${res.status}`);
}
{
  const res = await fetch(`${BASE}/api/blog/submissions`, { headers: { cookie: b.cookie } });
  check("GET /api/blog/submissions as non-admin → 403", res.status === 403, `got ${res.status}`);
}

// account deletion purges content (new purgeUserContent path)
{
  const del = await fetch(`${BASE}/api/account/delete`, {
    method: "POST",
    headers: { Origin: BASE, cookie: a.cookie },
  });
  check("user A account delete → 200", del.ok, `got ${del.status}`);
  const gone = await fetch(`${BASE}/api/community/posts/${postId}`);
  check(
    "A's post is purged after account deletion → 404",
    gone.status === 404,
    `got ${gone.status}`
  );
}
{
  const del = await fetch(`${BASE}/api/account/delete`, {
    method: "POST",
    headers: { Origin: BASE, cookie: b.cookie },
  });
  check("user B account delete → 200", del.ok, `got ${del.status}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
