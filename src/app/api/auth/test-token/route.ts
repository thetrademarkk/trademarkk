import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

/**
 * TEST-ONLY hook to read the latest password-reset token / email-OTP code for an
 * email straight from the platform `verification` table — so e2e can drive the
 * reset + OTP flows WITHOUT a real inbox (Resend is blank in e2e). It is HARD
 * DISABLED unless AUTH_TEST_HOOK=1 is set at runtime: in production that env var
 * is never present, so this route returns 404 and leaks nothing. NEVER set
 * AUTH_TEST_HOOK in a real deployment.
 */
export const dynamic = "force-dynamic";

function disabled() {
  return process.env.AUTH_TEST_HOOK !== "1";
}

export async function GET(req: Request) {
  if (disabled()) return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = new URL(req.url);
  const email = url.searchParams.get("email");
  // kind: "reset" → password-reset token, "otp" → email-verification code.
  const kind = url.searchParams.get("kind") ?? "otp";
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const { platformDb } = await import("@/server/db/platform");

  // Reset tokens are keyed by an opaque identifier; OTP rows by
  // `email-verification-otp-<email>` (value is `<otp>` or `<otp>:<attempts>`).
  const identifier = kind === "otp" ? `email-verification-otp-${email}` : null;

  let value: string | null = null;
  if (identifier) {
    const rows = (await platformDb.all(sql`
      SELECT value FROM verification WHERE identifier = ${identifier}
      ORDER BY created_at DESC LIMIT 1
    `)) as { value?: string }[];
    value = rows[0]?.value ?? null;
    // Strip the trailing :attempts counter the plugin appends.
    if (value) value = value.split(":")[0] ?? value;
  } else {
    // Reset token: the verification row's VALUE is the user id and the
    // IDENTIFIER is the token. Find the most recent reset row for this email by
    // joining through the user id.
    const userRows = (await platformDb.all(sql`
      SELECT id FROM user WHERE email = ${email} LIMIT 1
    `)) as { id?: string }[];
    const uid = userRows[0]?.id;
    if (uid) {
      const rows = (await platformDb.all(sql`
        SELECT identifier FROM verification
        WHERE value = ${uid} AND identifier LIKE 'reset-password%'
        ORDER BY created_at DESC LIMIT 1
      `)) as { identifier?: string }[];
      const ident = rows[0]?.identifier ?? null;
      // identifier is `reset-password:<token>` in newer Better Auth.
      value = ident ? (ident.includes(":") ? ident.split(":").slice(1).join(":") : ident) : null;
    }
  }

  return NextResponse.json({ value });
}
