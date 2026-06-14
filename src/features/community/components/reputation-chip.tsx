"use client";

import * as React from "react";
import { Award, Leaf, ShieldCheck, Sprout } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { tierMeta, type ReputationTier } from "../reputation";

/** lucide icon component for each tier's `icon` name. No emoji. */
const TIER_ICON = { Sprout, Leaf, ShieldCheck, Award } as const;

/**
 * A small, subtle reputation-tier chip shown next to an author's name on posts.
 *
 * It signals COMMUNITY STANDING (participation/credibility) — never trading
 * skill or P&L. A tooltip spells that out honestly. The chip is intentionally
 * quiet (a lucide icon + a short label that hides on the smallest phones) so it
 * never shouts over the content. Renders nothing for the lowest "New" tier on
 * the author row so brand-new accounts aren't visually penalised.
 */
export function ReputationChip({
  tier,
  showNew = false,
  className,
}: {
  tier: ReputationTier | undefined | null;
  /** When true, also renders the "New" tier (used on the profile, not on chips). */
  showNew?: boolean;
  className?: string;
}) {
  if (!tier) return null;
  if (tier === "new" && !showNew) return null;
  const meta = tierMeta(tier);
  const Icon = TIER_ICON[meta.icon];
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-reputation-tier={tier}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2/70 px-1.5 py-0.5 text-[10px] font-medium leading-none",
              meta.colorClass,
              className
            )}
          >
            <Icon className="h-3 w-3" aria-hidden />
            <span className="hidden xs:inline">{meta.label}</span>
            <span className="sr-only">
              Community standing: {meta.label}. Reflects participation, not trading skill.
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[220px] text-center">
          <span className="font-medium">{meta.label} member</span>
          <br />
          {meta.blurb} This reflects community participation — not trading skill or returns.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
