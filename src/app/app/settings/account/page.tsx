"use client";

import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";
import { useDbSession } from "@/providers/db-session-provider";
import { useSession } from "@/lib/auth-client";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ChangePasswordSection,
  ChangeEmailSection,
  SessionsSection,
  TwoFactorSection,
  DeleteAccountSection,
} from "@/features/account";

/**
 * Account & security — the logged-in self-service surface for the hosted
 * platform account: password, email, sessions, two-factor and account deletion.
 * These need a platform session, so they only render in hosted mode; BYOD /
 * local journals have no central account, so we show a clear explanation there.
 */
export default function AccountSecurityPage() {
  const { state } = useDbSession();
  const { data: session } = useSession();
  const mode = state.status === "ready" ? state.mode : null;
  const isHosted = mode === "hosted" && Boolean(session);

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="Account & security"
        description="Manage how you sign in and protect your account."
      />
      <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit">
        <Link href="/app/settings">
          <ArrowLeft className="h-4 w-4" /> All settings
        </Link>
      </Button>

      {isHosted ? (
        <div className="space-y-4">
          <ChangePasswordSection />
          <ChangeEmailSection />
          <TwoFactorSection />
          <SessionsSection />
          <DeleteAccountSection />
        </div>
      ) : (
        <Card>
          <CardContent className="flex items-start gap-3 py-4 text-sm">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium">No platform account on this device.</p>
              <p className="text-muted">
                Password, email, sessions and two-factor settings apply to a hosted TradeMarkk
                account. You&apos;re currently in{" "}
                <span className="font-medium text-foreground">
                  {mode === "byod"
                    ? "bring-your-own-database"
                    : mode === "local"
                      ? "local demo"
                      : "no"}
                </span>{" "}
                mode — your data lives in your own database/browser, so there&apos;s nothing to
                manage here. Storage options live under{" "}
                <Link href="/app/settings#storage" className="text-accent hover:underline">
                  Settings
                </Link>
                .
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
