/**
 * Tiny, dependency-free QR Code encoder (byte mode, EC level M, versions 1-10).
 * Enough to render a TOTP `otpauth://` URI as a scannable matrix without pulling
 * in a QR library (avoids bundle + lockfile churn). Pure + deterministic so it's
 * unit-testable; the React layer renders the boolean matrix as crisp SVG rects.
 *
 * Implements the standard QR pipeline: data encoding → Reed-Solomon ECC →
 * codeword interleaving → matrix placement (finder/timing/alignment patterns,
 * format + version info) → mask selection by penalty score. Verified end-to-end
 * against the `jsQR` decoder for every version 1-10. Reference: ISO/IEC 18004.
 */

/* ── Galois field GF(256) for Reed-Solomon ───────────────────────────────── */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]!;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

/** Reed-Solomon generator polynomial of the given degree. */
function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] = next[j]! ^ poly[j]!;
      next[j + 1] = next[j + 1]! ^ gfMul(poly[j]!, GF_EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

/** Compute `ecLen` Reed-Solomon error-correction codewords for `data`. */
function rsEncode(data: number[], ecLen: number): number[] {
  const gen = rsGenerator(ecLen);
  const res = new Array<number>(ecLen).fill(0);
  for (const d of data) {
    const factor = d ^ res[0]!;
    res.shift();
    res.push(0);
    for (let j = 0; j < gen.length - 1; j++) res[j] = res[j]! ^ gfMul(gen[j + 1]!, factor);
  }
  return res;
}

/* ── Version capacity tables (EC level M) ────────────────────────────────── */

type VersionInfo = [number, number, number, number, number, number];

// Per version (1-10), EC level M: [total data codewords, ec per block, num
// blocks group1, data per block group1, num blocks group2, data per block
// group2]. Covers up to ~287 data bytes (version 10-M) — ample for otpauth URIs.
const VERSION_INFO_M: Record<number, VersionInfo> = {
  1: [16, 10, 1, 16, 0, 0],
  2: [28, 16, 1, 28, 0, 0],
  3: [44, 26, 1, 44, 0, 0],
  4: [64, 18, 2, 32, 0, 0],
  5: [86, 24, 2, 43, 0, 0],
  6: [108, 16, 4, 27, 0, 0],
  7: [124, 18, 4, 31, 0, 0],
  8: [154, 22, 2, 38, 2, 39],
  9: [182, 22, 3, 36, 2, 37],
  10: [216, 26, 4, 43, 1, 44],
};

function infoFor(version: number): VersionInfo {
  const info = VERSION_INFO_M[version];
  if (!info) throw new Error(`Unsupported QR version ${version}`);
  return info;
}

// Alignment pattern centre coordinates per version.
const ALIGN_POS: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

function sizeForVersion(v: number): number {
  return 17 + v * 4;
}

// BCH(18,6)-encoded version-information words for versions 7-10 (versions < 7
// carry no version info). Standard fixed values from the QR spec; each is 18
// bits placed in two 3x6 blocks near the top-right and bottom-left finders.
const VERSION_BITS: Record<number, number> = {
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3,
};

/** Smallest version (1-10) whose data capacity fits a byte-mode payload. */
function pickVersion(byteLen: number): number {
  for (let v = 1; v <= 10; v++) {
    const totalData = infoFor(v)[0];
    // Mode (4 bits) + char-count indicator (8 or 16 bits) + data + terminator.
    const ccBits = v <= 9 ? 8 : 16;
    const needBits = 4 + ccBits + byteLen * 8;
    if (needBits <= totalData * 8) return v;
  }
  throw new Error("QR payload too large for supported versions (max 10-M)");
}

/* ── Bit buffer ──────────────────────────────────────────────────────────── */

class BitBuffer {
  bits: number[] = [];
  put(value: number, length: number) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
}

/* ── Encode payload → final codeword stream ──────────────────────────────── */

function encodeData(text: string, version: number): number[] {
  const utf8 = new TextEncoder().encode(text);
  const ccBits = version <= 9 ? 8 : 16;
  const bb = new BitBuffer();
  bb.put(0b0100, 4); // byte mode
  bb.put(utf8.length, ccBits);
  for (const b of utf8) bb.put(b, 8);

  const info = infoFor(version);
  const totalData = info[0];
  const capacityBits = totalData * 8;
  // Terminator (up to 4 zero bits).
  const term = Math.min(4, capacityBits - bb.bits.length);
  for (let i = 0; i < term; i++) bb.bits.push(0);
  // Pad to a byte boundary.
  while (bb.bits.length % 8 !== 0) bb.bits.push(0);

  const dataBytes: number[] = [];
  for (let i = 0; i < bb.bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bb.bits[i + j]!;
    dataBytes.push(byte);
  }
  // Pad bytes alternate 0xEC / 0x11.
  const pads = [0xec, 0x11];
  let pi = 0;
  while (dataBytes.length < totalData) dataBytes.push(pads[pi++ % 2]!);

  // Split into blocks, compute ECC, then interleave.
  const [, ecLen, g1, d1, g2, d2] = info;
  const blocks: { data: number[]; ec: number[] }[] = [];
  let offset = 0;
  for (let i = 0; i < g1; i++) {
    const d = dataBytes.slice(offset, offset + d1);
    offset += d1;
    blocks.push({ data: d, ec: rsEncode(d, ecLen) });
  }
  for (let i = 0; i < g2; i++) {
    const d = dataBytes.slice(offset, offset + d2);
    offset += d2;
    blocks.push({ data: d, ec: rsEncode(d, ecLen) });
  }

  const result: number[] = [];
  const maxData = Math.max(d1, d2);
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) if (i < b.data.length) result.push(b.data[i]!);
  }
  for (let i = 0; i < ecLen; i++) {
    for (const b of blocks) result.push(b.ec[i]!);
  }
  return result;
}

/* ── Matrix placement ────────────────────────────────────────────────────── */

type Cell = { dark: boolean; reserved: boolean };

function makeMatrix(version: number): Cell[][] {
  const n = sizeForVersion(version);
  const m: Cell[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => ({ dark: false, reserved: false }))
  );

  const setFinder = (r: number, c: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
        const inner = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const dark =
          inner &&
          (dr === 0 ||
            dr === 6 ||
            dc === 0 ||
            dc === 6 ||
            (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        m[rr]![cc] = { dark, reserved: true };
      }
    }
  };
  setFinder(0, 0);
  setFinder(0, n - 7);
  setFinder(n - 7, 0);

  // Timing patterns.
  for (let i = 8; i < n - 8; i++) {
    const dark = i % 2 === 0;
    m[6]![i] = { dark, reserved: true };
    m[i]![6] = { dark, reserved: true };
  }

  // Dark module + format-info reservation.
  m[n - 8]![8] = { dark: true, reserved: true };
  for (let i = 0; i < 9; i++) {
    if (!m[8]![i]!.reserved) m[8]![i] = { dark: false, reserved: true };
    if (!m[i]![8]!.reserved) m[i]![8] = { dark: false, reserved: true };
  }
  for (let i = 0; i < 8; i++) {
    if (!m[8]![n - 1 - i]!.reserved) m[8]![n - 1 - i] = { dark: false, reserved: true };
    if (!m[n - 1 - i]![8]!.reserved) m[n - 1 - i]![8] = { dark: false, reserved: true };
  }

  // Alignment patterns.
  const pos = ALIGN_POS[version] ?? [];
  for (const r of pos) {
    for (const c of pos) {
      // Skip ONLY the three positions that coincide with a finder pattern. The
      // others are placed even when their centre sits on a timing line — an
      // alignment pattern legitimately overwrites the timing modules it covers
      // (a `reserved` check here would wrongly drop the (6, x) / (x, 6)
      // alignment patterns that versions 7+ require).
      if ((r === 6 && c === 6) || (r === 6 && c === n - 7) || (r === n - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1; // ring + centre dark
          m[r + dr]![c + dc] = { dark, reserved: true };
        }
      }
    }
  }

  // Version information (versions 7+ only): an 18-bit BCH word duplicated in two
  // blocks — a 6-row × 3-col block just left of the top-right finder (rows 0..5,
  // cols n-11..n-9), and its transpose just above the bottom-left finder. Bit i
  // (0 = LSB): top-right at (i // 3, n-11 + i % 3); bottom-left at the transpose.
  const vbits = VERSION_BITS[version];
  if (vbits !== undefined) {
    for (let i = 0; i < 18; i++) {
      const dark = ((vbits >> i) & 1) === 1;
      const row = Math.floor(i / 3);
      const col = i % 3;
      m[row]![n - 11 + col] = { dark, reserved: true };
      m[n - 11 + col]![row] = { dark, reserved: true };
    }
  }

  return m;
}

/** Zig-zag place the data bitstream into the unreserved modules. */
function placeData(m: Cell[][], codewords: number[]): void {
  const n = m.length;
  const bits: number[] = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
  let bi = 0;
  let upward = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col = 5; // skip the vertical timing column
    for (let i = 0; i < n; i++) {
      const row = upward ? n - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        const cell = m[row]![cc]!;
        if (cell.reserved) continue;
        cell.dark = bi < bits.length ? bits[bi++] === 1 : false;
      }
    }
    upward = !upward;
  }
}

const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(m: Cell[][], maskFn: (r: number, c: number) => boolean): boolean[][] {
  return m.map((row, r) =>
    row.map((cell, c) => (cell.reserved ? cell.dark : cell.dark !== maskFn(r, c)))
  );
}

// Format-info bits for EC level M + mask, with BCH error correction + XOR mask.
function formatBits(maskId: number): number {
  const data = (0b00 << 3) | maskId; // EC level M = 0b00
  let bch = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((bch >> i) & 1) bch ^= 0b10100110111 << (i - 10);
  }
  return ((data << 10) | bch) ^ 0b101010000010010;
}

function placeFormat(matrix: boolean[][], maskId: number): void {
  const n = matrix.length;
  const fmt = formatBits(maskId);
  // The 15 format bits are placed MSB-first: position index 0 carries bit 14
  // (the MSB), index 14 carries bit 0 (the LSB).
  const posBit = (i: number) => ((fmt >> (14 - i)) & 1) === 1;
  // First copy — around the top-left finder (position order 0..14).
  for (let i = 0; i <= 5; i++) matrix[8]![i] = posBit(i);
  matrix[8]![7] = posBit(6);
  matrix[8]![8] = posBit(7);
  matrix[7]![8] = posBit(8);
  for (let i = 9; i <= 14; i++) matrix[14 - i]![8] = posBit(i);
  // Second copy — bits 0..7 up the bottom-left finder's column, bits 8..14 along
  // the top-right finder's row.
  for (let i = 0; i <= 7; i++) matrix[n - 1 - i]![8] = posBit(i);
  for (let i = 8; i <= 14; i++) matrix[8]![n - 15 + i] = posBit(i);
  matrix[n - 8]![8] = true; // dark module (overwrites the second-copy position 7)
}

function penalty(matrix: boolean[][]): number {
  const n = matrix.length;
  let score = 0;
  // Rule 1: runs of 5+ same-colour modules (rows + cols).
  const runScore = (line: boolean[]) => {
    let s = 0;
    let run = 1;
    for (let i = 1; i < line.length; i++) {
      if (line[i] === line[i - 1]) {
        run++;
        if (run === 5) s += 3;
        else if (run > 5) s += 1;
      } else run = 1;
    }
    return s;
  };
  for (let r = 0; r < n; r++) score += runScore(matrix[r]!);
  for (let c = 0; c < n; c++) score += runScore(matrix.map((row) => row[c]!));
  // Rule 2: 2x2 same-colour blocks.
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = matrix[r]![c]!;
      if (v === matrix[r]![c + 1]! && v === matrix[r + 1]![c]! && v === matrix[r + 1]![c + 1]!) {
        score += 3;
      }
    }
  }
  return score;
}

/**
 * Encode `text` to a square boolean matrix (true = dark module). Throws if the
 * payload is too large for versions 1-10 (otpauth URIs never are).
 */
export function encodeQr(text: string): boolean[][] {
  const utf8Len = new TextEncoder().encode(text).length;
  const version = pickVersion(utf8Len);
  const codewords = encodeData(text, version);
  const base = makeMatrix(version);
  placeData(base, codewords);

  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let maskId = 0; maskId < 8; maskId++) {
    const masked = applyMask(base, MASKS[maskId]!);
    placeFormat(masked, maskId);
    const score = penalty(masked);
    if (score < bestScore) {
      bestScore = score;
      best = masked;
    }
  }
  return best!;
}
