import { createAuthClient } from "better-auth/react";
import { emailOTPClient, twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  plugins: [
    // Mirrors the server emailOTP plugin — adds emailOtp.* (sendVerificationOtp,
    // verifyEmail, checkVerificationOtp) and signIn.emailOtp on the client.
    emailOTPClient(),
    // Mirrors the server twoFactor plugin — adds twoFactor.* (enable, disable,
    // verifyTotp, generateBackupCodes, verifyBackupCode, getTotpUri) on the
    // client. When a sign-in needs a second factor, Better Auth returns
    // `{ twoFactorRedirect: true }` which the sign-in form handles inline.
    twoFactorClient(),
  ],
});

export const { useSession, signIn, signUp, signOut } = authClient;
