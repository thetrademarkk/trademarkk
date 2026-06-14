"use client";

import * as React from "react";
import { toast } from "sonner";
import { Copy, Download, Loader2, ShieldCheck, ShieldAlert } from "lucide-react";
import { authClient, useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OtpInput } from "@/features/auth";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { QrCode } from "./qr-code";
import { formatBackupCodes, backupCodesFilename } from "../account";

type Enroll = { totpURI: string; secret: string; backupCodes: string[] };

/** Pull the base32 secret out of an otpauth:// URI for manual entry. */
function secretFromUri(uri: string): string {
  try {
    return new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

/**
 * Opt-in TOTP two-factor. Disabled → enroll (password → QR + secret + backup
 * codes → confirm a 6-digit code to activate) → enabled (disable, or regenerate
 * backup codes). All actions require the account password (Better Auth's 2FA
 * plugin). Backup codes are shown once and are downloadable/copyable.
 */
export function TwoFactorSection() {
  const { data: session } = useSession();
  const enabled = Boolean((session?.user as { twoFactorEnabled?: boolean })?.twoFactorEnabled);
  const confirmDialog = useConfirm();

  const [busy, setBusy] = React.useState(false);
  const [enroll, setEnroll] = React.useState<Enroll | null>(null);
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [freshBackupCodes, setFreshBackupCodes] = React.useState<string[] | null>(null);

  const begin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.twoFactor.enable({ password });
      if (res.error) throw new Error(res.error.message ?? "Couldn't start 2FA setup.");
      const data = res.data as { totpURI: string; backupCodes: string[] };
      setEnroll({
        totpURI: data.totpURI,
        secret: secretFromUri(data.totpURI),
        backupCodes: data.backupCodes ?? [],
      });
      setCode("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't start 2FA setup.";
      setError(/password/i.test(msg) ? "That password is incorrect." : msg);
    } finally {
      setBusy(false);
    }
  };

  const activate = async (entered: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.twoFactor.verifyTotp({ code: entered });
      if (res.error) throw new Error(res.error.message ?? "That code didn't work.");
      toast.success("Two-factor authentication is on.");
      setEnroll(null);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't work — try again.");
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    const ok = await confirmDialog({
      title: "Turn off two-factor?",
      description:
        "Your account will be less protected. You'll only need your password to sign in.",
      confirmLabel: "Turn off 2FA",
      destructive: true,
    });
    if (!ok) return;
    const password = window.prompt("Enter your password to turn off two-factor:");
    if (!password) return;
    setBusy(true);
    try {
      const res = await authClient.twoFactor.disable({ password });
      if (res.error) throw new Error(res.error.message ?? "Couldn't turn off 2FA.");
      toast.success("Two-factor authentication is off.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't turn off 2FA.");
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    const password = window.prompt("Enter your password to generate new backup codes:");
    if (!password) return;
    setBusy(true);
    try {
      const res = await authClient.twoFactor.generateBackupCodes({ password });
      if (res.error) throw new Error(res.error.message ?? "Couldn't generate new codes.");
      const data = res.data as { backupCodes: string[] };
      setFreshBackupCodes(data.backupCodes ?? []);
      toast.success("New backup codes generated — old ones no longer work.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't generate new codes.");
    } finally {
      setBusy(false);
    }
  };

  const copyCodes = (codes: string[]) => {
    void navigator.clipboard?.writeText(formatBackupCodes(codes));
    toast.success("Backup codes copied.");
  };

  const downloadCodes = (codes: string[]) => {
    const blob = new Blob([formatBackupCodes(codes)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = backupCodesFilename();
    a.click();
    URL.revokeObjectURL(url);
  };

  const BackupCodeList = ({ codes }: { codes: string[] }) => (
    <div className="space-y-2 rounded-lg border bg-surface-2/40 p-3">
      <p className="text-xs font-medium">
        Save these one-time backup codes — each works once if you lose your authenticator.
      </p>
      <div className="grid grid-cols-2 gap-1.5 font-mono text-sm tabular-nums">
        {codes.map((c) => (
          <span key={c} className="rounded bg-surface px-2 py-1">
            {c}
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => copyCodes(codes)}>
          <Copy className="h-3.5 w-3.5" /> Copy
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => downloadCodes(codes)}>
          <Download className="h-3.5 w-3.5" /> Download
        </Button>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {enabled ? (
            <ShieldCheck className="h-4 w-4 text-profit" aria-hidden />
          ) : (
            <ShieldAlert className="h-4 w-4 text-muted" aria-hidden />
          )}
          Two-factor authentication
        </CardTitle>
        <CardDescription>
          {enabled
            ? "On — sign-ins need a code from your authenticator app."
            : "Add a second step at sign-in with an authenticator app (TOTP). Optional but recommended."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ── Enrollment flow ── */}
        {!enabled && !enroll && (
          <form className="grid max-w-sm gap-3" onSubmit={begin}>
            <div className="space-y-1.5">
              <Label htmlFor="tf-password">Confirm your password to begin</Label>
              <Input
                id="tf-password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                onChange={() => error && setError(null)}
              />
            </div>
            {error && (
              <p role="alert" className="text-xs text-loss">
                {error}
              </p>
            )}
            <Button type="submit" className="w-fit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Set up 2FA
            </Button>
          </form>
        )}

        {!enabled && enroll && (
          <div className="space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <QrCode value={enroll.totpURI} size={180} />
              <div className="space-y-2 text-sm">
                <p>Scan this with your authenticator app, or enter the key manually:</p>
                <code className="block break-all rounded bg-surface-2 px-2 py-1 font-mono text-xs">
                  {enroll.secret}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(enroll.secret);
                    toast.success("Key copied.");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" /> Copy key
                </Button>
              </div>
            </div>

            <BackupCodeList codes={enroll.backupCodes} />

            <div className="max-w-xs space-y-2">
              <Label>Enter the 6-digit code from your app to finish</Label>
              <OtpInput value={code} onChange={setCode} onComplete={activate} disabled={busy} />
              {error && (
                <p role="alert" className="text-xs text-loss">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  disabled={busy || code.length < 6}
                  onClick={() => activate(code)}
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Verify & turn on
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEnroll(null);
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Enabled state ── */}
        {enabled && (
          <div className="space-y-3">
            {freshBackupCodes && <BackupCodeList codes={freshBackupCodes} />}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={regenerate} disabled={busy}>
                Regenerate backup codes
              </Button>
              <Button variant="destructive" size="sm" onClick={disable} disabled={busy}>
                Turn off 2FA
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
