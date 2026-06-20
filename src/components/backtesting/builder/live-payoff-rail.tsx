"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatINR, formatNumber } from "@/lib/utils";
import type { PayoffSummary } from "@/features/backtest/builder/payoff-rail";
import { PayoffChart } from "./payoff-chart";

export interface LivePayoffRailProps {
  summary: PayoffSummary;
  /** Optional overall SL/Target rupee guides drawn on the payoff y-axis. */
  guides?: { target?: number; stopLoss?: number };
  className?: string;
}

function MaxValue({
  unbounded,
  value,
  tone,
}: {
  unbounded: boolean;
  value: number;
  tone: "profit" | "loss";
}) {
  if (unbounded) {
    return (
      <span className={cn("font-money", tone === "profit" ? "text-profit" : "text-loss")}>
        Unlimited
      </span>
    );
  }
  return (
    <span className={cn("font-money", tone === "profit" ? "text-profit" : "text-loss")}>
      {formatINR(value, { signed: true })}
    </span>
  );
}

/**
 * The ALWAYS-MOUNTED live payoff rail (desktop sticky right column; reused
 * inside the mobile bottom-sheet). Renders the expiry payoff diagram + the
 * headline structure stats (strategy label, max profit/loss, breakevens, net
 * credit/debit), all derived live from the builder draft via buildPayoffSummary.
 *
 * Premiums are clearly labelled ESTIMATES — the authoritative numbers come from
 * the engine run. No Greeks/delta (D7 deferred — no IV in the dataset).
 */
export function LivePayoffRail({ summary, guides, className }: LivePayoffRailProps) {
  const { curve, label, netCredit, hasLegs } = summary;
  const credit = netCredit >= 0;

  return (
    <div
      className={cn("rounded-lg border bg-surface p-4 shadow-sm", className)}
      data-testid="bt-live-rail"
    >
      <div className="mb-3 flex items-center justify-between gap-2 border-b pb-2">
        <h2 className="micro-label">Live payoff</h2>
        <Badge variant="outline" data-testid="bt-strategy-label" data-strategy={label}>
          {label}
        </Badge>
      </div>

      <div className="mt-1">
        <PayoffChart summary={summary} guides={guides} />
      </div>

      {hasLegs && (
        <div
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border bg-surface px-2 py-1 text-[11px]"
          data-testid="bt-net-credit"
        >
          <span className="text-muted">{credit ? "Net credit" : "Net debit"}</span>
          <span className={cn("font-money", credit ? "text-profit" : "text-loss")}>
            {formatINR(Math.abs(netCredit))}
          </span>
        </div>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-md border px-2 py-1.5">
          <div className="micro-label">Max profit</div>
          <div className="mt-0.5">
            <MaxValue unbounded={curve.profitUnbounded} value={curve.maxProfit} tone="profit" />
          </div>
        </div>
        <div className="rounded-md border px-2 py-1.5">
          <div className="micro-label">Max loss</div>
          <div className="mt-0.5">
            <MaxValue unbounded={curve.lossUnbounded} value={curve.maxLoss} tone="loss" />
          </div>
        </div>
        <div className="rounded-md border px-2 py-1.5">
          <div className="micro-label">Breakeven{curve.breakevens.length === 1 ? "" : "s"}</div>
          <div className="mt-0.5 font-money" data-testid="bt-breakevens">
            {curve.breakevens.length === 0
              ? "—"
              : curve.breakevens.map((b) => formatNumber(b, 0)).join(" · ")}
          </div>
        </div>
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-muted">
        <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        At-expiry intrinsic value from estimated entry premiums — a preview of the structure. Your
        run uses real historical prices and net-of-charges P&amp;L.
      </p>
    </div>
  );
}
