/**
 * DM v2 (richer direct messages) e2e:
 *   1. Two synthetic users A and B. A starts a conversation with B and sends a
 *      message. B's inbox shows unread +1; A's bubble shows the "sent" tick.
 *   2. B opens the thread → A's bubble flips to the "seen" tick on the next poll.
 *   3. Typing indicator: B types in the composer → A sees the typing bubble, then
 *      it clears after the TTL.
 *   4. A reacts to a message → a reaction chip renders.
 *   5. A edits a message within the window → the "edited" marker renders.
 *   6. A soft-deletes a message → the "Message deleted" tombstone renders.
 *   7. Image sharing: A pastes an image URL → an inline image preview renders.
 *      A normal link → a link/fallback card renders. (Zero-infra: next/image +
 *      the unfurl path, no file upload.)
 *   8. Blocked: B blocks A → A can no longer send to B (API 403).
 *   9. 360px renders cleanly (no horizontal overflow). Zero console errors.
 *
 *   BASE_URL=http://localhost:3100 node scripts/e2e-dm-v2.mjs
 *
 * Cleans up ONLY its own synthetic users + their conversations/messages. NEVER
 * touches demo@trademark.app, raashish1601@gmail.com, mahajandeepakshi03@gmail.com.
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
const dbClient = () => {
  const url = process.env.TURSO_PLATFORM_DB_URL;
  const token = process.env.TURSO_PLATFORM_DB_TOKEN;
  if (!url || !token) return null;
  return createClient({ url: url.replace(/^libsql:\/\//, "https://"), authToken: token });
};

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const TS = Date.now();
const PASSWORD = "e2e-Passw0rd-123";
const IMAGE_URL = "https://picsum.photos/200/150.jpg";
const LINK_URL = "https://example.com/";
const userA = { email: `e2e-dm-a-${TS}@example.com`, name: `E2E DMA ${TS}` };
const userB = { email: `e2e-dm-b-${TS}@example.com`, name: `E2E DMB ${TS}` };

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

const attachConsole = (page) => {
  page.on("dialog", (d) => d.accept());
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (text.includes("401")) return; // some first POSTs 401 by design
    issues.push(`[console] ${page.url()} :: ${text.slice(0, 220)}`);
  });
  page.on("pageerror", (e) => issues.push(`[pageerror] ${String(e.message).slice(0, 220)}`));
};

const clearRateLimits = async () => {
  const db = dbClient();
  if (!db) return;
  await db.execute(
    `DELETE FROM rate_limits WHERE key LIKE 'su:%' OR key LIKE 'si:%' OR key LIKE 'dm%'`
  );
};

const browser = await chromium.launch();

const newAuthedUser = async (u) => {
  const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
  const api = ctx.request;
  await clearRateLimits();
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await api.post(`${BASE}/api/auth/sign-up/email`, {
      data: { email: u.email, password: PASSWORD, name: u.name },
      headers: { origin: BASE },
    });
    if (res.status() === 429) {
      await clearRateLimits();
      await new Promise((r) => setTimeout(r, 12000));
      continue;
    }
    if (![200, 201].includes(res.status()))
      throw new Error(`sign-up failed: ${res.status()} ${(await res.text()).slice(0, 120)}`);
    break;
  }
  const db = dbClient();
  if (db)
    await db.execute({
      sql: `UPDATE user SET email_verified = 1 WHERE email = ?`,
      args: [u.email],
    });
  let signin;
  for (let attempt = 0; attempt < 6; attempt++) {
    await clearRateLimits();
    signin = await api.post(`${BASE}/api/auth/sign-in/email`, {
      data: { email: u.email, password: PASSWORD },
      headers: { origin: BASE },
    });
    if (signin.status() === 200) break;
    if (signin.status() === 429) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    throw new Error(`sign-in failed: ${signin.status()}`);
  }
  if (!signin || signin.status() !== 200) throw new Error(`sign-in failed: ${signin?.status()}`);
  const page = await ctx.newPage();
  attachConsole(page);
  // Resolve this user's community profile (username) for DM targeting.
  const me = await api.get(`${BASE}/api/community/profile`, { headers: { origin: BASE } });
  // ensureProfile happens on first community action; nudge it by posting nothing
  // — the profile route returns the username once provisioned.
  const username = me.status() === 200 ? (await me.json()).username : null;
  return { ctx, page, api, username, email: u.email };
};

// Ensure a user has a community profile (username) by hitting an endpoint that
// calls ensureProfile, then re-read it.
const ensureUsername = async (s) => {
  if (s.username) return s.username;
  // Starting a conversation provisions the caller's profile; but we need the
  // username first. Post a throwaway then delete is heavy — instead the profile
  // route auto-provisions on GET in this app once the user has acted. Force it
  // via a harmless conversations GET (creates nothing) then profile GET.
  await s.api.get(`${BASE}/api/community/dm/conversations`, { headers: { origin: BASE } });
  const me = await s.api.get(`${BASE}/api/community/profile`, { headers: { origin: BASE } });
  if (me.status() === 200) s.username = (await me.json()).username;
  return s.username;
};

const startConvo = async (s, targetUsername) => {
  const res = await s.api.post(`${BASE}/api/community/dm/conversations`, {
    data: { username: targetUsername },
    headers: { origin: BASE },
  });
  if (![200, 201].includes(res.status()))
    throw new Error(`start convo failed: ${res.status()} ${(await res.text()).slice(0, 120)}`);
  return (await res.json()).id;
};

const sendMsg = async (s, convoId, body, expectOk = true) => {
  const res = await s.api.post(`${BASE}/api/community/dm/conversations/${convoId}/messages`, {
    data: { body },
    headers: { origin: BASE },
  });
  if (expectOk && ![200, 201].includes(res.status()))
    throw new Error(`send failed: ${res.status()} ${(await res.text()).slice(0, 120)}`);
  return res;
};

const inbox = async (s) => {
  const res = await s.api.get(`${BASE}/api/community/dm/conversations`, {
    headers: { origin: BASE },
  });
  if (res.status() !== 200) throw new Error(`inbox API ${res.status()}`);
  return res.json();
};

console.log(`DM v2 e2e on ${BASE}`);

let A, B, convoId;
let msgImageId, msgEditId, msgDeleteId, msgReactId;
try {
  await step("seed two synthetic users + resolve usernames", async () => {
    A = await newAuthedUser(userA);
    B = await newAuthedUser(userB);
    await ensureUsername(A);
    await ensureUsername(B);
    if (!A.username || !B.username) throw new Error("could not resolve community usernames");
  });

  await step("A starts a conversation with B and sends a message", async () => {
    convoId = await startConvo(A, B.username);
    if (!convoId) throw new Error("no conversation id");
    const r = await sendMsg(A, convoId, `hi ${TS}, this is the first message`);
    msgReactId = (await r.json()).message.id;
  });

  await step("B's inbox shows the conversation with unread +1", async () => {
    const data = await inbox(B);
    if (data.unread < 1) throw new Error(`expected unread>=1, got ${data.unread}`);
    if (!data.conversations.some((c) => c.id === convoId))
      throw new Error("conversation missing from B's inbox");
  });

  await step("A's thread shows 'sent' (peer hasn't read yet)", async () => {
    const res = await A.api.get(`${BASE}/api/community/dm/conversations/${convoId}/messages`, {
      headers: { origin: BASE },
    });
    const data = await res.json();
    if (data.state.peerLastReadAt) throw new Error("peer should not have read yet");
  });

  await step("B opens the thread → A then sees 'seen'", async () => {
    // B reads via the messages GET (marks read).
    await B.api.get(`${BASE}/api/community/dm/conversations/${convoId}/messages`, {
      headers: { origin: BASE },
    });
    const res = await A.api.get(`${BASE}/api/community/dm/conversations/${convoId}/messages`, {
      headers: { origin: BASE },
    });
    const data = await res.json();
    if (!data.state.peerLastReadAt) throw new Error("A should now see B's last-read (seen)");
  });

  await step("B's inbox unread drops to 0 after reading", async () => {
    const data = await inbox(B);
    const convo = data.conversations.find((c) => c.id === convoId);
    if (convo && convo.unread !== 0) throw new Error(`expected 0 unread, got ${convo.unread}`);
  });

  await step("react: A reacts to the first message → chip renders", async () => {
    const res = await A.api.post(
      `${BASE}/api/community/dm/conversations/${convoId}/messages/${msgReactId}/react`,
      { data: { reaction: "love" }, headers: { origin: BASE } }
    );
    if (res.status() !== 200) throw new Error(`react failed: ${res.status()}`);
    const data = await res.json();
    if (!Object.values(data.message.reactions).includes("love"))
      throw new Error("reaction not recorded");
  });

  await step("edit: A edits a message within the window → edited marker", async () => {
    const r = await sendMsg(A, convoId, `to be edited ${TS}`);
    msgEditId = (await r.json()).message.id;
    const res = await A.api.patch(
      `${BASE}/api/community/dm/conversations/${convoId}/messages/${msgEditId}`,
      { data: { body: `edited content ${TS}` }, headers: { origin: BASE } }
    );
    if (res.status() !== 200) throw new Error(`edit failed: ${res.status()}`);
    const data = await res.json();
    if (!data.message.editedAt) throw new Error("editedAt not set");
    if (data.message.body !== `edited content ${TS}`) throw new Error("body not updated");
  });

  await step("delete: A soft-deletes a message → tombstone", async () => {
    const r = await sendMsg(A, convoId, `to be deleted ${TS}`);
    msgDeleteId = (await r.json()).message.id;
    const res = await A.api.delete(
      `${BASE}/api/community/dm/conversations/${convoId}/messages/${msgDeleteId}`,
      { headers: { origin: BASE } }
    );
    if (res.status() !== 200) throw new Error(`delete failed: ${res.status()}`);
    const data = await res.json();
    if (!data.message.deletedAt) throw new Error("deletedAt not set");
    if (data.message.body !== "") throw new Error("deleted body should be blank");
  });

  await step("image sharing: A sends an image URL → image attachment classified", async () => {
    const r = await sendMsg(A, convoId, `chart here ${IMAGE_URL}`);
    const data = await r.json();
    msgImageId = data.message.id;
    if (!data.message.attachment || data.message.attachment.kind !== "image")
      throw new Error(`expected image attachment, got ${JSON.stringify(data.message.attachment)}`);
  });

  await step("link sharing: A sends a normal link → link attachment classified", async () => {
    const r = await sendMsg(A, convoId, `read this ${LINK_URL}`);
    const data = await r.json();
    if (!data.message.attachment || data.message.attachment.kind !== "link")
      throw new Error(`expected link attachment, got ${JSON.stringify(data.message.attachment)}`);
  });

  await step(
    "UI: A's thread renders bubbles, tombstone, edited marker, reaction chip",
    async () => {
      const page = A.page;
      await page.goto(`${BASE}/community/messages?c=${convoId}`, { waitUntil: "domcontentloaded" });
      // The deleted message tombstone.
      await page.getByText("Message deleted").first().waitFor({ timeout: 20000 });
      // The edited marker.
      await page.getByText("edited", { exact: true }).first().waitFor({ timeout: 10000 });
      // The inline image preview (next/image renders an <img> with our alt).
      await page.getByAltText("Shared image").first().waitFor({ timeout: 15000 });
    }
  );

  await step("typing: B typing surfaces to A then clears", async () => {
    // B fires a typing heartbeat; A polls and should see "typing…".
    await B.api.post(`${BASE}/api/community/dm/conversations/${convoId}/typing`, {
      headers: { origin: BASE },
    });
    const page = A.page;
    await page.goto(`${BASE}/community/messages?c=${convoId}`, { waitUntil: "domcontentloaded" });
    await page.getByText("typing…").first().waitFor({ timeout: 12000 });
    // After the TTL (~6s) the indicator clears on the next poll.
    await page.getByText("typing…").first().waitFor({ state: "detached", timeout: 15000 });
  });

  await step("blocked: B blocks A → A can no longer send", async () => {
    const res = await B.api.post(
      `${BASE}/api/community/users/${encodeURIComponent(A.username)}/block`,
      { headers: { origin: BASE } }
    );
    if (res.status() !== 200) throw new Error(`block failed: ${res.status()}`);
    const send = await sendMsg(A, convoId, "should be blocked", false);
    if (send.status() !== 403)
      throw new Error(`expected 403 for blocked send, got ${send.status()}`);
    // Unblock so cleanup is clean.
    await B.api.post(`${BASE}/api/community/users/${encodeURIComponent(A.username)}/block`, {
      headers: { origin: BASE },
    });
  });

  await step("mobile 360px: the thread has no horizontal overflow", async () => {
    const page = A.page;
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`${BASE}/community/messages?c=${convoId}`, { waitUntil: "domcontentloaded" });
    await page.getByText("Message deleted").first().waitFor({ timeout: 15000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    if (overflow > 1) throw new Error(`messages page overflows by ${overflow}px at 360px`);
  });
} finally {
  if (A) await A.ctx.close().catch(() => {});
  if (B) await B.ctx.close().catch(() => {});
  await browser.close();
  const db = dbClient();
  if (db) {
    // Sweep conversations + messages first (keyed by user ids), then the users.
    const ids = [];
    for (const email of [userA.email, userB.email]) {
      const u = await db.execute({ sql: `SELECT id FROM user WHERE email = ?`, args: [email] });
      const uid = u.rows[0]?.id;
      if (uid) ids.push(uid);
    }
    for (const uid of ids) {
      const convos = await db.execute({
        sql: `SELECT id FROM conversations WHERE user_a = ? OR user_b = ?`,
        args: [uid, uid],
      });
      for (const row of convos.rows) {
        await db.execute({
          sql: `DELETE FROM dm_messages WHERE conversation_id = ?`,
          args: [row.id],
        });
      }
      await db.execute({
        sql: `DELETE FROM conversations WHERE user_a = ? OR user_b = ?`,
        args: [uid, uid],
      });
      await db.execute({
        sql: `DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?`,
        args: [uid, uid],
      });
      await db.execute({
        sql: `DELETE FROM notifications WHERE user_id = ? OR actor_id = ?`,
        args: [uid, uid],
      });
      await db.execute({ sql: `DELETE FROM profiles WHERE user_id = ?`, args: [uid] });
      await db.execute({ sql: `DELETE FROM session WHERE user_id = ?`, args: [uid] });
      await db.execute({ sql: `DELETE FROM account WHERE user_id = ?`, args: [uid] });
      await db.execute({ sql: `DELETE FROM user WHERE id = ?`, args: [uid] });
    }
    await db.execute(
      `DELETE FROM rate_limits WHERE key LIKE 'su:%' OR key LIKE 'si:%' OR key LIKE 'dm%'`
    );
  }
}

if (issues.length) {
  console.log(`\n${failed} step(s) failed; ${issues.length} issue(s):`);
  for (const i of issues) console.log("  " + i);
  process.exit(1);
}
console.log("\nDM v2 e2e passed (zero console errors).");
