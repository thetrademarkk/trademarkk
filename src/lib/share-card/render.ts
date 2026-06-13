import { siteConfig } from "@/config/site";
import type { ShareCardData, ShareCardTone } from "./model";

/**
 * Share-as-image cards — the canvas painter.
 *
 * Pure client-side 2D-canvas painting (no DOM-to-image library, no server
 * round-trip): the PNG is composed on the user's device from precomputed
 * ShareCardData strings. The palette is the fixed dark brand theme so every
 * exported card looks the same regardless of the viewer's app theme.
 */

export const SHARE_CARD_W = 1200;
export const SHARE_CARD_H = 675;
/** Render at 2x for crisp text on retina screens / when X zooms the image. */
export const SHARE_CARD_SCALE = 2;

const PALETTE = {
  bg: "#0a0a0b",
  surface: "#131316",
  border: "#26262b",
  text: "#fafafa",
  muted: "#a1a1aa",
  profit: "#34d399",
  loss: "#f87171",
  accent: "#8b5cf6",
  accent2: "#c084fc",
  warning: "#fbbf24",
} as const;

const PAD = 64;

export interface ShareFonts {
  sans: string;
  mono: string;
}

/**
 * Resolves the app's real font families (next/font registers hashed names —
 * a literal "Geist" would silently fall back) and waits for them to load so
 * the canvas never paints with a fallback font.
 */
export async function resolveShareFonts(): Promise<ShareFonts> {
  try {
    await document.fonts.ready;
  } catch {
    // Older browsers: render with whatever is available.
  }
  const styles = getComputedStyle(document.body);
  return {
    sans: styles.fontFamily || "system-ui, sans-serif",
    mono: styles.getPropertyValue("--font-mono").trim() || "ui-monospace, monospace",
  };
}

function toneColor(tone: ShareCardTone): string {
  return PALETTE[tone];
}

/** rgba() from a #rrggbb hex. */
function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Two-candle brand glyph (the canvas cousin of the lucide logo mark). */
function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const bodyW = size * 0.26;
  ctx.strokeStyle = PALETTE.accent;
  ctx.fillStyle = PALETTE.accent;
  ctx.lineWidth = Math.max(1.5, size * 0.07);
  // Candle 1 (left, lower)
  const c1 = x + size * 0.27;
  ctx.beginPath();
  ctx.moveTo(c1, y + size * 0.18);
  ctx.lineTo(c1, y + size);
  ctx.stroke();
  ctx.fillRect(c1 - bodyW / 2, y + size * 0.38, bodyW, size * 0.4);
  // Candle 2 (right, higher)
  const c2 = x + size * 0.73;
  ctx.beginPath();
  ctx.moveTo(c2, y);
  ctx.lineTo(c2, y + size * 0.82);
  ctx.stroke();
  ctx.fillRect(c2 - bodyW / 2, y + size * 0.14, bodyW, size * 0.4);
}

/** "Trade" in white + "Mark" in accent. */
function drawWordmark(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseline: number,
  sizePx: number,
  fonts: ShareFonts
) {
  ctx.font = `600 ${sizePx}px ${fonts.sans}`;
  ctx.textAlign = "left";
  ctx.fillStyle = PALETTE.text;
  ctx.fillText("Trade", x, baseline);
  ctx.fillStyle = PALETTE.accent;
  ctx.fillText("Mark", x + ctx.measureText("Trade").width, baseline);
}

/** Small uppercase pill (direction / open / review badge). Returns its width. */
function drawPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  centerY: number,
  label: string,
  color: string,
  fonts: ShareFonts
): number {
  ctx.font = `600 14px ${fonts.sans}`;
  const w = ctx.measureText(label).width + 28;
  const h = 30;
  ctx.fillStyle = alpha(color, 0.14);
  roundRectPath(ctx, x, centerY - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 14, centerY + 1);
  ctx.textBaseline = "alphabetic";
  return w;
}

/** Paints the branded 1200×675 card (at 2x) onto the given canvas. */
export function renderShareCard(
  canvas: HTMLCanvasElement,
  data: ShareCardData,
  fonts: ShareFonts
): void {
  canvas.width = SHARE_CARD_W * SHARE_CARD_SCALE;
  canvas.height = SHARE_CARD_H * SHARE_CARD_SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable in this browser");
  ctx.setTransform(SHARE_CARD_SCALE, 0, 0, SHARE_CARD_SCALE, 0, 0);

  const W = SHARE_CARD_W;
  const H = SHARE_CARD_H;
  const tone = toneColor(data.heroTone);

  // ── Background: dark brand canvas + soft glows + accent hairline ──
  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, W, H);

  const glowTop = ctx.createRadialGradient(W * 0.85, -40, 0, W * 0.85, -40, 520);
  glowTop.addColorStop(0, alpha(PALETTE.accent, 0.16));
  glowTop.addColorStop(1, alpha(PALETTE.accent, 0));
  ctx.fillStyle = glowTop;
  ctx.fillRect(0, 0, W, H);

  const glowBottom = ctx.createRadialGradient(40, H + 60, 0, 40, H + 60, 460);
  glowBottom.addColorStop(0, alpha(tone, 0.1));
  glowBottom.addColorStop(1, alpha(tone, 0));
  ctx.fillStyle = glowBottom;
  ctx.fillRect(0, 0, W, H);

  const topBar = ctx.createLinearGradient(0, 0, W, 0);
  topBar.addColorStop(0, PALETTE.accent);
  topBar.addColorStop(1, alpha(PALETTE.accent2, 0));
  ctx.fillStyle = topBar;
  ctx.fillRect(0, 0, W, 5);

  // ── Header: brand left, date / period right ──
  drawMark(ctx, PAD, 52, 32);
  drawWordmark(ctx, PAD + 46, 84, 30, fonts);
  ctx.font = `400 17px ${fonts.sans}`;
  ctx.fillStyle = PALETTE.muted;
  ctx.textAlign = "right";
  ctx.fillText(data.dateLabel, W - PAD, 82);

  // ── Title + badges ──
  ctx.textAlign = "left";
  ctx.font = `600 40px ${fonts.sans}`;
  ctx.fillStyle = PALETTE.text;
  const badgeSpace = 120 + data.badges.length * 110;
  const maxTitleW = W - PAD * 2 - badgeSpace;
  ctx.fillText(data.title, PAD, 184, maxTitleW);
  let pillX = PAD + Math.min(ctx.measureText(data.title).width, maxTitleW) + 20;
  for (const badge of data.badges) {
    pillX += drawPill(ctx, pillX, 170, badge.label, toneColor(badge.tone), fonts) + 10;
  }

  // ── Hero: ₹ P&L (opt-in) / R multiple / win rate / WIN-LOSS / OPEN ──
  ctx.font = `700 96px ${fonts.mono}`;
  ctx.fillStyle = tone;
  ctx.save();
  ctx.shadowColor = alpha(tone, 0.35);
  ctx.shadowBlur = 36;
  ctx.fillText(data.hero, PAD, 336, W - PAD * 2);
  ctx.restore();

  if (data.subline) {
    ctx.font = `400 19px ${fonts.mono}`;
    ctx.fillStyle = PALETTE.muted;
    ctx.fillText(data.subline, PAD, 380, W - PAD * 2);
  }

  // ── Stats strip ──
  const cardY = 424;
  const cardH = 122;
  const cardW = W - PAD * 2;
  ctx.fillStyle = PALETTE.surface;
  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = 1;
  roundRectPath(ctx, PAD, cardY, cardW, cardH, 16);
  ctx.fill();
  ctx.stroke();

  const colW = cardW / Math.max(1, data.stats.length);
  data.stats.forEach((stat, i) => {
    const cx = PAD + colW * i + colW / 2;
    if (i > 0) {
      ctx.strokeStyle = PALETTE.border;
      ctx.beginPath();
      ctx.moveTo(PAD + colW * i, cardY + 22);
      ctx.lineTo(PAD + colW * i, cardY + cardH - 22);
      ctx.stroke();
    }
    ctx.textAlign = "center";
    ctx.font = `600 13px ${fonts.sans}`;
    ctx.fillStyle = PALETTE.muted;
    ctx.fillText(stat.label.toUpperCase(), cx, cardY + 44);
    ctx.font = `500 26px ${fonts.mono}`;
    ctx.fillStyle = PALETTE.text;
    ctx.fillText(stat.value, cx, cardY + 88, colW - 24);
  });

  // ── Footnote ──
  if (data.footnote) {
    ctx.textAlign = "left";
    ctx.font = `400 17px ${fonts.sans}`;
    ctx.fillStyle = PALETTE.muted;
    ctx.fillText(data.footnote, PAD, 586, W - PAD * 2);
  }

  // ── Footer: watermark + site host ──
  ctx.strokeStyle = PALETTE.border;
  ctx.beginPath();
  ctx.moveTo(PAD, 612);
  ctx.lineTo(W - PAD, 612);
  ctx.stroke();
  drawMark(ctx, PAD, 631, 18);
  drawWordmark(ctx, PAD + 28, 648, 18, fonts);
  let host = "trademarkk journal";
  try {
    host = new URL(siteConfig.url).host;
  } catch {
    // keep the wordy fallback
  }
  ctx.font = `400 15px ${fonts.mono}`;
  ctx.fillStyle = PALETTE.muted;
  ctx.textAlign = "right";
  ctx.fillText(host, W - PAD, 647);
  ctx.textAlign = "left";
}
