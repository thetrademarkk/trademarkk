"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import { useDbSession } from "@/providers/db-session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

/** Shown when BYOD credentials are passphrase-encrypted at rest. */
export function UnlockScreen() {
  const { unlockByod, disconnect } = useDbSession();
  const [passphrase, setPassphrase] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await unlockByod(passphrase);
    } catch {
      setError("Wrong passphrase. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="flex items-center gap-2 font-semibold">
          <Lock className="h-4 w-4 text-accent" /> Unlock your journal
        </div>
        <p className="mt-1 text-sm text-muted">
          Your database connection is encrypted with a passphrase.
        </p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <Input
            type="password"
            autoFocus
            placeholder="Passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
          {error ? <p className="text-xs text-loss">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={busy || !passphrase}>
            {busy ? "Unlocking…" : "Unlock"}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={disconnect}>
            Use a different connection
          </Button>
        </form>
      </Card>
    </div>
  );
}
