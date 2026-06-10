"use client";

import { ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { PnlText } from "@/components/shared/pnl-text";
import { TagChip } from "@/components/shared/tag-chip";
import { useMistakeStats } from "../queries";

/** Mistake taxonomy: frequency + ₹ cost per mistake tag. */
export function MistakesPanel({ from, to }: { from: string | null; to: string | null }) {
  const { data: stats = [] } = useMistakeStats(from, to);

  return (
    <Card>
      <CardHeader><CardTitle>Cost of mistakes</CardTitle></CardHeader>
      <CardContent>
        {stats.length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title="No mistakes tagged yet"
            description="Tag trades with mistakes (revenge trade, oversized…) to see what they cost you."
            className="border-0 py-8"
          />
        ) : (
          <div className="space-y-2">
            {stats.map((m) => (
              <div key={m.tagId} className="flex items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <TagChip name={m.name} color={m.color} />
                  <span className="text-xs text-muted">×{m.count}</span>
                </div>
                <PnlText value={m.cost} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
