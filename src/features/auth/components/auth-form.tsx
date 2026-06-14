"use client";

import * as React from "react";
import { Eye, EyeOff, Loader2, MailCheck } from "lucide-react";
import { authClient, signIn, signUp } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OtpInput } from "./otp-input";
import { useGoogleEnabled } from "../hooks/use-google-enabled";
import { checkPassword, NEUTRAL_RESET_NOTICE } from "../password";

type Mode = "signup" | "signin" | "forgot" | "otp";

/** Email/password + email-OTP verify + optional Google sign-in. On success, the caller connects hosted storage. */
export function AuthForm({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = React.useState<Mode>("signup");
  const [busy, setBusy] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [pwError, setPwError] = React.useState<string | null>(null);
  // Carried into the OTP step so verify + resend know which account they're for.
  const [pending, setPending] = React.useState<{ email: string } | null>(null);
  const [otp, setOtp] = React.useState("");
  const googleEnabled = useGoogleEnabled();

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setNotice(null);
    setPwError(null);
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    setBusy(true);
    setError(null);
    try {
      if (mode === "forgot") {
        await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
        // Always neutral — never reveals whether the email is registered.
        setNotice(NEUTRAL_RESET_NOTICE);
        return;
      }
      const password = String(form.get("password") ?? "");
      if (mode === "signup") {
        const pw = checkPassword(password);
        if (!pw.valid) {
          setPwError(pw.reason);
          return;
        }
        const res = await signUp.email({ email, password, name: String(form.get("name") ?? "") });
        if (res.error) throw new Error(res.error.message);
        if (!res.data?.token) {
          // Email verification is enforced (Resend configured) — no session yet.
          // The server has emailed a 6-digit code; collect it inline.
          setPending({ email });
          setOtp("");
          switchMode("otp");
          return;
        }
      } else {
        const res = await signIn.email({ email, password });
        if (res.error) throw new Error(res.error.message);
      }
      onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async (code: string) => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.emailOtp.verifyEmail({ email: pending.email, otp: code });
      if (res.error) throw new Error(res.error.message);
      onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't work — try again.");
      setOtp("");
    } finally {
      setBusy(false);
    }
  };

  const resendOtp = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await authClient.emailOtp.sendVerificationOtp({
        email: pending.email,
        type: "email-verification",
      });
      setNotice("If your code expired, a fresh one is on its way.");
    } catch {
      setError("Couldn't resend just yet — wait a moment and try again.");
    } finally {
      setBusy(false);
    }
  };

  // ── OTP entry step (post-signup email verification by code) ──
  if (mode === "otp" && pending) {
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Enter your verification code</h2>
          <p className="text-sm text-muted">
            We sent a 6-digit code to <span className="font-medium">{pending.email}</span>.
          </p>
        </div>
        <OtpInput value={otp} onChange={setOtp} onComplete={verifyOtp} disabled={busy} autoFocus />
        {error && (
          <p className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-xs text-loss">
            {error}
          </p>
        )}
        {notice && <p className="text-xs text-muted">{notice}</p>}
        <Button
          type="button"
          className="w-full"
          disabled={busy || otp.length < 6}
          onClick={() => verifyOtp(otp)}
        >
          {busy && <Loader2 className="animate-spin" />}
          Verify and continue
        </Button>
        <div className="flex items-center justify-between text-xs">
          <button
            type="button"
            className="text-muted hover:text-accent"
            onClick={() => switchMode("signin")}
          >
            Back to sign in
          </button>
          <button
            type="button"
            className="text-accent hover:underline disabled:opacity-50"
            onClick={resendOtp}
            disabled={busy}
          >
            Resend code
          </button>
        </div>
      </div>
    );
  }

  if (notice) {
    return (
      <div className="flex items-start gap-3 rounded-xl border bg-surface-2/50 p-4">
        <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-profit" />
        <div className="space-y-2">
          <p className="text-sm">{notice}</p>
          <button
            type="button"
            className="text-xs text-accent hover:underline"
            onClick={() => switchMode("signin")}
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form className="space-y-3" onSubmit={submit}>
        {mode === "signup" && (
          <div className="space-y-1.5">
            <Label htmlFor="auth-name">Name</Label>
            <Input
              id="auth-name"
              name="name"
              required
              placeholder="Your name"
              autoComplete="name"
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="auth-email">Email</Label>
          <Input
            id="auth-email"
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>
        {mode !== "forgot" && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="auth-password">Password</Label>
              {mode === "signin" && (
                <button
                  type="button"
                  className="text-xs text-muted hover:text-accent"
                  onClick={() => switchMode("forgot")}
                >
                  Forgot password?
                </button>
              )}
            </div>
            <div className="relative">
              <Input
                id="auth-password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                placeholder="8+ characters"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                className="pr-10"
                onChange={() => pwError && setPwError(null)}
              />
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                onClick={() => setShowPassword((s) => !s)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {pwError && <p className="text-xs text-loss">{pwError}</p>}
          </div>
        )}

        {error && (
          <p className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-xs text-loss">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          {mode === "signup"
            ? "Create free account"
            : mode === "signin"
              ? "Sign in"
              : "Send reset link"}
        </Button>
      </form>

      {googleEnabled && mode !== "forgot" && (
        <>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] uppercase tracking-wider text-muted">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() => signIn.social({ provider: "google", callbackURL: "/app/onboarding" })}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.1A6.6 6.6 0 0 1 5.49 12c0-.73.13-1.43.35-2.1V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.61 0 3.06.55 4.21 1.64l3.16-3.16A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
              />
            </svg>
            Continue with Google
          </Button>
        </>
      )}

      <p className="text-center text-xs text-muted">
        {mode === "signup" ? (
          <button type="button" className="hover:text-accent" onClick={() => switchMode("signin")}>
            Already have an account? <span className="font-medium text-accent">Sign in</span>
          </button>
        ) : (
          <button type="button" className="hover:text-accent" onClick={() => switchMode("signup")}>
            New to TradeMarkk?{" "}
            <span className="font-medium text-accent">Create a free account</span>
          </button>
        )}
      </p>
    </div>
  );
}
