/**
 * Security e2e:
 *  (a) security headers (CSP & friends) on / and /app/dashboard
 *  (b) demo onboarding e2e with zero console/CSP errors
 *  (c) authz spot-checks: 401 logged-out, foreign-Origin 403, cross-user
 *      delete denial, javascript: website rejection, admin-route denial,
 *      account-delete content purge. Cleans up its own users.
 *  (d) DM authz sweep: 401s, 3-user IDOR matrix (read + send), self-DM,
 *      canonical-pair dedupe, zod body caps, cursor validation, blocked-send
 *      both directions, send rate-limit smoke, DM purge on account delete.
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

/* ── (d) DM authz sweep ── */
const c = await signUp("c");
const usernameOf = async (user) => {
  const res = await fetch(`${BASE}/api/community/profile`, { headers: { cookie: user.cookie } });
  if (!res.ok) throw new Error(`profile fetch failed: ${res.status}`);
  return (await res.json()).username;
};
const aName = await usernameOf(a);
const bName = await usernameOf(b);
await usernameOf(c); // ensure C's profile exists too

// logged-out → 401 on every DM endpoint
{
  const inbox = await fetch(`${BASE}/api/community/dm/conversations`);
  check("GET dm/conversations without session → 401", inbox.status === 401, `got ${inbox.status}`);
  const start = await fetch(`${BASE}/api/community/dm/conversations`, {
    method: "POST",
    headers: HJSON,
    body: JSON.stringify({ username: bName }),
  });
  check("POST dm/conversations without session → 401", start.status === 401, `got ${start.status}`);
  const read = await fetch(`${BASE}/api/community/dm/conversations/nosuchid/messages`);
  check("GET dm messages without session → 401", read.status === 401, `got ${read.status}`);
  const send = await fetch(`${BASE}/api/community/dm/conversations/nosuchid/messages`, {
    method: "POST",
    headers: HJSON,
    body: JSON.stringify({ body: "hi" }),
  });
  check("POST dm message without session → 401", send.status === 401, `got ${send.status}`);
}

// foreign Origin → 403 on DM mutations
{
  const evil = { "Content-Type": "application/json", Origin: "https://evil.example" };
  const start = await fetch(`${BASE}/api/community/dm/conversations`, {
    method: "POST",
    headers: { ...evil, cookie: a.cookie },
    body: JSON.stringify({ username: bName }),
  });
  check(
    "start conversation with foreign Origin → 403",
    start.status === 403,
    `got ${start.status}`
  );
}

// self-DM rejected
{
  const res = await fetch(`${BASE}/api/community/dm/conversations`, {
    method: "POST",
    headers: { ...HJSON, cookie: a.cookie },
    body: JSON.stringify({ username: aName }),
  });
  check("self-DM rejected → 400", res.status === 400, `got ${res.status}`);
}

// A starts a conversation with B; repeats + reversed direction must dedupe
const startRes = await fetch(`${BASE}/api/community/dm/conversations`, {
  method: "POST",
  headers: { ...HJSON, cookie: a.cookie },
  body: JSON.stringify({ username: bName }),
});
check("A can start a conversation with B → 201", startRes.status === 201, `got ${startRes.status}`);
const { id: convoId } = await startRes.json();
{
  const again = await fetch(`${BASE}/api/community/dm/conversations`, {
    method: "POST",
    headers: { ...HJSON, cookie: a.cookie },
    body: JSON.stringify({ username: bName }),
  });
  const dup = await again.json();
  check("restarting the same conversation reuses it", dup.id === convoId && dup.created === false);
  const reversed = await fetch(`${BASE}/api/community/dm/conversations`, {
    method: "POST",
    headers: { ...HJSON, cookie: b.cookie },
    body: JSON.stringify({ username: aName }),
  });
  const rev = await reversed.json();
  check("B→A maps to the same canonical conversation", rev.id === convoId);
}

// zod caps on the message body
{
  const empty = await fetch(`${BASE}/api/community/dm/conversations/${convoId}/messages`, {
    method: "POST",
    headers: { ...HJSON, cookie: a.cookie },
    body: JSON.stringify({ body: "   " }),
  });
  check("empty DM body → 400", empty.status === 400, `got ${empty.status}`);
  const long = await fetch(`${BASE}/api/community/dm/conversations/${convoId}/messages`, {
    method: "POST",
    headers: { ...HJSON, cookie: a.cookie },
    body: JSON.stringify({ body: "x".repeat(2001) }),
  });
  check("2001-char DM body → 400", long.status === 400, `got ${long.status}`);
}

// A sends, B reads — participants work end to end
{
  const send = await fetch(`${BASE}/api/community/dm/conversations/${convoId}/messages`, {
    method: "POST",
    headers: { ...HJSON, cookie: a.cookie },
    body: JSON.stringify({ body: "E2E DM authz check — hello B" }),
  });
  check("participant A can send → 201", send.status === 201, `got ${send.status}`);
  const read = await fetch(`${BASE}/api/community/dm/conversations/${convoId}/messages`, {
    headers: { cookie: b.cookie },
  });
  const data = read.ok ? await read.json() : { messages: [] };
  check(
    "participant B can read the thread",
    read.status === 200 && data.messages.some((m) => m.body.includes("hello B")),
    `got ${read.status}`
  );
  const badCursor = await fetch(
    `${BASE}/api/community/dm/conversations/${convoId}/messages?cursor=${encodeURIComponent("not-a-date'--")}`,
    { headers: { cookie: a.cookie } }
  );
  check("garbage history cursor → 400", badCursor.status === 400, `got ${badCursor.status}`);
}

// IDOR matrix: C must not read or write A↔B
{
  const read = await fetch(`${BASE}/api/community/dm/conversations/${convoId}/messages`, {
    headers: { cookie: c.cookie },
  });
  check("outsider C cannot read A↔B thread → 404", read.status === 404, `got ${read.status}`);
  const send = await fetch(`${BASE}/api/community/dm/conversations/${convoId}/messages`, {
    method: "POST",
    headers: { ...HJSON, cookie: c.cookie },
    body: JSON.stringify({ body: "C intruding" }),
  });
  check("outsider C cannot send into A↔B → 404", send.status === 404, `got ${send.status}`);
  const evilSend = await fetch(`${BASE}/api/community/dm/conversations/${convoId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://evil.example",
      cookie: a.cookie,
    },
    body: JSON.stringify({ body: "cross-origin send" }),
  });
  check("send with foreign Origin → 403", evilSend.status === 403, `got ${evilSend.status}`);
}

// blocks stop DMs in BOTH directions (send + starting conversations)
{
  const block = await fetch(`${BASE}/api/community/users/${aName}/block`, {
    method: "POST",
    headers: { Origin: BASE, cookie: b.cookie },
  });
  check("B can block A", block.ok, `got ${block.status}`);
  const blockedSend = await fetch(`${BASE}/api/community/dm/conversations/${convoId}/messages`, {
    method: "POST",
    headers: { ...HJSON, cookie: a.cookie },
    body: JSON.stringify({ body: "blocked send attempt" }),
  });
  check(
    "blocked A cannot send to B → 403",
    blockedSend.status === 403,
    `got ${blockedSend.status}`
  );
  const blockerSend = await fetch(`${BASE}/api/community/dm/conversations/${convoId}/messages`, {
    method: "POST",
    headers: { ...HJSON, cookie: b.cookie },
    body: JSON.stringify({ body: "blocker send attempt" }),
  });
  check(
    "blocker B cannot send to A either → 403",
    blockerSend.status === 403,
    `got ${blockerSend.status}`
  );
  const blockedStart = await fetch(`${BASE}/api/community/dm/conversations`, {
    method: "POST",
    headers: { ...HJSON, cookie: a.cookie },
    body: JSON.stringify({ username: bName }),
  });
  check(
    "blocked A cannot start a conversation → 403",
    blockedStart.status === 403,
    `got ${blockedStart.status}`
  );
  const unblock = await fetch(`${BASE}/api/community/users/${aName}/block`, {
    method: "POST",
    headers: { Origin: BASE, cookie: b.cookie },
  });
  check("B can unblock A", unblock.ok, `got ${unblock.status}`);
}

// rate-limit smoke: sends must 429 within the 120/h window
{
  let limited = false;
  for (let i = 0; i < 130 && !limited; i++) {
    const res = await fetch(`${BASE}/api/community/dm/conversations/${convoId}/messages`, {
      method: "POST",
      headers: { ...HJSON, cookie: a.cookie },
      body: JSON.stringify({ body: `rate limit probe ${i}` }),
    });
    if (res.status === 429) limited = true;
    else if (res.status !== 201) break;
  }
  check("DM sends hit 429 within 130 attempts (120/h cap)", limited);
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
  // The A↔B conversation (and its messages) must not outlive A's account.
  const inbox = await fetch(`${BASE}/api/community/dm/conversations`, {
    headers: { cookie: b.cookie },
  });
  const inboxData = inbox.ok ? await inbox.json() : { conversations: [{ id: convoId }] };
  check(
    "A's conversations are purged after account deletion",
    inbox.status === 200 && !inboxData.conversations.some((cv) => cv.id === convoId),
    `got ${inbox.status}`
  );
  const thread = await fetch(`${BASE}/api/community/dm/conversations/${convoId}/messages`, {
    headers: { cookie: b.cookie },
  });
  check("purged thread is unreachable for B → 404", thread.status === 404, `got ${thread.status}`);
}
{
  const del = await fetch(`${BASE}/api/account/delete`, {
    method: "POST",
    headers: { Origin: BASE, cookie: b.cookie },
  });
  check("user B account delete → 200", del.ok, `got ${del.status}`);
}
{
  const del = await fetch(`${BASE}/api/account/delete`, {
    method: "POST",
    headers: { Origin: BASE, cookie: c.cookie },
  });
  check("user C account delete → 200", del.ok, `got ${del.status}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
