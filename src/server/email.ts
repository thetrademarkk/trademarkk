import "server-only";
import { sql } from "drizzle-orm";
import { serverEnv, hasResend } from "./env";

/** Sends via Resend when configured; logs to server console in dev otherwise.
 *  NEVER throws — a Resend outage must not break sign-up / password-reset
 *  (those flows treat email delivery as best-effort). */
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!hasResend()) {
    console.log(`[email:dev] To: ${to}\nSubject: ${subject}\n${html}`);
    return;
  }
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(serverEnv.resendApiKey);
    await resend.emails.send({ from: serverEnv.emailFrom, to, subject, html });
  } catch (err) {
    // Look-normal to the caller (anti-enumeration) and keep the auth flow alive.
    console.error("[email] send failed:", err);
  }
}

/* ── Durable email-abuse throttle ─────────────────────────────────────────── */

export type EmailKind = "reset" | "verification" | "otp";

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** Calendar date (YYYY-MM-DD) of an epoch-ms instant, in IST. Exported for tests. */
export function emailDayKey(epochMs: number): string {
  return new Date(epochMs + IST_OFFSET_MS).toISOString().slice(0, 10);
}

type ThrottleRule = {
  cooldownMs: number;
  dailyCap: number;
  lastAtCol: string;
  countCol: string;
};

/** Per-kind cooldown + daily-cap configuration. Exported for tests. */
export const EMAIL_THROTTLE: Record<EmailKind, ThrottleRule> = {
  reset: {
    cooldownMs: 6 * 60 * 60 * 1000, // 6h
    dailyCap: 3,
    lastAtCol: "last_password_reset_email_at",
    countCol: "password_reset_email_count_today",
  },
  verification: {
    cooldownMs: 60 * 60 * 1000, // 1h
    dailyCap: 5,
    lastAtCol: "last_verification_email_at",
    countCol: "verification_email_count_today",
  },
  otp: {
    cooldownMs: 5 * 60 * 1000, // 5min
    dailyCap: 3,
    lastAtCol: "last_otp_email_at",
    countCol: "otp_email_count_today",
  },
};

/**
 * Decides whether an account may be sent another email of `kind` right now,
 * applying a durable per-account cooldown + daily cap stored on the `user` row.
 * The daily counter resets inline when the stored timestamp's IST date differs
 * from today's (no cron). When allowed, atomically records `lastAt = now` and
 * increments `countToday` before returning `true`.
 *
 * Returns `true` (allow) when no matching user exists or the platform DB is
 * unreachable — the throttle is an abuse brake, never a hard gate that could
 * lock a legitimate user out of password reset.
 */
export async function checkEmailThrottle(email: string, kind: EmailKind): Promise<boolean> {
  const rule = EMAIL_THROTTLE[kind];
  const now = Date.now();
  const today = emailDayKey(now);
  try {
    const { platformDb } = await import("./db/platform");

    // `.all()` (not `.get()`) — the libsql driver throws on an empty `.get()`,
    // and a missing account is a normal path here (anti-enumeration).
    const rows = (await platformDb.all(sql`
      SELECT
        ${sql.raw(rule.lastAtCol)} AS last_at,
        ${sql.raw(rule.countCol)} AS count_today
      FROM user WHERE email = ${email}
    `)) as { last_at?: number | null; count_today?: number | null }[];
    const row = rows[0];

    // No such account — nothing to throttle (anti-enumeration: look normal).
    if (!row) return true;

    const lastAt = row.last_at == null ? null : Number(row.last_at);
    const sameDay = lastAt != null && emailDayKey(lastAt) === today;
    const countToday = sameDay ? Number(row.count_today ?? 0) : 0;

    // Cooldown: too soon since the last send of this kind.
    if (lastAt != null && now - lastAt < rule.cooldownMs) return false;

    // Daily cap: this account has already hit its allowance for today.
    if (countToday >= rule.dailyCap) return false;

    // Allowed — record the send. Reset the daily counter inline on a new day.
    const nextCount = sameDay ? countToday + 1 : 1;
    await platformDb.run(sql`
      UPDATE user SET
        ${sql.raw(rule.lastAtCol)} = ${now},
        ${sql.raw(rule.countCol)} = ${nextCount}
      WHERE email = ${email}
    `);
    return true;
  } catch (err) {
    // DB blip — fail open so a legitimate reset is never blocked by infra.
    console.error("[email] throttle check failed:", err);
    return true;
  }
}

export function emailLayout(title: string, body: string, ctaText?: string, ctaUrl?: string) {
  const button = ctaUrl
    ? `<a href="${ctaUrl}" style="display:inline-block;background:#8B5CF6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px">${ctaText}</a>`
    : "";
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0A0A0B;color:#FAFAFA;border-radius:12px">
    <h2 style="margin:0 0 8px">TradeMarkk</h2>
    <h3 style="margin:0 0 16px;color:#A1A1AA;font-weight:500">${title}</h3>
    <p style="line-height:1.6">${body}</p>${button}
    <p style="margin-top:24px;color:#71717A;font-size:12px">Mark your trade, every day.</p>
  </div>`;
}
