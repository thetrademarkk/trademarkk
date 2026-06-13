/**
 * Anthropic-launch-style product demo (~70s): smooth scripted cursor, click
 * ripples, eased zooms, full trade-entry walkthrough, click sounds in post.
 * Output: demo/trademarkk-demo.mp4 (local only — never committed).
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import ffmpeg from "ffmpeg-static";

/** 16-bit PCM mono WAV from a sample generator fn(t_seconds) → [-1, 1]. */
function writeWav(path, durMs, fn, sr = 48000) {
  const n = Math.round((durMs / 1000) * sr);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, fn(i / sr)));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}
const rnd = () => Math.random() * 2 - 1;
// Mouse-down "thock": noise transient + damped 1.7kHz + low body.
const synthDown = (t) =>
  0.5 * rnd() * Math.exp(-t / 0.0012) +
  0.62 * Math.sin(2 * Math.PI * 1700 * t) * Math.exp(-t / 0.005) +
  0.3 * Math.sin(2 * Math.PI * 480 * t) * Math.exp(-t / 0.011);
// Mouse-up "tick": shorter, brighter, quieter.
const synthUp = (t) =>
  0.28 * rnd() * Math.exp(-t / 0.0008) +
  0.34 * Math.sin(2 * Math.PI * 2300 * t) * Math.exp(-t / 0.0032);
// Keyboard tap: tiny soft tick.
const synthKey = (t) =>
  0.16 * rnd() * Math.exp(-t / 0.0009) +
  0.17 * Math.sin(2 * Math.PI * 2700 * t) * Math.exp(-t / 0.0022);

const BASE = "http://localhost:3100";
const W = 1280,
  H = 720;
mkdirSync("demo", { recursive: true });

const browser = await chromium.launch();

// ── Auth off-camera ──
{
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/app/onboarding`, { waitUntil: "networkidle" });
  await p.getByText("Start free — we host it").click();
  await p.getByRole("button", { name: /Already have an account/ }).click();
  await p.getByPlaceholder("you@example.com").fill("demo@trademark.app");
  await p
    .getByPlaceholder(/characters|password/i)
    .first()
    .fill("Demo@12345");
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await p.waitForURL("**/app/dashboard", { timeout: 60000 });
  await p.getByText("Net P&L").first().waitFor({ timeout: 30000 });
  await ctx.storageState({ path: "demo/auth.json" });
  await ctx.close();
  console.log("auth ready");
}

// ── Recording context ──
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  storageState: "demo/auth.json",
  recordVideo: { dir: "demo", size: { width: W, height: H } },
});
const page = await ctx.newPage();
await page.addInitScript(() => {
  const init = () => {
    if (document.getElementById("__demo_cursor")) return;
    const style = document.createElement("style");
    style.textContent = `
      *::-webkit-scrollbar{display:none} *{scrollbar-width:none}
      #__demo_cursor{position:fixed;top:0;left:0;width:22px;height:22px;border-radius:50%;
        background:rgba(255,255,255,.92);box-shadow:0 1px 6px rgba(0,0,0,.45),0 0 0 1.5px rgba(0,0,0,.25);
        pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%);transition:width .12s,height .12s}
      .__demo_ripple{position:fixed;border-radius:50%;border:2.5px solid rgba(139,92,246,.9);
        pointer-events:none;z-index:2147483646;transform:translate(-50%,-50%);
        animation:__demo_rip .45s ease-out forwards}
      @keyframes __demo_rip{from{width:14px;height:14px;opacity:.95}to{width:64px;height:64px;opacity:0}}`;
    document.head.appendChild(style);
    const c = document.createElement("div");
    c.id = "__demo_cursor";
    document.body.appendChild(c);
    window.addEventListener(
      "mousemove",
      (e) => {
        c.style.left = e.clientX + "px";
        c.style.top = e.clientY + "px";
      },
      true
    );
    window.addEventListener(
      "mousedown",
      (e) => {
        c.style.width = "16px";
        c.style.height = "16px";
        const r = document.createElement("div");
        r.className = "__demo_ripple";
        r.style.left = e.clientX + "px";
        r.style.top = e.clientY + "px";
        document.body.appendChild(r);
        setTimeout(() => r.remove(), 500);
      },
      true
    );
    window.addEventListener(
      "mouseup",
      () => {
        c.style.width = "22px";
        c.style.height = "22px";
      },
      true
    );
  };
  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
});

let cur = { x: W / 2, y: H / 2 };
const clicks = []; // mouse-down times (ms); mouse-up sound plays at +80ms
const keys = []; // per-character typing times (ms)
let t0 = 0;
const now = () => Date.now() - t0;
const wait = (ms) => page.waitForTimeout(ms);

async function moveTo(x, y, dur = 500) {
  const steps = Math.max(14, Math.round(dur / 16));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    await page.mouse.move(cur.x + (x - cur.x) * e, cur.y + (y - cur.y) * e);
    await wait(dur / steps);
  }
  cur = { x, y };
}
async function clickLoc(locator, dur = 500) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("no box");
  await moveTo(b.x + b.width / 2, b.y + b.height / 2, dur);
  await wait(120);
  clicks.push(now());
  await page.mouse.down();
  await wait(75);
  await page.mouse.up();
}
async function typeIn(locator, text, delay = 55) {
  await clickLoc(locator, 420);
  await wait(120);
  const start = now();
  await locator.pressSequentially(text, { delay });
  // Reconstruct per-key timestamps across the typing window for the audio track.
  const span = now() - start;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== " ") keys.push(start + Math.round((span * (i + 0.5)) / text.length));
  }
}
/** Anthropic-style eased zoom: scale the page around a focal point. */
async function zoom(scale, cx = W / 2, cy = H / 2, dur = 750) {
  await page.evaluate(
    ([s, x, y, d]) => {
      const b = document.body;
      b.style.transition = `transform ${d}ms cubic-bezier(.45,0,.2,1)`;
      b.style.transformOrigin = `${x}px ${y}px`;
      b.style.transform = `scale(${s})`;
    },
    [scale, cx, cy, dur]
  );
  await wait(dur + 120);
  // Fully clear the transform when zoomed out, so the next click hit-tests
  // against clean (untransformed) geometry — fixed-position portals included.
  if (scale === 1) {
    await page.evaluate(() => {
      document.body.style.transition = "";
      document.body.style.transform = "";
      document.body.style.transformOrigin = "";
    });
    await wait(180);
  }
}
async function scene(path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.mouse.move(cur.x, cur.y);
  await wait(300);
}

t0 = Date.now();

// ── 1. Dashboard: KPIs, streak, equity + heatmap (≈10s) ──
await scene("/app/dashboard");
await page.getByText("Net P&L").first().waitFor({ timeout: 30000 });
await wait(600);
await moveTo(180, 170, 600);
await moveTo(1000, 170, 900); // sweep the KPI row
await clickLoc(page.locator('header button[aria-label^="Journaling streak"]'), 550);
await wait(1200);
await page.keyboard.press("Escape");
await page.evaluate(() => window.scrollBy({ top: 430, behavior: "smooth" }));
await wait(1500);
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await wait(700);

// ── 2. Full trade entry: BANKNIFTY straddle, both legs, plan, save (≈30s) ──
await page.keyboard.press("t");
const dlg = page.getByRole("dialog");
await dlg.getByPlaceholder("NIFTY / RELIANCE").waitFor({ timeout: 10000 });
await wait(400);
await zoom(1.28, 640, 330, 700);
await typeIn(dlg.getByPlaceholder("NIFTY / RELIANCE"), "BANKNIFTY");
await typeIn(dlg.getByPlaceholder("24500"), "52000");
await clickLoc(dlg.getByRole("combobox").nth(1), 420); // CE/PE
await clickLoc(page.getByRole("option", { name: "CE" }), 380);
await typeIn(dlg.getByPlaceholder("75"), "30");
await typeIn(dlg.getByPlaceholder("120.50"), "200");
await typeIn(dlg.getByPlaceholder("blank = open"), "250");
await wait(350);
// Leg 2 of the straddle
await clickLoc(dlg.getByRole("button", { name: "Add leg" }), 500);
await wait(500);
await typeIn(dlg.getByPlaceholder("24500"), "52000");
await clickLoc(dlg.getByRole("combobox").nth(1), 420);
await clickLoc(page.getByRole("option", { name: "PE" }), 380);
await typeIn(dlg.getByPlaceholder("75"), "30");
await typeIn(dlg.getByPlaceholder("120.50"), "180");
await typeIn(dlg.getByPlaceholder("blank = open"), "120");
await wait(400);
await zoom(1, W / 2, H / 2, 650); // pull back to show the whole form
// Risk plan + conviction + notes
await typeIn(dlg.getByPlaceholder("risk per trade"), "142");
await clickLoc(dlg.getByRole("button", { name: "4", exact: true }), 450); // confidence
await typeIn(
  dlg.getByPlaceholder(/What was the thesis/),
  "Textbook expiry straddle at max OI.",
  30
);
await wait(400);
// Live preview with paise-exact charges
const preview = dlg.locator("span", { hasText: /Charges/ }).first();
if (await preview.count()) {
  const pb = await preview.boundingBox();
  if (pb) await zoom(1.35, pb.x + 100, pb.y, 650);
  await wait(1100);
  await zoom(1, W / 2, H / 2, 600);
}
await clickLoc(dlg.getByRole("button", { name: "Save trade" }), 550);
await page.getByText("Trade saved").waitFor({ timeout: 15000 });
await wait(900);

// ── 3. Trades list → quick-view → full detail (≈12s) ──
await scene("/app/trades");
await page.locator("table tbody tr").first().waitFor({ timeout: 20000 });
await wait(500);
await clickLoc(page.locator("table tbody tr").first(), 600);
const qv = page.getByRole("dialog");
await qv.getByText("Net P&L").waitFor({ timeout: 10000 });
await zoom(1.2, 640, 360, 650);
await wait(1300);
await zoom(1, W / 2, H / 2, 550);
await clickLoc(qv.getByRole("link", { name: /Open full view/ }), 550);
await page.getByText("P&L breakdown").waitFor({ timeout: 15000 });
await wait(1700);

// ── 4. Journal: moods + notes (≈9s) ──
await scene("/app/journal");
await page.getByText("Pre-market plan").waitFor({ timeout: 20000 });
await wait(400);
await typeIn(page.getByPlaceholder(/What worked/), "Patience paid. Same setup tomorrow.", 32);
await clickLoc(page.getByLabel("Calm"), 500);
await wait(900);

// ── 5. Analytics (≈8s) ──
await scene("/app/analytics");
await page.getByText("By entry hour").first().waitFor({ timeout: 20000 });
await wait(700);
await clickLoc(page.getByRole("tab", { name: "Distribution" }), 550);
await wait(1700);

// ── 6. Calendar: click a P&L day (≈7s) ──
await scene("/app/calendar");
await page.getByText("Month:").waitFor({ timeout: 20000 });
await wait(500);
await clickLoc(page.locator("button[title*='₹']").first(), 600);
await wait(1800);

// ── 7. Community: like + open a post (≈9s) ──
await scene("/community");
await page.getByLabel("Like").first().waitFor({ timeout: 20000 });
await page.evaluate(() => window.scrollBy({ top: 150, behavior: "smooth" }));
await wait(700);
await clickLoc(page.getByLabel("Like").first(), 550);
await wait(800);
await clickLoc(page.locator('a[href^="/community/post/"]').first(), 550);
await page.getByLabel("Write a comment").waitFor({ timeout: 15000 });
await wait(1500);

// ── End card (≈2.5s) ──
await scene("/features");
await page.locator("h1").first().waitFor({ timeout: 15000 });
await moveTo(640, 280, 600);
await wait(1500);

const durMs = now();
await ctx.close();
const video = await page.video().path();
console.log(`recorded ${(durMs / 1000).toFixed(1)}s, ${clicks.length} clicks`);

// ── Cleanup off-camera: delete the demo trade we just created ──
{
  const c2 = await browser.newContext({
    viewport: { width: W, height: H },
    storageState: "demo/auth.json",
  });
  const p = await c2.newPage();
  await p.goto(`${BASE}/app/trades`, { waitUntil: "networkidle" });
  await p.locator("table tbody tr").first().click();
  await p.getByRole("link", { name: /Open full view/ }).click();
  await p.getByText("P&L breakdown").waitFor({ timeout: 15000 });
  await p.getByRole("button", { name: "Delete" }).click();
  await p
    .getByRole("dialog")
    .filter({ hasText: "Delete this trade?" })
    .getByRole("button", { name: "Delete" })
    .click();
  await p.waitForURL("**/app/trades", { timeout: 15000 });
  await c2.close();
  console.log("demo trade cleaned up");
}
await browser.close();

// ── Post: real click sound (from Downloads) + subtle synth key taps → mp4 ──
const CLICK_SRC = "C:/Users/raash/Downloads/matthewvakaliuk73627-mouse-click-290204.mp3";
execFileSync(
  ffmpeg,
  [
    "-y",
    "-i",
    CLICK_SRC,
    "-ac",
    "1",
    "-ar",
    "48000",
    "-af",
    "silenceremove=start_periods=1:start_silence=0.01:start_threshold=-50dB,afade=t=out:st=0.18:d=0.05,loudnorm=I=-16:TP=-1.5,volume=0.85",
    "-t",
    "0.25",
    "demo/click.wav",
  ],
  { stdio: "ignore" }
);
writeWav("demo/key.wav", 16, synthKey);
writeFileSync("demo/clicks.json", JSON.stringify({ durMs, clicks, keys }));

// Events: [inputIndex, timeMs] — input 1=real click, 2=key tap.
const events = [...clicks.map((t) => [1, Math.round(t)]), ...keys.map((t) => [2, Math.round(t)])];
const byInput = [1, 2].map((idx) => events.filter((e) => e[0] === idx));
const parts = [];
const outs = [];
for (const [k, list] of byInput.entries()) {
  const idx = k + 1;
  parts.push(`[${idx}:a]asplit=${list.length}${list.map((_, i) => `[s${idx}_${i}]`).join("")}`);
  list.forEach(([, t], i) => {
    parts.push(`[s${idx}_${i}]adelay=${t}:all=1[d${idx}_${i}]`);
    outs.push(`[d${idx}_${i}]`);
  });
}
parts.push(
  `${outs.join("")}amix=inputs=${outs.length}:normalize=0,apad=whole_dur=${Math.ceil(durMs / 1000) + 2}[aout]`
);
execFileSync(ffmpeg, [
  "-y",
  "-i",
  video,
  "-i",
  "demo/click.wav",
  "-i",
  "demo/key.wav",
  "-filter_complex",
  parts.join(";"),
  "-map",
  "0:v",
  "-map",
  "[aout]",
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  "18",
  "-pix_fmt",
  "yuv420p",
  "-r",
  "30",
  "-c:a",
  "aac",
  "-b:a",
  "160k",
  "-t",
  `${(durMs / 1000 + 0.3).toFixed(1)}`,
  "-movflags",
  "+faststart",
  "demo/trademarkk-demo.mp4",
]);
renameSync(video, "demo/raw.webm");
console.log(`done -> demo/trademarkk-demo.mp4 (${clicks.length} clicks, ${keys.length} key taps)`);
