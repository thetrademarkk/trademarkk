import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  // Mirrors the server emailOTP plugin — adds emailOtp.* (sendVerificationOtp,
  // verifyEmail, checkVerificationOtp) and signIn.emailOtp on the client.
  plugins: [emailOTPClient()],
});

export const { useSession, signIn, signUp, signOut } = authClient;
