"use client";

import Link from "next/link";
import { ChevronRight, ShieldCheck } from "lucide-react";
import {
  AccountSection,
  AppearanceSection,
  DangerSection,
  RecomputeChargesSection,
  StorageSection,
  TagsSection,
} from "@/features/settings";
import { GoalsSection } from "@/features/goals";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { useDbSession } from "@/providers/db-session-provider";

export default function SettingsPage() {
  const { state } = useDbSession();
  const isHosted = state.status === "ready" && state.mode === "hosted";

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader title="Settings" />
      {/* Account & security entry — the self-service auth surface (hosted only). */}
      {isHosted && (
        <Link href="/app/settings/account" className="block">
          <Card className="transition-colors hover:border-accent/60">
            <CardContent className="flex items-center gap-3 py-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Account &amp; security</p>
                <p className="text-xs text-muted">
                  Password, email, two-factor, active sessions and account deletion.
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
            </CardContent>
          </Card>
        </Link>
      )}
      {/* Anchored sections — links like /app/settings#goals scroll here.
          scroll-mt-20 offsets the sticky topbar so the heading isn't hidden. */}
      <section id="storage" className="scroll-mt-20">
        <StorageSection />
      </section>
      <section id="account" className="scroll-mt-20">
        <AccountSection />
      </section>
      <section id="recompute-charges" className="scroll-mt-20">
        <RecomputeChargesSection />
      </section>
      <section id="goals" className="scroll-mt-20">
        <GoalsSection />
      </section>
      <section id="tags" className="scroll-mt-20">
        <TagsSection />
      </section>
      <section id="appearance" className="scroll-mt-20">
        <AppearanceSection />
      </section>
      <section id="danger" className="scroll-mt-20">
        <DangerSection />
      </section>
    </div>
  );
}
