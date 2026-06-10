"use client";

import {
  AccountSection,
  AppearanceSection,
  DangerSection,
  StorageSection,
  TagsSection,
} from "@/features/settings";
import { PageHeader } from "@/components/shared/page-header";

export default function SettingsPage() {
  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader title="Settings" />
      <StorageSection />
      <AccountSection />
      <TagsSection />
      <AppearanceSection />
      <DangerSection />
    </div>
  );
}
