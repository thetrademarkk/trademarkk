/**
 * Pure builder for the one-time-passcode email (subject + HTML), keyed by the
 * Better Auth OTP `type`. Kept free of `server-only` and side effects so it can
 * be unit-tested directly; the send itself goes through the blank-creds-safe
 * `sendEmail()` in ./email.
 */

/** The OTP flavours Better Auth's emailOTP plugin emits. */
export type OtpType = "sign-in" | "email-verification" | "forget-password" | "change-email";

/** Human-readable purpose line per OTP type, for the email body + subject. */
const PURPOSE: Record<OtpType, { subject: string; lead: string }> = {
  "email-verification": {
    subject: "Verify your TradeMarkk email",
    lead: "Enter this code to verify your email and finish setting up your journal.",
  },
  "sign-in": {
    subject: "Your TradeMarkk sign-in code",
    lead: "Enter this code to sign in to TradeMarkk.",
  },
  "forget-password": {
    subject: "Your TradeMarkk password-reset code",
    lead: "Enter this code to reset your TradeMarkk password.",
  },
  "change-email": {
    subject: "Confirm your new TradeMarkk email",
    lead: "Enter this code to confirm your new email address.",
  },
};

/**
 * Builds the OTP email. The code is rendered large + letter-spaced so it's easy
 * to read and copy on mobile. No links — anti-phishing-friendly: the recipient
 * only ever types the code back into the app they opened themselves.
 */
export function otpEmail(otp: string, type: OtpType): { subject: string; html: string } {
  const { subject, lead } = PURPOSE[type] ?? PURPOSE["email-verification"];
  const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0A0A0B;color:#FAFAFA;border-radius:12px">
    <h2 style="margin:0 0 8px">TradeMarkk</h2>
    <h3 style="margin:0 0 16px;color:#A1A1AA;font-weight:500">Your verification code</h3>
    <p style="line-height:1.6">${lead}</p>
    <div style="margin:24px 0;font-size:32px;font-weight:700;letter-spacing:8px;color:#fff;background:#1A1A1D;border-radius:10px;padding:16px;text-align:center">${otp}</div>
    <p style="line-height:1.6;color:#A1A1AA;font-size:13px">This code expires in 10 minutes. If you didn't request it, you can safely ignore this email.</p>
    <p style="margin-top:24px;color:#71717A;font-size:12px">Mark your trade, every day.</p>
  </div>`;
  return { subject, html };
}
