/**
 * Pure password-strength rules, shared by the signup and reset-password forms so
 * both enforce the SAME minimum the server does (minPasswordLength: 8). Kept
 * dependency-free and side-effect-free for direct unit testing.
 */

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export type PasswordCheck = {
  /** Meets the hard minimum the server will accept. */
  valid: boolean;
  /** A short reason when invalid, else null. */
  reason: string | null;
  /** 0–3 coarse strength score for an optional meter (length + variety). */
  score: number;
};

/**
 * Validates a candidate password and scores it. The hard rule is length only
 * (matches the server's minPasswordLength so the two never disagree); the score
 * is advisory UI sugar (does it mix letters, numbers, and symbols).
 */
export function checkPassword(pw: string): PasswordCheck {
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, reason: `Use at least ${MIN_PASSWORD_LENGTH} characters.`, score: 0 };
  }
  if (pw.length > MAX_PASSWORD_LENGTH) {
    return { valid: false, reason: "That password is too long.", score: 0 };
  }
  let score = 1; // meets the minimum
  if (pw.length >= 12) score++;
  const variety =
    (/[a-zA-Z]/.test(pw) ? 1 : 0) + (/\d/.test(pw) ? 1 : 0) + (/[^a-zA-Z0-9]/.test(pw) ? 1 : 0);
  if (variety >= 2) score++;
  return { valid: true, reason: null, score: Math.min(score, 3) };
}

/** Do two password fields match exactly? */
export function passwordsMatch(a: string, b: string): boolean {
  return a.length > 0 && a === b;
}

/**
 * The single neutral message shown after a password-reset / OTP request,
 * REGARDLESS of whether the email maps to a real account — the linchpin of
 * anti-enumeration (an attacker can't tell a registered email from an unknown
 * one). Centralized so every entry point shows exactly the same wording.
 */
export const NEUTRAL_RESET_NOTICE =
  "If an account exists for that email, a reset link is on its way.";

export const NEUTRAL_OTP_NOTICE =
  "If an account exists for that email, a verification code is on its way.";
