"use client";

import {
  AccountSection,
  AppearanceSection,
  DangerSection,
  StorageSection,
  TagsSection,
} from "@/features/settings";
import { GoalsSection } from "@/features/goals";
import { PageHeader } from "@/components/shared/page-header";

export default function SettingsPage() {
  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader title="Settings" />
      {/* Anchored sections — links like /app/settings#goals scroll here.
          scroll-mt-20 offsets the sticky topbar so the heading isn't hidden. */}
      <section id="storage" className="scroll-mt-20">
        <StorageSection />
      </section>
      <section id="account" className="scroll-mt-20">
        <AccountSection />
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
