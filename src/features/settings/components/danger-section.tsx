"use client";

import * as React from "react";
import { toast } from "sonner";
import { useDbSession, useDb } from "@/providers/db-session-provider";
import { signOut, useSession } from "@/lib/auth-client";
import { deleteLocalDb } from "@/lib/db/adapters/local";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function DangerSection() {
  const { mode } = useDb();
  const { disconnect } = useDbSession();
  const { data: session } = useSession();
  const [busy, setBusy] = React.useState(false);

  const deleteAccount = async () => {
    if (!confirm("Delete your account AND your hosted journal database? This cannot be undone.")) return;
    if (!confirm("Last chance — everything will be permanently deleted. Continue?")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      if (!res.ok) throw new Error("Deletion failed");
      await signOut();
      disconnect();
      location.assign("/");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Deletion failed");
      setBusy(false);
    }
  };

  const wipeLocal = async () => {
    if (!confirm("Wipe all local journal data from this browser?")) return;
    await deleteLocalDb();
    disconnect();
    location.assign("/");
  };

  return (
    <Card className="border-loss/40">
      <CardHeader><CardTitle className="text-loss">Danger zone</CardTitle></CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {mode === "hosted" && session && (
          <Button variant="destructive" size="sm" onClick={deleteAccount} disabled={busy}>
            Delete account & hosted database
          </Button>
        )}
        {mode === "local" && (
          <Button variant="destructive" size="sm" onClick={wipeLocal}>
            Wipe local data
          </Button>
        )}
        {mode === "byod" && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (confirm("Disconnect this database? Your data stays safe in your Turso account.")) {
                disconnect();
                location.assign("/");
              }
            }}
          >
            Disconnect database
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
