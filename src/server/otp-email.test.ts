import { describe, expect, it } from "vitest";
import { otpEmail, type OtpType } from "./otp-email";

const ALL_TYPES: OtpType[] = ["sign-in", "email-verification", "forget-password", "change-email"];

describe("otpEmail", () => {
  it("renders the OTP code into the body for every type", () => {
    for (const type of ALL_TYPES) {
      const { subject, html } = otpEmail("123456", type);
      expect(subject.length).toBeGreaterThan(0);
      expect(html).toContain("123456");
      // No link in an OTP email (anti-phishing): the user types the code back.
      expect(html).not.toContain("href=");
      expect(html).toContain("TradeMarkk");
    }
  });

  it("uses a distinct subject per purpose", () => {
    expect(otpEmail("000000", "email-verification").subject).toMatch(/verify/i);
    expect(otpEmail("000000", "sign-in").subject).toMatch(/sign-in code/i);
    expect(otpEmail("000000", "forget-password").subject).toMatch(/reset/i);
  });

  it("falls back to the verification copy for an unknown type", () => {
    // @ts-expect-error — exercise the runtime fallback for a bad type.
    const { subject } = otpEmail("000000", "bogus");
    expect(subject).toMatch(/verify/i);
  });
});
