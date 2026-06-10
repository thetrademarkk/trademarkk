/** Client-side image compression: screenshots → WebP data-URL capped ~300 KB. */
const MAX_DIM = 1400;
const TARGET_BYTES = 300 * 1024;

export async function compressImage(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  for (const quality of [0.8, 0.65, 0.5, 0.35]) {
    const dataUrl = canvas.toDataURL("image/webp", quality);
    if (dataUrl.length * 0.75 <= TARGET_BYTES) return dataUrl;
  }
  return canvas.toDataURL("image/webp", 0.25);
}

/** Extracts the first image from a paste event, if any. */
export function imageFromClipboard(e: ClipboardEvent): File | null {
  for (const item of Array.from(e.clipboardData?.items ?? [])) {
    if (item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}
