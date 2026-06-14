// Generates PNG app icons (192/512 "any" + maskable, 180 apple-touch) from the
// brand logo geometry, with zero image dependencies — it rasterises the known
// rounded-rect candlestick marks directly and encodes PNG via node:zlib.
//
// NOTE: these are faithful, code-rendered renditions of the existing SVG logo
// (public/icons/icon.svg). If a designed raster icon set is produced later it
// should replace these files; the manifest/metadata references stay the same.
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const BG = [0x0a, 0x0a, 0x0b]; // brand near-black
// Candlestick marks in the 64x64 viewBox: body rects + wick rects, brand colors.
const GREEN = [0x34, 0xd3, 0x99];
const RED = [0xf8, 0x71, 0x71];
const PURPLE = [0x8b, 0x5c, 0xf6];
// [x, y, w, h, rx, color] in viewBox units (rx=0 for sharp wicks).
const MARKS = [
  [12, 22, 8, 20, 2, GREEN],
  [15, 14, 2, 36, 0, GREEN],
  [28, 18, 8, 16, 2, RED],
  [31, 10, 2, 32, 0, RED],
  [44, 26, 8, 22, 2, PURPLE],
  [47, 18, 2, 38, 0, PURPLE],
];

function hypotInRoundedRect(px, py, x, y, w, h, rx) {
  if (px < x || px >= x + w || py < y || py >= y + h) return false;
  if (rx <= 0) return true;
  const ry = rx;
  // Check the four corner arcs.
  const cx = px < x + rx ? x + rx : px > x + w - rx ? x + w - rx : px;
  const cy = py < y + ry ? y + ry : py > y + h - ry ? y + h - ry : py;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= rx * ry;
}

/** Render an icon to a raw RGBA buffer. `inset` shrinks marks for maskable safe-zone. */
function render(size, { rounded, inset }) {
  const buf = Buffer.alloc(size * size * 4);
  const radius = rounded ? size * 0.22 : 0; // bg corner radius for "any"
  const scale = size / 64;
  // Maskable safe zone: keep marks within the inner ~80% so the platform mask
  // never clips them. Scale + translate the marks toward center.
  const markScale = scale * (inset ? 0.78 : 1);
  const offset = inset ? (size - 64 * markScale) / 2 : 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let color = null;
      // Background (rounded for "any" maskable bleeds to full-bleed when inset).
      const bgFull = inset ? true : hypotInRoundedRect(x + 0.5, y + 0.5, 0, 0, size, size, radius);
      if (bgFull) color = BG;
      // Marks (scaled into viewBox space).
      const vx = (x + 0.5 - offset) / markScale;
      const vy = (y + 0.5 - offset) / markScale;
      for (const [mx, my, mw, mh, mrx, mc] of MARKS) {
        if (hypotInRoundedRect(vx, vy, mx, my, mw, mh, mrx)) {
          color = mc;
          break;
        }
      }
      const i = (y * size + x) * 4;
      if (color) {
        buf[i] = color[0];
        buf[i + 1] = color[1];
        buf[i + 2] = color[2];
        buf[i + 3] = 0xff;
      } else {
        buf[i + 3] = 0x00; // transparent outside rounded "any" bg
      }
    }
  }
  return buf;
}

// --- Minimal PNG encoder (RGBA, no interlace) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // Filtered scanlines (filter byte 0 per row).
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const iconsDir = join(root, "public", "icons");
const appDir = join(root, "src", "app");
mkdirSync(iconsDir, { recursive: true });

const targets = [
  { file: join(iconsDir, "icon-192.png"), size: 192, opts: { rounded: true, inset: false } },
  { file: join(iconsDir, "icon-512.png"), size: 512, opts: { rounded: true, inset: false } },
  {
    file: join(iconsDir, "icon-maskable-192.png"),
    size: 192,
    opts: { rounded: false, inset: true },
  },
  {
    file: join(iconsDir, "icon-maskable-512.png"),
    size: 512,
    opts: { rounded: false, inset: true },
  },
  // Apple touch icon: opaque square (iOS applies its own mask), no transparency.
  { file: join(appDir, "apple-icon.png"), size: 180, opts: { rounded: false, inset: false } },
];

for (const { file, size, opts } of targets) {
  const rgba = render(size, opts);
  writeFileSync(file, encodePng(rgba, size));
  console.log(`[gen-icons] ${file} (${size}x${size})`);
}
