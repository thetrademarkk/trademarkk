import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";
import * as schema from "./db/platform-schema";

/**
 * Server integration test for the two new self-serve flows, exercised against a
 * real (in-memory) Better Auth instance + libsql DB:
 *   1. request-reset → reset-password (token captured from the SAME callback
 *      production uses — no real email, no DB scraping).
 *   2. email-OTP issue → verify (code captured from the sendVerificationOTP
 *      callback) → wrong code is rejected.
 * Mirrors the production config (drizzleAdapter + emailOTP) but with capture
 * callbacks instead of Resend, so it proves the wiring end to end.
 */

let client: Client;
let db: ReturnType<typeof drizzle<typeof schema>>;

// Captured by the send callbacks (the production no-op-safe send path).
let lastResetUrl = "";
let lastOtp = "";

function makeAuth() {
  return betterAuth({
    secret: "test-secret-test-secret-test-secret",
    baseURL: "http://localhost:3000",
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      // Verification OFF here so signUp yields a session we can act on directly;
      // the OTP path is tested explicitly below via the plugin endpoints.
      requireEmailVerification: false,
      sendResetPassword: async ({ url }) => {
        lastResetUrl = url;
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        async sendVerificationOTP({ otp }) {
          lastOtp = otp;
        },
      }),
    ],
  });
}

let auth: ReturnType<typeof makeAuth>;

beforeAll(async () => {
  client = createClient({ url: ":memory:" });
  db = drizzle(client, { schema });
  // Minimal Better Auth tables (the columns these flows touch).
  await client.executeMultiple(`
    CREATE TABLE user (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      email_verified INTEGER NOT NULL DEFAULT 0, image TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      last_password_reset_email_at INTEGER,
      password_reset_email_count_today INTEGER NOT NULL DEFAULT 0,
      last_verification_email_at INTEGER,
      verification_email_count_today INTEGER NOT NULL DEFAULT 0,
      last_otp_email_at INTEGER,
      otp_email_count_today INTEGER NOT NULL DEFAULT 0,
      status TEXT
    );
    CREATE TABLE session (
      id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, token TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      ip_address TEXT, user_agent TEXT,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
    );
    CREATE TABLE account (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, provider_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      access_token TEXT, refresh_token TEXT, id_token TEXT,
      access_token_expires_at INTEGER, refresh_token_expires_at INTEGER,
      scope TEXT, password TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE verification (
      id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL,
      expires_at INTEGER NOT NULL, created_at INTEGER, updated_at INTEGER
    );
  `);
  auth = makeAuth();
});

afterAll(() => client.close());

beforeEach(() => {
  lastResetUrl = "";
  lastOtp = "";
});

const EMAIL = "flowtest@example.com";

describe("password reset flow", () => {
  it("request-reset emails a token, and the token sets a new password", async () => {
    await auth.api.signUpEmail({
      body: { email: EMAIL, password: "originalPass1", name: "Flow Test" },
    });

    await auth.api.requestPasswordReset({
      body: { email: EMAIL, redirectTo: "/reset-password" },
    });
    // Better Auth 1.6 emails /reset-password/<TOKEN>?callbackURL=…; the GET at
    // that path validates the token then 302s to the page as ?token=<TOKEN>
    // (which the reset page reads). The token is the last path segment.
    expect(lastResetUrl).toContain("/reset-password/");
    const token = new URL(lastResetUrl).pathname.split("/").pop();
    expect(token).toBeTruthy();

    // Reset to a new password using the captured token.
    await auth.api.resetPassword({ body: { newPassword: "brandNewPass9", token: token! } });

    // The new password now signs in; the old one no longer does.
    const ok = await auth.api.signInEmail({
      body: { email: EMAIL, password: "brandNewPass9" },
    });
    expect(ok.token).toBeTruthy();

    await expect(
      auth.api.signInEmail({ body: { email: EMAIL, password: "originalPass1" } })
    ).rejects.toBeTruthy();
  });

  it("does not throw for an unknown email (anti-enumeration)", async () => {
    await expect(
      auth.api.requestPasswordReset({ body: { email: "ghost@example.com" } })
    ).resolves.toBeTruthy();
  });
});

describe("email OTP verify flow", () => {
  const OTP_EMAIL = "otpflow@example.com";

  it("issues a 6-digit code and verifies the email with it", async () => {
    await auth.api.signUpEmail({
      body: { email: OTP_EMAIL, password: "otpUserPass1", name: "OTP User" },
    });

    await auth.api.sendVerificationOTP({
      body: { email: OTP_EMAIL, type: "email-verification" },
    });
    expect(lastOtp).toMatch(/^\d{6}$/);

    const verified = await auth.api.verifyEmailOTP({
      body: { email: OTP_EMAIL, otp: lastOtp },
    });
    expect(verified).toBeTruthy();
  });

  it("rejects a wrong code", async () => {
    await auth.api.sendVerificationOTP({
      body: { email: OTP_EMAIL, type: "email-verification" },
    });
    await expect(
      auth.api.verifyEmailOTP({ body: { email: OTP_EMAIL, otp: "000000" } })
    ).rejects.toBeTruthy();
  });
});
