"use client";

import Link from "next/link";
import { BookOpenText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { PnlText } from "@/components/shared/pnl-text";
import { Button } from "@/components/ui/button";
import { describeInstrument, type TradeWithMeta } from "@/features/trades";

export function RecentTrades({ trades }: { trades: TradeWithMeta[] }) {
  const recent = trades.slice(0, 6);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Recent trades</CardTitle>
        <Button variant="link" size="sm" asChild className="h-auto p-0">
          <Link href="/app/trades">View all →</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {recent.length === 0 ? (
          <EmptyState
            icon={BookOpenText}
            title="No trades yet"
            description="Press T or tap + to log your first trade in 15 seconds."
            className="border-0 py-8"
          />
        ) : (
          <div className="divide-y">
            {recent.map((t) => (
              <Link key={t.id} href={`/app/trades/${t.id}`} className="flex items-center justify-between py-2 text-sm hover:bg-surface-2 -mx-2 px-2 rounded">
                <div className="min-w-0">
                  <span className="font-medium">{describeInstrument(t)}</span>
                  <span className="ml-2 text-xs text-muted">
                    {new Date(t.opened_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                  </span>
                </div>
                {t.status === "closed" ? <PnlText value={t.net_pnl} /> : <Badge variant="warning">open</Badge>}
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
