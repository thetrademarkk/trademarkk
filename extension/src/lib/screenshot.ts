/**
 * Chart-screenshot capture: grab the visible broker/chart tab and turn it into
 * a journal AttachmentRow, byte-compatible with the web app's screenshot store.
 *
 * `chrome.tabs.captureVisibleTab` returns a PNG/JPEG data URL of the active
 * tab in the current window. It needs the `activeTab` permission (granted on a
 * user gesture) OR a host permission for the captured page — the panel only
 * ever calls it from an explicit "Capture chart" click, never on its own.
 *
 * The raw capture is full-window PNG (often >1 MB), so we downscale + re-encode
 * it client-side to a JPEG data URL capped at ~200 KB — the same lean-DB intent
 * as the community/trade-detail image compressor — before it ever touches the
 * journal database.
 *
 * Pure helpers (encode-loop, byte sizing, data-URL→blob, attachment-row shape)
 * are split from the DOM/Chrome calls so they unit-test without a real canvas.
 */

/** Cap a stored screenshot at ~200 KB so the journal DB stays lean. */
export const SCREENSHOT_TARGET_BYTES = 200 * 1024;
/** Longest edge of a stored screenshot (broker tabs are wide; this is plenty). */
export const SCREENSHOT_MAX_DIM = 1600;
/** Quality ladder tried in order until the encoded image fits the cap. */
export const SCREENSHOT_QUALITIES = [0.82, 0.7, 0.58, 0.45, 0.32] as const;

/** Decoded byte length of a base64 data URL (no allocation — pure arithmetic). */
export function dataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return 0;
  const b64 = dataUrl.slice(comma + 1);
  if (b64.length === 0) return 0;
  let padding = 0;
  if (b64.endsWith("==")) padding = 2;
  else if (b64.endsWith("=")) padding = 1;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/** The dimensions to draw at: shrink so the longest edge fits `maxDim`, never upscale. */
export function fitWithin(
  width: number,
  height: number,
  maxDim: number
): { width: number; height: number } {
  const longest = Math.max(width, height);
  const scale = longest > maxDim ? maxDim / longest : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Steps down an injected `encode(quality)` until the result fits `targetBytes`,
 * falling back to the lowest quality. Pure: the real encoder is the canvas, but
 * tests pass a fake so the cap logic is verifiable without a DOM.
 */
export function encodeUnderCap(opts: {
  encode: (quality: number) => string;
  qualities: readonly number[];
  targetBytes: number;
}): string {
  const { encode, qualities, targetBytes } = opts;
  let last = "";
  for (const quality of qualities) {
    last = encode(quality);
    if (dataUrlByteLength(last) <= targetBytes) return last;
  }
  return last; // best effort — the smallest we can produce
}

/** Converts a data URL to a Blob (e.g. to verify the on-disk size). Pure. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) throw new Error("Not a data URL");
  const header = dataUrl.slice(5, comma); // strip "data:"
  const isBase64 = header.includes(";base64");
  const mime = header.split(";")[0] || "application/octet-stream";
  const body = dataUrl.slice(comma + 1);
  if (!isBase64) {
    return new Blob([decodeURIComponent(body)], { type: mime });
  }
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** The exact insert payload the web app's `useAddAttachment` writes. */
export interface ScreenshotAttachment {
  tradeId: string;
  /** Compressed data URL — rendered directly via `<img src>` on trade-detail. */
  data: string;
  caption?: string;
}

/**
 * Builds the AttachmentRow write payload from a captured + compressed image,
 * matching the web app's attachment schema (id/trade_id/journal_date/data/
 * caption are filled by the shared write path). A trade screenshot is linked to
 * a trade, never a journal date.
 */
export function buildScreenshotAttachment(input: {
  tradeId: string;
  data: string;
  caption?: string;
}): ScreenshotAttachment {
  return {
    tradeId: input.tradeId,
    data: input.data,
    caption: input.caption?.trim() ? input.caption.trim() : undefined,
  };
}

/* ── DOM / Chrome side (not unit-tested; exercised by the extension e2e) ──── */

/** A screenshot data URL is too large to embed if even the lowest quality fails. */
const HARD_CAP_BYTES = 700 * 1024;

/**
 * Captures the active tab of the current window as a data URL. Must be called
 * from a user gesture; resolves only when the user has granted capture for the
 * tab (activeTab on click, or a host permission). Throws on denial/no tab.
 */
export async function captureVisibleTab(): Promise<string> {
  const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
  if (!dataUrl || !dataUrl.startsWith("data:image/")) {
    throw new Error("Could not capture the tab.");
  }
  return dataUrl;
}

/**
 * Downscales + re-encodes a raw capture data URL to a JPEG capped at
 * ~200 KB. Runs in the panel document (a real DOM), so it uses an HTMLImage
 * element + canvas; the size-cap stepping is delegated to the pure
 * `encodeUnderCap`.
 */
export async function compressScreenshot(
  dataUrl: string,
  opts: { maxDim?: number; targetBytes?: number } = {}
): Promise<string> {
  const maxDim = opts.maxDim ?? SCREENSHOT_MAX_DIM;
  const targetBytes = opts.targetBytes ?? SCREENSHOT_TARGET_BYTES;

  const img = await loadImage(dataUrl);
  const { width, height } = fitWithin(
    img.naturalWidth || img.width,
    img.naturalHeight || img.height,
    maxDim
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(img, 0, 0, width, height);

  const compressed = encodeUnderCap({
    encode: (q) => canvas.toDataURL("image/jpeg", q),
    qualities: SCREENSHOT_QUALITIES,
    targetBytes,
  });
  if (dataUrlByteLength(compressed) > HARD_CAP_BYTES) {
    throw new Error("That screenshot is too large to attach.");
  }
  return compressed;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read the captured image."));
    img.src = src;
  });
}
