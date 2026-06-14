"use client";

import * as React from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Loader2, LogOut, Monitor, ShieldCheck } from "lucide-react";
import { authClient, useSession, signOut } from "@/lib/auth-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { describeUserAgent } from "../account";

type SessionRow = {
  token: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  userAgent?: string | null;
  ipAddress?: string | null;
};

function timeAgo(d: string | Date): string {
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * Lists the account's active sessions (device, last seen, current marked) and
 * lets the user revoke any single one or sign out everywhere else. Revoking the
 * CURRENT session signs the user out entirely (with a clear confirm so they know
 * it'll log them out here too).
 */
export function SessionsSection() {
  const { data: session } = useSession();
  const currentToken = session?.session.token;
  const qc = useQueryClient();
  const confirmDialog = useConfirm();

  const { data, isLoading, error } = useQuery({
    queryKey: ["account-sessions"],
    queryFn: async () => {
      const res = await authClient.listSessions();
      if (res.error) throw new Error(res.error.message ?? "Couldn't load sessions");
      return (res.data ?? []) as SessionRow[];
    },
    staleTime: 30_000,
  });

  const revokeOne = useMutation({
    mutationFn: async (token: string) => {
      const res = await authClient.revokeSession({ token });
      if (res.error) throw new Error(res.error.message ?? "Couldn't revoke that session");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["account-sessions"] });
      toast.success("Session signed out.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't revoke that session"),
  });

  const signOutEverywhereElse = async () => {
    const ok = await confirmDialog({
      title: "Sign out of all other devices?",
      description: "Every session except this one will be signed out.",
      confirmLabel: "Sign out others",
    });
    if (!ok) return;
    const res = await authClient.revokeOtherSessions();
    if (res.error) {
      toast.error(res.error.message ?? "Couldn't sign out other devices");
      return;
    }
    void qc.invalidateQueries({ queryKey: ["account-sessions"] });
    toast.success("Other devices signed out.");
  };

  const revokeCurrent = async () => {
    const ok = await confirmDialog({
      title: "Sign out of this device?",
      description: "This is the device you're using now — you'll be signed out and sent home.",
      confirmLabel: "Sign out",
      destructive: true,
    });
    if (!ok) return;
    await signOut();
    location.assign("/");
  };

  const sessions = (data ?? []).slice().sort((a, b) => {
    if (a.token === currentToken) return -1;
    if (b.token === currentToken) return 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Monitor className="h-4 w-4 text-muted" aria-hidden />
          Active sessions
        </CardTitle>
        <CardDescription>
          Where you&apos;re signed in. Revoke any you don&apos;t recognize.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading sessions…
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-loss">
            Couldn&apos;t load your sessions. Try again.
          </p>
        )}
        {!isLoading && !error && (
          <ul className="divide-y rounded-lg border">
            {sessions.map((s) => {
              const isCurrent = s.token === currentToken;
              return (
                <li
                  key={s.token}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {describeUserAgent(s.userAgent)}
                      {isCurrent && (
                        <Badge variant="secondary" className="gap-1">
                          <ShieldCheck className="h-3 w-3" /> This device
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted">
                      Last active {timeAgo(s.updatedAt)}
                      {s.ipAddress ? ` · ${s.ipAddress}` : ""}
                    </p>
                  </div>
                  {isCurrent ? (
                    <Button variant="ghost" size="sm" onClick={revokeCurrent}>
                      <LogOut className="h-3.5 w-3.5" /> Sign out
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revokeOne.mutate(s.token)}
                      disabled={revokeOne.isPending}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {!isLoading && !error && sessions.length > 1 && (
          <Button variant="outline" size="sm" onClick={signOutEverywhereElse}>
            <LogOut className="h-3.5 w-3.5" /> Sign out everywhere else
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
