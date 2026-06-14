"use client";

import * as React from "react";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validateChangePassword } from "../account";

/**
 * Change the account password (logged-in). Requires the current password (the
 * server re-verifies it via Better Auth's changePassword), enforces the shared
 * strength rules on the new one, and offers "sign out of other devices" so a
 * compromised session elsewhere is killed. On success the local session stays.
 */
export function ChangePasswordSection() {
  const [show, setShow] = React.useState(false);
  const [revokeOthers, setRevokeOthers] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const input = {
      currentPassword: String(f.get("current") ?? ""),
      newPassword: String(f.get("new") ?? ""),
      confirmPassword: String(f.get("confirm") ?? ""),
    };
    const check = validateChangePassword(input);
    if (!check.ok) {
      setError(check.reason);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.changePassword({
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        revokeOtherSessions: revokeOthers,
      });
      if (res.error) throw new Error(res.error.message ?? "Couldn't update your password.");
      toast.success(
        revokeOthers ? "Password updated — other devices signed out." : "Password updated."
      );
      formRef.current?.reset();
    } catch (err) {
      // Better Auth returns a generic invalid-password error for a wrong current
      // password — surface a clear, non-leaky message.
      const msg = err instanceof Error ? err.message : "Couldn't update your password.";
      setError(
        /invalid|incorrect|password/i.test(msg) ? "Your current password is incorrect." : msg
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-muted" aria-hidden />
          Change password
        </CardTitle>
        <CardDescription>
          Use a strong password you don&apos;t reuse elsewhere — at least 8 characters.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} className="grid max-w-sm gap-3" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="cp-current">Current password</Label>
            <Input
              id="cp-current"
              name="current"
              type={show ? "text" : "password"}
              required
              autoComplete="current-password"
              onChange={() => error && setError(null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-new">New password</Label>
            <div className="relative">
              <Input
                id="cp-new"
                name="new"
                type={show ? "text" : "password"}
                required
                minLength={8}
                placeholder="8+ characters"
                autoComplete="new-password"
                className="pr-10"
                onChange={() => error && setError(null)}
              />
              <button
                type="button"
                aria-label={show ? "Hide passwords" : "Show passwords"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                onClick={() => setShow((s) => !s)}
                tabIndex={-1}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-confirm">Confirm new password</Label>
            <Input
              id="cp-confirm"
              name="confirm"
              type={show ? "text" : "password"}
              required
              minLength={8}
              placeholder="Same password again"
              autoComplete="new-password"
              onChange={() => error && setError(null)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={revokeOthers}
              onChange={(e) => setRevokeOthers(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-accent"
            />
            Sign out of all other devices
          </label>
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-xs text-loss"
            >
              {error}
            </p>
          )}
          <Button type="submit" className="w-fit" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Update password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
