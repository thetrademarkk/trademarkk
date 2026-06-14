/**
 * Pure, dependency-free logic for the "Account & security" self-service flows.
 * Kept side-effect-free (no `server-only`, no network, no DB) so every rule can
 * be unit-tested directly. The API routes and React components import these.
 */

import { checkPassword, MIN_PASSWORD_LENGTH } from "@/features/auth/password";

/* ── Protected accounts ──────────────────────────────────────────────────── */

/**
 * Accounts that must NEVER be deletable through the self-service delete-account
 * flow (the shared demo account + the owner/admin accounts). The guard is a
 * defense-in-depth backstop: it lives BOTH here (so unit tests prove it) and on
 * the server route. Emails are compared case-insensitively and trimmed.
 */
export const PROTECTED_ACCOUNT_EMAILS = [
  "demo@trademark.app",
  "raashish1601@gmail.com",
  "mahajandeepakshi03@gmail.com",
] as const;

/** Normalize an email for comparison (lowercase + trim). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Whether an account with this email is protected from deletion. Returns true
 * for any of the owner/demo accounts, regardless of case/whitespace. A missing
 * or empty email is treated as NOT protected (the caller still requires a valid
 * session, so this only ever sees a real account email).
 */
export function isProtectedAccount(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = normalizeEmail(email);
  return PROTECTED_ACCOUNT_EMAILS.some((p) => p === e);
}

/* ── Change-password validation ──────────────────────────────────────────── */

export type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * Validates a change-password request BEFORE it hits the server: the current
 * password must be present, the new one must satisfy the shared strength rules,
 * it must differ from the current one, and the confirmation must match. The
 * server still re-checks the current password (Better Auth verifies the hash) —
 * this is the client-side gate that mirrors the server's contract.
 */
export function validateChangePassword(input: ChangePasswordInput): ValidationResult {
  if (!input.currentPassword) {
    return { ok: false, reason: "Enter your current password." };
  }
  const strength = checkPassword(input.newPassword);
  if (!strength.valid) {
    return {
      ok: false,
      reason: strength.reason ?? `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (input.newPassword === input.currentPassword) {
    return { ok: false, reason: "Choose a password different from your current one." };
  }
  if (input.newPassword !== input.confirmPassword) {
    return { ok: false, reason: "The new passwords don't match." };
  }
  return { ok: true };
}

/* ── Change-email pending-state machine ──────────────────────────────────── */

/**
 * The user's email-change state. `idle` = no change in flight; `pending` = a
 * verification was requested for `pendingEmail` and the old email stays active
 * until confirmed; `error` carries a user-facing reason.
 */
export type EmailChangeState =
  | { status: "idle" }
  | { status: "pending"; pendingEmail: string }
  | { status: "error"; reason: string };

/**
 * Validates a requested new email against the current one before sending it to
 * the server. We deliberately do NOT check for collisions here — the server
 * answers identically whether or not the address is taken (anti-enumeration);
 * the UI shows the same neutral "pending" notice either way.
 */
export function validateNewEmail(currentEmail: string, newEmail: string): ValidationResult {
  const next = normalizeEmail(newEmail);
  if (!next) return { ok: false, reason: "Enter your new email address." };
  // A light shape check; the server (and Better Auth's z.email) is authoritative.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
    return { ok: false, reason: "That doesn't look like a valid email address." };
  }
  if (next === normalizeEmail(currentEmail)) {
    return { ok: false, reason: "That's already your email address." };
  }
  return { ok: true };
}

/**
 * Advances the email-change state machine. A successful request always moves to
 * `pending` for the requested address (the old email keeps working until the
 * verification link is followed). The neutral notice never reveals whether the
 * target email already exists.
 */
export function nextEmailChangeState(
  input: ValidationResult,
  pendingEmail: string
): EmailChangeState {
  if (input.ok) return { status: "pending", pendingEmail: normalizeEmail(pendingEmail) };
  return { status: "error", reason: input.reason };
}

/** The single neutral notice shown after a change-email request succeeds. */
export const EMAIL_CHANGE_NOTICE =
  "Check the inbox of your current email and follow the link to confirm the change. Your old email stays active until you do.";

/* ── 2FA backup-code formatting ──────────────────────────────────────────── */

/**
 * Formats backup codes for a downloadable/copyable text block. Pure so a test
 * can assert the exact rendering (one code per line, with a short header). The
 * codes themselves come from Better Auth's `enableTwoFactor` / regenerate
 * endpoints — this only lays them out for the user to save.
 */
export function formatBackupCodes(codes: string[]): string {
  const lines = [
    "TradeMarkk — two-factor backup codes",
    "Each code works once. Keep them somewhere safe.",
    "",
    ...codes.map((c) => c.trim()).filter(Boolean),
    "",
  ];
  return lines.join("\n");
}

/** A filename for the downloaded backup codes (date-stamped, brand-prefixed). */
export function backupCodesFilename(now = new Date()): string {
  const d = now.toISOString().slice(0, 10);
  return `trademarkk-backup-codes-${d}.txt`;
}

/* ── Session device summary ──────────────────────────────────────────────── */

/**
 * Best-effort, dependency-free human label for a session's user-agent string
 * (e.g. "Chrome on Windows"). Purely cosmetic — the security decision is the
 * user's, this just helps them recognize a device. Falls back to "Unknown
 * device" for an empty/odd UA.
 */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iOS/.test(ua)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return os;
  return "Unknown device";
}

/* ── Delete-account confirmation ─────────────────────────────────────────── */

/** The exact phrase a user must type to confirm account deletion. */
export const DELETE_CONFIRM_PHRASE = "DELETE";

/** Whether the typed confirmation matches the required phrase (case-sensitive). */
export function isDeleteConfirmed(typed: string): boolean {
  return typed.trim() === DELETE_CONFIRM_PHRASE;
}
