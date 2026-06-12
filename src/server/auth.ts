import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { platformDb } from "./db/platform";
import * as schema from "./db/platform-schema";
import { serverEnv, hasResend } from "./env";
import { sendEmail, emailLayout } from "./email";

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
  // Only the deployment's own origin may drive auth flows (CSRF hardening —
  // Better Auth rejects state-changing requests from other origins).
  trustedOrigins: [serverEnv.authUrl],
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
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8, // matches the signup UI ("8+ characters")
    maxPasswordLength: 128,
    // Email verification gates DB provisioning (abuse control). Skipped in dev without Resend.
    requireEmailVerification: hasResend(),
    sendResetPassword: async ({ user, url }) => {
      await sendEmail(
        user.email,
        "Reset your TradeMark password",
        emailLayout("Password reset", "Click below to reset your password.", "Reset password", url)
      );
    },
  },
  emailVerification: {
    sendOnSignUp: hasResend(),
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail(
        user.email,
        "Verify your TradeMark email",
        emailLayout(
          "Verify your email",
          "Welcome to TradeMark! Verify your email to start journaling.",
          "Verify email",
          url
        )
      );
    },
  },
  socialProviders,
});

export type AuthSession = typeof auth.$Infer.Session;
