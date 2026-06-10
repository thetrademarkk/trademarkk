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
  database: drizzleAdapter(platformDb, {
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
