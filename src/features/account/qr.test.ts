import { describe, it, expect } from "vitest";
import { encodeQr } from "./qr";

/**
 * Structural tests for the QR encoder. Full scannability (matrix → decode round
 * trip) was verified offline against the `jsQR` decoder for every version 1-10
 * and the real otpauth:// URIs; these assert the invariants that protect that
 * correctness from regressing (size selection, finder patterns, determinism).
 */

/** A finder pattern is a 7x7 block: dark border, light ring, 3x3 dark centre. */
function hasFinder(m: boolean[][], r0: number, c0: number): boolean {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const expected =
        r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      if (m[r0 + r]![c0 + c] !== expected) return false;
    }
  }
  return true;
}

describe("encodeQr", () => {
  it("produces a square matrix sized to the standard 21+4·(v-1) for the payload", () => {
    const small = encodeQr("HELLO"); // version 1
    expect(small.length).toBe(21);
    expect(small.every((row) => row!.length === 21)).toBe(true);

    const otp = encodeQr(
      "otpauth://totp/TradeMarkk:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=TradeMarkk"
    );
    // A typical otpauth URI lands on a modest version; size is one of the valid
    // QR sizes and grows by 4 per version.
    expect((otp.length - 21) % 4).toBe(0);
    expect(otp.length).toBeGreaterThanOrEqual(21);
  });

  it("places all three finder patterns at the standard corners", () => {
    const m = encodeQr("otpauth://totp/TradeMarkk:a@b.com?secret=JBSWY3DPEHPK3PXP");
    const n = m.length;
    expect(hasFinder(m, 0, 0)).toBe(true); // top-left
    expect(hasFinder(m, 0, n - 7)).toBe(true); // top-right
    expect(hasFinder(m, n - 7, 0)).toBe(true); // bottom-left
  });

  it("keeps the timing patterns alternating between the finders", () => {
    const m = encodeQr("HELLO");
    const n = m.length;
    // Row 6 / col 6 timing modules alternate dark/light from index 8 to n-8.
    for (let i = 8; i < n - 8; i++) {
      expect(m[6]![i]).toBe(i % 2 === 0);
      expect(m[i]![6]).toBe(i % 2 === 0);
    }
  });

  it("is deterministic — same input yields an identical matrix", () => {
    const a = encodeQr("otpauth://totp/TradeMarkk:x@y.com?secret=KZXW6YTBOI4XAZLO");
    const b = encodeQr("otpauth://totp/TradeMarkk:x@y.com?secret=KZXW6YTBOI4XAZLO");
    expect(a).toEqual(b);
  });

  it("scales the version up for longer payloads", () => {
    const short = encodeQr("a@b.com");
    const long = encodeQr("z".repeat(120));
    expect(long.length).toBeGreaterThan(short.length);
  });

  it("throws for a payload beyond the supported versions", () => {
    expect(() => encodeQr("z".repeat(400))).toThrow();
  });
});
