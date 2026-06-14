"use client";

import * as React from "react";
import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { checkPassword, passwordsMatch } from "@/features/auth";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function ResetForm() {
  const token = useSearchParams().get("token");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    const pw = checkPassword(password);
    if (!pw.valid) {
      setError(pw.reason);
      return;
    }
    if (!passwordsMatch(password, String(form.get("confirm") ?? ""))) {
      setError("Passwords don't match.");
      return;
    }
    if (!token) {
      setError("Missing reset token — use the link from your email.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await authClient.resetPassword({ newPassword: password, token });
    setBusy(false);
    if (res.error) setError(res.error.message ?? "Reset failed — the link may have expired.");
    else setDone(true);
  };

  return (
    <Card className="w-full max-w-sm p-6">
      <Logo />
      {done ? (
        <div className="mt-4 space-y-3">
          <p className="flex items-center gap-1.5 text-sm">
            <CheckCircle2 className="h-4 w-4 text-profit" aria-hidden />
            Password updated. You can sign in with it now.
          </p>
          <Button asChild className="w-full">
            <Link href="/app/onboarding">Go to sign in</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <h1 className="text-base font-semibold">Set a new password</h1>
          <div className="space-y-1.5">
            <Label htmlFor="rp-password">New password</Label>
            <Input
              id="rp-password"
              name="password"
              type="password"
              required
              minLength={8}
              placeholder="8+ characters"
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rp-confirm">Confirm password</Label>
            <Input
              id="rp-confirm"
              name="confirm"
              type="password"
              required
              minLength={8}
              placeholder="Same password again"
              autoComplete="new-password"
            />
          </div>
          {error && (
            <p className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-xs text-loss">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Update password
          </Button>
        </form>
      )}
    </Card>
  );
}

export function ResetPasswordView() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Suspense fallback={null}>
        <ResetForm />
      </Suspense>
    </div>
  );
}
