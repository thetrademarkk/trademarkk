import type { Metadata } from "next";
import { ResetPasswordView } from "./reset-password-view";

// A token-gated transactional page — never index it. The client form below
// renders unchanged.
export const metadata: Metadata = {
  title: "Reset password",
  robots: { index: false },
};

export default function ResetPasswordPage() {
  return <ResetPasswordView />;
}
