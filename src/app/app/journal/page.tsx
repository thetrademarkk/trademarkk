"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { JournalEditor } from "@/features/journal";
import { Skeleton } from "@/components/ui/skeleton";
import { todayKey } from "@/lib/utils";

function JournalContent() {
  const search = useSearchParams();
  const date = search.get("date") ?? todayKey();
  return <JournalEditor date={date} />;
}

export default function JournalPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <JournalContent />
    </Suspense>
  );
}
