import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import * as schema from "./db/platform-schema";

/**
 * Compute a valid TOTP code for an otpauth:// URI exactly as an authenticator
 * app would: the URI's `secret` is base32-encoded, so decode it to the raw HMAC
 * key before generating the code (Better Auth's verifyTOTP HMACs the raw key).
 */
async function totpForUri(totpURI: string): Promise<string> {
  const b32 = new URL(totpURI).searchParams.get("secret")!;
  const raw = new TextDecoder().decode(base32.decode(b32));
  return createOTP(raw, { period: 30, digits: 6 }).totp();
}

/**
 * Server integration tests for the "Account & security" self-service flows,
 * exercised against a real (in-memory) Better Auth instance + libsql DB:
 *   - change password (old fails / new works) + revokeOtherSessions kills others
 *   - change email pending → verified via the captured verification link token
 *   - 2FA enroll → verify (activation) → sign-in challenge → TOTP + backup code
 *   - revoke a single session removes it from list-sessions
 *
 * The protected-account delete GUARD is unit-tested in features/account; here we
 * prove the auth mechanics end-to-end with the SAME plugins production uses.
 */

let client: Client;
let db: ReturnType<typeof drizzle<typeof schema>>;

// Captured by the verification-email callback (the production no-op-safe path).
let lastVerifyUrl = "";

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
        twoFactor: schema.twoFactor,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: false,
    },
    emailVerification: {
      sendVerificationEmail: async ({ url }) => {
        lastVerifyUrl = url;
      },
    },
    user: {
      changeEmail: {
        enabled: true,
        // Unverified test users take the single-hop verification path; mark this
        // so the verification leg always fires through sendVerificationEmail.
        sendChangeEmailConfirmation: async ({ url }) => {
          lastVerifyUrl = url;
        },
      },
    },
    plugins: [twoFactor({ issuer: "TradeMarkk" })],
  });
}

let auth: ReturnType<typeof makeAuth>;

beforeAll(async () => {
  client = createClient({ url: ":memory:" });
  db = drizzle(client, { schema });
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
      status TEXT,
      two_factor_enabled INTEGER NOT NULL DEFAULT 0
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
    CREATE TABLE two_factor (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      secret TEXT NOT NULL, backup_codes TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 1
    );
  `);
  auth = makeAuth();
});

afterAll(() => client.close());

/** Extract the session cookie from a Better Auth Response's Set-Cookie header. */
function cookieFrom(res: Response): string {
  const set = res.headers.get("set-cookie") ?? "";
  // Keep only the cookie name=value pairs (drop attributes) and rejoin.
  return set
    .split(/,(?=[^;]+=[^;]+)/)
    .map((c) => c.split(";")[0]!.trim())
    .filter(Boolean)
    .join("; ");
}

async function signUp(email: string, password: string) {
  const res = await auth.api.signUpEmail({
    body: { email, password, name: "Acct Test" },
    asResponse: true,
  });
  return cookieFrom(res as Response);
}

async function signIn(email: string, password: string) {
  const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  return { cookie: cookieFrom(res as Response), res: res as Response };
}

const H = (cookie: string) => new Headers({ cookie, origin: "http://localhost:3000" });

describe("change password", () => {
  const email = "cp@example.com";

  it("updates the password (old fails, new works) and revokes other sessions", async () => {
    const cookie = await signUp(email, "originalPass1");
    // A second, independent session that should be killed by revokeOtherSessions.
    const second = await signIn(email, "originalPass1");
    expect(second.cookie).toBeTruthy();

    await auth.api.changePassword({
      body: {
        currentPassword: "originalPass1",
        newPassword: "brandNewPass9",
        revokeOtherSessions: true,
      },
      headers: H(cookie),
    });

    // New password signs in; old one no longer does.
    const ok = await auth.api.signInEmail({ body: { email, password: "brandNewPass9" } });
    expect(ok.token).toBeTruthy();
    await expect(
      auth.api.signInEmail({ body: { email, password: "originalPass1" } })
    ).rejects.toBeTruthy();

    // The OTHER session was revoked — it can no longer fetch a session.
    const stale = await auth.api.getSession({ headers: H(second.cookie) });
    expect(stale).toBeNull();
  });
});

describe("change email (pending → verified)", () => {
  const email = "ce@example.com";

  it("stays on the old email until the verification link is followed, then flips", async () => {
    const cookie = await signUp(email, "originalPass1");
    lastVerifyUrl = "";

    await auth.api.changeEmail({
      body: { newEmail: "ce-new@example.com", callbackURL: "/done" },
      headers: H(cookie),
    });

    // Pending: the account email has NOT changed yet.
    const before = await auth.api.getSession({ headers: H(cookie) });
    expect(before?.user.email).toBe(email);
    expect(lastVerifyUrl).toContain("/verify-email");

    // Follow the verification link (carries the signed-JWT token).
    const token = new URL(lastVerifyUrl).searchParams.get("token")!;
    await auth.api.verifyEmail({ query: { token } });

    // The email is now the new one.
    const after = await auth.api.getSession({ headers: H(cookie) });
    expect(after?.user.email).toBe("ce-new@example.com");
  });

  it("returns neutrally (no enumeration) when the new email already exists", async () => {
    const taken = "taken@example.com";
    await signUp(taken, "originalPass1");
    const cookie = await signUp("ce2@example.com", "originalPass1");
    // Must not throw / must not reveal the collision.
    await expect(
      auth.api.changeEmail({ body: { newEmail: taken }, headers: H(cookie) })
    ).resolves.toBeTruthy();
    // The requester's email is unchanged.
    const s = await auth.api.getSession({ headers: H(cookie) });
    expect(s?.user.email).toBe("ce2@example.com");
  });
});

describe("active sessions", () => {
  const email = "sess@example.com";

  it("lists sessions and revoking one removes it", async () => {
    const a = await signUp(email, "originalPass1");
    const b = await signIn(email, "originalPass1");

    const list = await auth.api.listSessions({ headers: H(a) });
    expect(list.length).toBeGreaterThanOrEqual(2);

    // Revoke the SECOND session's token from the first.
    const bSession = await auth.api.getSession({ headers: H(b.cookie) });
    const bToken = bSession!.session.token;
    await auth.api.revokeSession({ body: { token: bToken }, headers: H(a) });

    const stale = await auth.api.getSession({ headers: H(b.cookie) });
    expect(stale).toBeNull();
    // The first session still works.
    const alive = await auth.api.getSession({ headers: H(a) });
    expect(alive?.user.email).toBe(email);
  });
});

describe("two-factor enroll → challenge → backup code", () => {
  const email = "tfa@example.com";

  it("enrolls with TOTP, challenges on next sign-in, and a backup code works", async () => {
    const cookie = await signUp(email, "originalPass1");

    // Enroll: returns the otpauth URI + backup codes; not yet active.
    const enable = await auth.api.enableTwoFactor({
      body: { password: "originalPass1" },
      headers: H(cookie),
    });
    expect(enable.totpURI).toContain("otpauth://totp/");
    expect(enable.backupCodes.length).toBeGreaterThan(0);

    // Activate by verifying a real TOTP code computed from the URI secret.
    const verify = await auth.api.verifyTOTP({
      body: { code: await totpForUri(enable.totpURI) },
      headers: H(cookie),
    });
    expect(verify.token).toBeTruthy();

    // Next sign-in is now CHALLENGED (no session token; twoFactorRedirect).
    const challenge = await auth.api.signInEmail({
      body: { email, password: "originalPass1" },
      asResponse: true,
    });
    const challengeBody = (await (challenge as Response).clone().json()) as {
      twoFactorRedirect?: boolean;
      token?: string;
    };
    expect(challengeBody.twoFactorRedirect).toBe(true);
    expect(challengeBody.token).toBeFalsy();

    // The 2FA cookie from the challenge lets us complete with a BACKUP CODE.
    const twoFaCookie = cookieFrom(challenge as Response);
    const backup = enable.backupCodes[0]!;
    const done = await auth.api.verifyBackupCode({
      body: { code: backup },
      headers: H(twoFaCookie),
    });
    expect(done.token).toBeTruthy();

    // Re-using the SAME backup code fails (one-time use). A fresh challenge first.
    const challenge2 = await auth.api.signInEmail({
      body: { email, password: "originalPass1" },
      asResponse: true,
    });
    const twoFaCookie2 = cookieFrom(challenge2 as Response);
    await expect(
      auth.api.verifyBackupCode({ body: { code: backup }, headers: H(twoFaCookie2) })
    ).rejects.toBeTruthy();
  });
});
