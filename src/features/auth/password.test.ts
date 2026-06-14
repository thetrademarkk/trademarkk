import { describe, expect, it } from "vitest";
import {
  checkPassword,
  passwordsMatch,
  MIN_PASSWORD_LENGTH,
  NEUTRAL_RESET_NOTICE,
  NEUTRAL_OTP_NOTICE,
} from "./password";

describe("checkPassword", () => {
  it("rejects passwords shorter than the minimum", () => {
    const r = checkPassword("Ab1!");
    expect(r.valid).toBe(false);
    expect(r.reason).toContain(String(MIN_PASSWORD_LENGTH));
    expect(r.score).toBe(0);
  });

  it("accepts a password at exactly the minimum length", () => {
    const r = checkPassword("abcdefgh"); // 8 chars, letters only
    expect(r.valid).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.score).toBeGreaterThanOrEqual(1);
  });

  it("rejects an over-long password", () => {
    const r = checkPassword("a".repeat(129));
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/too long/i);
  });

  it("scores a long, varied password highest (3)", () => {
    const r = checkPassword("Sup3r-Secret-Pass"); // >=12, mixes letter+digit+symbol
    expect(r.valid).toBe(true);
    expect(r.score).toBe(3);
  });

  it("scores a short-but-valid single-class password lower than a varied one", () => {
    const weak = checkPassword("password"); // 8, letters only
    const strong = checkPassword("passw0rd!2026");
    expect(weak.score).toBeLessThan(strong.score);
  });
});

describe("passwordsMatch", () => {
  it("is true only for identical, non-empty strings", () => {
    expect(passwordsMatch("abcdefgh", "abcdefgh")).toBe(true);
    expect(passwordsMatch("abcdefgh", "abcdefgi")).toBe(false);
    expect(passwordsMatch("", "")).toBe(false);
  });
});

describe("neutral notices (anti-enumeration)", () => {
  it("never reveal whether an account exists", () => {
    for (const msg of [NEUTRAL_RESET_NOTICE, NEUTRAL_OTP_NOTICE]) {
      expect(msg.toLowerCase()).toContain("if an account exists");
      // Must NOT assert that the email definitely was/wasn't found.
      expect(msg).not.toMatch(/\b(no account|not found|doesn't exist|sent you)\b/i);
    }
  });
});
