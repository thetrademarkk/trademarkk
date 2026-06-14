"use client";

import * as React from "react";
import { Database, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  bucketForCoverage,
  coverageTooltip,
  type CoverageBucketInfo,
} from "@/lib/backtest/coverage/coverage-buckets";

/**
 * CoverageBadge — the MANDATORY honesty pill (BT-10, item 2). Given a raw data
 * coverage fraction (0..1, precomputed from the committed manifest summary by
 * the coverage resolver) it shows a high/medium/low/unknown pill with an honest
 * tooltip ("SENSEX ~32% covered in this period — results are partial"). It
 * appears on EVERY preset card and on EVERY preset run result.
 *
 * NO hiding low coverage — a low or unknown number is rendered exactly. The pill
 * colour uses the codebase's semantic status tokens (profit/warning/loss/muted)
 * so all themes + colourblind/reduced-motion are inherited. Descriptive only:
 * the badge NEVER implies profitability.
 *
 * Pure renderer — the 170 KB summary never reaches the client; only the small
 * `fraction` does.
 */

const TONE_CLASS: Record<CoverageBucketInfo["tone"], string> = {
  profit: "bg-profit/15 text-profit",
  warning: "bg-warning/15 text-warning",
  loss: "bg-loss/15 text-loss",
  muted: "bg-surface-2 text-muted border",
};

export interface CoverageBadgeProps {
  /** Coverage as a fraction 0..1, or null/undefined for the honest unknown state. */
  fraction: number | null | undefined;
  /** Instrument symbol for the tooltip copy (e.g. "SENSEX"). */
  symbol: string;
  /** Scope phrase for the tooltip ("in this period", "for this expiry"). */
  scope?: string;
  /** Optional "N of M expiries covered" sub-detail appended to the tooltip. */
  detail?: string;
  size?: "sm" | "md";
  className?: string;
}

export function CoverageBadge({
  fraction,
  symbol,
  scope = "in this period",
  detail,
  size = "md",
  className,
}: CoverageBadgeProps) {
  const info = bucketForCoverage(fraction);
  const tip = coverageTooltip(symbol, scope, info) + (detail ? ` ${detail}` : "");
  const pct = info.percent;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-testid="coverage-badge"
            data-coverage-bucket={info.bucket}
            data-coverage-percent={pct ?? ""}
            className={cn(
              "inline-flex cursor-help items-center gap-1 rounded-md font-medium",
              size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
              TONE_CLASS[info.tone],
              className
            )}
            aria-label={`Data coverage ${info.label}${pct != null ? `, about ${pct} percent` : ""}`}
          >
            {info.bucket === "unknown" ? (
              <HelpCircle className="h-3 w-3 shrink-0" aria-hidden />
            ) : (
              <Database className="h-3 w-3 shrink-0" aria-hidden />
            )}
            <span>
              {info.label}
              {pct != null ? ` · ${pct}%` : ""}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px] leading-5">{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
