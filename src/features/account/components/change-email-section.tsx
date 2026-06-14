"use client";

import * as React from "react";
import { toast } from "sonner";
import { AtSign, Loader2, MailCheck } from "lucide-react";
import { authClient, useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  validateNewEmail,
  nextEmailChangeState,
  EMAIL_CHANGE_NOTICE,
  type EmailChangeState,
} from "../account";

/**
 * Change the account email (logged-in). Better Auth sends a verification link
 * (to the current inbox first when verified — anti-hijack) and the address only
 * flips once it's followed; until then the old email stays active. The response
 * is identical whether or not the new email already exists (no enumeration), so
 * the UI always shows the same neutral "check your inbox" pending state.
 */
export function ChangeEmailSection() {
  const { data: session } = useSession();
  const currentEmail = session?.user.email ?? "";
  const [state, setState] = React.useState<EmailChangeState>({ status: "idle" });
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const newEmail = String(new FormData(e.currentTarget).get("email") ?? "");
    const check = validateNewEmail(currentEmail, newEmail);
    if (!check.ok) {
      setState({ status: "error", reason: check.reason });
      return;
    }
    setBusy(true);
    try {
      const res = await authClient.changeEmail({
        newEmail: newEmail.trim().toLowerCase(),
        callbackURL: "/app/settings/account",
      });
      if (res.error) throw new Error(res.error.message ?? "Couldn't start the email change.");
      // Always neutral + pending, regardless of whether the address was taken.
      setState(nextEmailChangeState(check, newEmail));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start the email change.");
      setState({ status: "error", reason: "Something went wrong — try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AtSign className="h-4 w-4 text-muted" aria-hidden />
          Email address
        </CardTitle>
        <CardDescription>
          Current email: <span className="font-medium text-foreground">{currentEmail || "—"}</span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state.status === "pending" ? (
          <div className="flex items-start gap-3 rounded-lg border bg-surface-2/50 p-3">
            <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-profit" aria-hidden />
            <div className="space-y-2 text-sm">
              <p>{EMAIL_CHANGE_NOTICE}</p>
              <button
                type="button"
                className="text-xs text-accent hover:underline"
                onClick={() => setState({ status: "idle" })}
              >
                Change a different email
              </button>
            </div>
          </div>
        ) : (
          <form className="grid max-w-sm gap-3" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="ce-email">New email</Label>
              <Input
                id="ce-email"
                name="email"
                type="email"
                required
                placeholder="you@example.com"
                autoComplete="email"
                onChange={() => state.status === "error" && setState({ status: "idle" })}
              />
            </div>
            {state.status === "error" && (
              <p
                role="alert"
                className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-xs text-loss"
              >
                {state.reason}
              </p>
            )}
            <Button type="submit" className="w-fit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Send verification
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
