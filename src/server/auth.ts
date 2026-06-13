import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { platformDb } from "./db/platform";
import * as schema from "./db/platform-schema";
import { serverEnv, hasResend } from "./env";
import { sendEmail, emailLayout, checkEmailThrottle } from "./email";

const socialProviders =
  serverEnv.googleClientId && serverEnv.googleClientSecret
    ? {
        google: {
          clientId: serverEnv.googleClientId,
          clientSecret: serverEnv.googleClientSecret,
        },
      }
    : undefined;

export const auth = betterAuth({
  secret: serverEnv.authSecret,
  baseURL: serverEnv.authUrl,
  // Only the deployment's own origin — plus the pinned companion-extension
  // origin (sign-out from the panel) — may drive auth flows (CSRF hardening —
  // Better Auth rejects state-changing requests from other origins).
  trustedOrigins: [serverEnv.authUrl, serverEnv.extensionOrigin].filter(Boolean),
  database: drizzleAdapter(platformDb, {
    provider: "sqlite",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh the expiry once per day of activity
    // Short-lived signed cookie mirror of the session — getSession() skips the
    // platform-DB round trip for 5 minutes at a time (a DB hit per request
    // otherwise). Sign-out clears the cookie; worst case a revoked session
    // stays valid 5 min on another device, which is acceptable here.
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8, // matches the signup UI ("8+ characters")
    maxPasswordLength: 128,
    // Email verification gates DB provisioning (abuse control). Skipped in dev without Resend.
    requireEmailVerification: hasResend(),
    sendResetPassword: async ({ user, url }) => {
      // Durable per-account cooldown + daily cap. Silently skip when throttled —
      // Better Auth still reports success to the caller (anti-enumeration).
      if (!(await checkEmailThrottle(user.email, "reset"))) return;
      await sendEmail(
        user.email,
        "Reset your TradeMarkk password",
        emailLayout("Password reset", "Click below to reset your password.", "Reset password", url)
      );
    },
  },
  emailVerification: {
    sendOnSignUp: hasResend(),
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      // Silent skip when throttled (success still reported; anti-enumeration).
      if (!(await checkEmailThrottle(user.email, "verification"))) return;
      await sendEmail(
        user.email,
        "Verify your TradeMarkk email",
        emailLayout(
          "Verify your email",
          "Welcome to TradeMarkk! Verify your email to start journaling.",
          "Verify email",
          url
        )
      );
    },
  },
  // Better Auth's own global limiter (default in-memory storage on serverless,
  // so this is a cheap per-instance brake). Durable per-IP email caps live in
  // the auth route wrapper (src/app/api/auth/[...all]/route.ts), backed by our
  // platform-DB rateLimit().
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
  },
  socialProviders,
});

export type AuthSession = typeof auth.$Infer.Session;
