"use client";

import { ReportView } from "@/features/reports";
import { PageHeader } from "@/components/shared/page-header";

export default function ReportsPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Reports" description="Weekly & monthly reviews — export as CSV or PDF." className="print:hidden" />
      <ReportView />
    </div>
  );
}
