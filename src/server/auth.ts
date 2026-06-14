import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";
import { platformDb } from "./db/platform";
import * as schema from "./db/platform-schema";
import { serverEnv, hasResend, hasGoogle } from "./env";
import { sendEmail, emailLayout, checkEmailThrottle } from "./email";
import { otpEmail } from "./otp-email";

// Google is registered ONLY when both credentials are present (hasGoogle()).
// With them absent the provider is never added, so the social endpoint returns
// "Provider not found" and the UI hides the button (it reads the same gate via
// /api/auth/config) — the page keeps working with email/password.
const socialProviders = hasGoogle()
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
  account: {
    accountLinking: {
      // Link a Google sign-in to an existing same-email account instead of
      // erroring with ?error=account_not_linked. Safe: Google verifies email
      // ownership, so a "Continue with Google" for an email that already has a
      // password account resolves to the SAME user rather than a dead end.
      enabled: true,
      trustedProviders: ["google"],
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
    // Signup verification is handled by the emailOTP plugin (6-digit code, via
    // overrideDefaultEmailVerification below) — so the LINK-based send is NOT
    // fired on signup, else the user would get both a code AND a link. The
    // link callback stays defined for any explicit link-verification request.
    sendOnSignUp: false,
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
  plugins: [
    // 6-digit email OTP. Drives email verification by CODE (mobile-friendly: no
    // link to click) and is reused for passwordless sign-in. OTPs live in the
    // existing `verification` table (no schema change). The send callback runs
    // through the SAME blank-creds-safe sendEmail() + per-account otp throttle
    // as the link flows, so with RESEND/EMAIL_FROM blank it no-ops cleanly and
    // e2e can read the code server-side. 6 digits, 10-min expiry, 5 attempts.
    emailOTP({
      otpLength: 6,
      expiresIn: 60 * 10, // 10 minutes
      allowedAttempts: 5,
      // Sign-up still issues an OTP (verification by code) when email is on; with
      // Resend blank, verification is off and signup yields a session directly —
      // the same immediate-session path a Google return takes.
      sendVerificationOnSignUp: hasResend(),
      overrideDefaultEmailVerification: hasResend(),
      // Plugin-level brake on top of the durable per-account otp throttle and the
      // per-IP route limiter — three independent layers.
      rateLimit: { window: 60, max: 3 },
      async sendVerificationOTP({ email, otp, type }) {
        // Silent skip when throttled (still reported as success → anti-enumeration)
        // and a no-op when Resend is unconfigured (sendEmail logs in dev).
        if (!(await checkEmailThrottle(email, "otp"))) return;
        const { subject, html } = otpEmail(otp, type);
        await sendEmail(email, subject, html);
      },
    }),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
