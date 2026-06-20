"use client";

import { BarChart3, Landmark } from "lucide-react";
import { ReportView, TaxReportView } from "@/features/reports";
import { PageHeader } from "@/components/shared/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function ReportsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports"
        description="Periodic reviews and an Indian tax & charges pack — export as CSV/Excel or PDF."
        className="print:hidden"
      />
      <Tabs defaultValue="reviews">
        <TabsList variant="underline" className="print:hidden">
          <TabsTrigger value="reviews">
            <BarChart3 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Periodic reviews
          </TabsTrigger>
          <TabsTrigger value="tax">
            <Landmark className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Tax &amp; charges
          </TabsTrigger>
        </TabsList>
        <TabsContent value="reviews">
          <ReportView />
        </TabsContent>
        <TabsContent value="tax">
          <TaxReportView />
        </TabsContent>
      </Tabs>
    </div>
  );
}
