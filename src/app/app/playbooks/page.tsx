"use client";

import { PlaybooksPanel } from "@/features/playbooks";
import { PageHeader } from "@/components/shared/page-header";

export default function PlaybooksPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Playbooks" description="Your setups, with proof of which ones pay." />
      <PlaybooksPanel />
    </div>
  );
}
