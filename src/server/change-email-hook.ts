import "server-only";
import { sql } from "drizzle-orm";

/**
 * TEST-ONLY capture for the change-email verification token.
 *
 * Better Auth's change-email verification carries its token as a SIGNED JWT in
 * the `/verify-email?token=…` link — it is NOT written to the `verification`
 * table (unlike OTP codes / password-reset tokens), so the e2e suite can't read
 * it from the DB the way it reads those. To keep the change-email flow drivable
 * end-to-end without a real inbox (RESEND blank in e2e), we mirror the token
 * into the `verification` table under a stable identifier so the existing
 * `/api/auth/test-token` hook can return it.
 *
 * This is HARD-GATED behind AUTH_TEST_HOOK=1 — in production that env var is
 * never set, so this is a complete no-op (no DB write, nothing leaked). Mirrors
 * the same gate as the test-token route.
 */
export async function captureChangeEmailToken(email: string, urlOrToken: string): Promise<void> {
  if (process.env.AUTH_TEST_HOOK !== "1") return;
  try {
    // The callback receives a full /verify-email?token=… URL; pull the token
    // out. If a bare token is passed, use it as-is.
    let token = urlOrToken;
    try {
      const u = new URL(urlOrToken);
      token = u.searchParams.get("token") ?? urlOrToken;
    } catch {
      /* not a URL — treat as a bare token */
    }
    const { platformDb } = await import("./db/platform");
    const identifier = `change-email-token-${email}`;
    const now = Date.now();
    // Replace any prior captured token for this email (latest wins), then store.
    await platformDb.run(sql`DELETE FROM verification WHERE identifier = ${identifier}`);
    await platformDb.run(sql`
      INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
      VALUES (${crypto.randomUUID()}, ${identifier}, ${token}, ${now + 60 * 60 * 1000}, ${now}, ${now})
    `);
  } catch (err) {
    // Never let the test hook break the real send path.
    console.error("[change-email-hook] capture failed:", err);
  }
}
