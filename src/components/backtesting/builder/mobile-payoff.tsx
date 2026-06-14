"use client";

import * as React from "react";
import { ChevronUp } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn, formatINR } from "@/lib/utils";
import type { PayoffSummary } from "@/features/backtest/builder/payoff-rail";
import { LivePayoffRail } from "./live-payoff-rail";
import { PayoffChart } from "./payoff-chart";

/**
 * Mobile live mini-payoff (≤ lg). A sticky bottom bar that is a PEER element —
 * the payoff sparkline + max P/L + strategy name are always visible, NOT hidden
 * behind a tap. Tapping "Preview" opens a vaul bottom-sheet with the full
 * diagram + summary stats. Reuses the same LivePayoffRail inside the sheet so
 * desktop and mobile render identical math.
 */
export function MobilePayoff({
  summary,
  guides,
}: {
  summary: PayoffSummary;
  guides?: { target?: number; stopLoss?: number };
}) {
  const { curve, label } = summary;
  const maxP = curve.profitUnbounded ? "∞" : formatINR(curve.maxProfit, { signed: true });
  const maxL = curve.lossUnbounded ? "∞" : formatINR(curve.maxLoss, { signed: true });

  return (
    <div
      className="sticky bottom-0 z-30 border-t bg-bg/95 px-3 py-2 backdrop-blur lg:hidden"
      data-testid="bt-mobile-payoff"
    >
      <div className="flex items-center gap-3">
        {/* Always-visible mini sparkline (peer, not behind a tap). */}
        <div className="h-10 w-24 shrink-0" data-testid="bt-mini-sparkline">
          <PayoffChart summary={summary} guides={guides} height={40} className="h-10 w-full" />
        </div>
        <div className="min-w-0 flex-1 text-xs">
          <div className="truncate font-medium">{label}</div>
          <div className="flex gap-2 text-[11px]">
            <span className="text-profit">{maxP}</span>
            <span className="text-loss">{maxL}</span>
          </div>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-lg border bg-surface px-3 py-1.5 text-xs font-medium"
              )}
              data-testid="bt-mobile-preview-open"
            >
              Preview <ChevronUp className="h-3.5 w-3.5" aria-hidden />
            </button>
          </SheetTrigger>
          <SheetContent title="Live payoff">
            <LivePayoffRail
              summary={summary}
              guides={guides}
              className="border-0 bg-transparent p-0"
            />
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
