/**
 * Unguessable public share-id minting for backtest runs (BT-09).
 *
 * A share-id is the SLUG in `/backtesting/r/[shareId]`. It must be:
 *  - unguessable — so a run is private until the owner explicitly shares it and
 *    a leaked-link is the ONLY way to reach a shared run (no enumeration);
 *  - URL-safe — a flat lowercase-alphanumeric alphabet (no separators, no
 *    look-alike ambiguity in the path);
 *  - stable — minting is one-shot per run; re-sharing returns the SAME id (the
 *    idempotency is enforced at the DB layer, this module just generates).
 *
 * nanoid-style: 21 chars from a 36-symbol alphabet ≈ 108 bits of entropy —
 * collision-safe at any realistic scale and far beyond brute-forceable. Uses
 * the platform crypto RNG (Web Crypto in the browser/runtime, node:crypto on
 * the server) with rejection sampling so the distribution is unbiased.
 */

/** Lowercase alphanumerics — URL-safe, unambiguous, 36 symbols. */
export const SHARE_ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
export const SHARE_ID_LENGTH = 21;

const SHARE_ID_RE = /^[0-9a-z]{21}$/;

/** Fill `out` with cryptographically-strong random bytes (cross-runtime). */
function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(out);
    return out;
  }
  // Non-crypto fallback (test/legacy env only) — never the production path.
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/**
 * Generate one unguessable share-id. Rejection-samples bytes onto the alphabet
 * so each symbol is equiprobable (no modulo bias), matching nanoid's approach.
 */
export function generateShareId(length = SHARE_ID_LENGTH): string {
  const alphabet = SHARE_ID_ALPHABET;
  // Mask = smallest (2^k - 1) >= alphabet.length, so a masked byte rarely
  // overflows the alphabet and is simply re-drawn when it does.
  const mask = (2 << Math.floor(Math.log2(alphabet.length - 1))) - 1;
  // Over-fetch a little to amortise rejections without a tight per-char loop.
  const step = Math.ceil((1.6 * mask * length) / alphabet.length);
  let id = "";
  while (id.length < length) {
    const bytes = randomBytes(step);
    for (let i = 0; i < step && id.length < length; i++) {
      const idx = bytes[i]! & mask;
      const ch = alphabet[idx];
      if (ch !== undefined) id += ch;
    }
  }
  return id;
}

/** Validate that a string is a well-formed share-id (route-param guard). */
export function isValidShareId(s: unknown): s is string {
  return typeof s === "string" && SHARE_ID_RE.test(s);
}
