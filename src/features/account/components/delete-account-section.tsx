"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, Trash2, TriangleAlert } from "lucide-react";
import { useDbSession } from "@/providers/db-session-provider";
import { signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isDeleteConfirmed, DELETE_CONFIRM_PHRASE } from "../account";

/**
 * Permanently delete the account (hosted mode). Type-to-confirm dialog spelling
 * out exactly what's removed; clarifies that BYOD / local-demo journals live in
 * the user's OWN database and are NOT on our servers. Revokes sessions + tears
 * down the hosted DB server-side; the route refuses for protected accounts.
 */
export function DeleteAccountSection() {
  const { disconnect } = useDbSession();
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const confirmed = isDeleteConfirmed(typed);

  const doDelete = async () => {
    if (!confirmed) return;
    setBusy(true);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Deletion failed.");
      }
      await signOut();
      disconnect();
      location.assign("/");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Deletion failed.");
      setBusy(false);
    }
  };

  return (
    <Card className="border-loss/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-loss">
          <TriangleAlert className="h-4 w-4" aria-hidden />
          Delete account
        </CardTitle>
        <CardDescription>
          Permanently removes your account, profile, posts, comments, messages and your hosted
          journal database. This can&apos;t be undone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
          <Trash2 className="h-3.5 w-3.5" /> Delete my account
        </Button>

        <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>This is permanent and immediate.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <ul className="list-disc space-y-1 pl-5 text-muted">
                <li>Your account, profile and community content are deleted.</li>
                <li>Your hosted journal database is destroyed.</li>
                <li>All your active sessions are signed out.</li>
                <li>
                  If you use <strong>Bring-your-own-database</strong> or the local demo, that data
                  lives in <em>your own</em> database/browser — it isn&apos;t on our servers and
                  isn&apos;t touched here.
                </li>
              </ul>
              <div className="space-y-1.5">
                <Label htmlFor="del-confirm">
                  Type <span className="font-mono font-semibold">{DELETE_CONFIRM_PHRASE}</span> to
                  confirm
                </Label>
                <Input
                  id="del-confirm"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  placeholder={DELETE_CONFIRM_PHRASE}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={doDelete} disabled={!confirmed || busy}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Permanently delete
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
