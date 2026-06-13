"use client";

import * as React from "react";
import { Award, ChevronDown, Info, Leaf, ShieldCheck, Sprout } from "lucide-react";
import { cn } from "@/lib/utils";
import { tierMeta } from "../reputation";
import type { ProfileReputation } from "../types";

const TIER_ICON = { Sprout, Leaf, ShieldCheck, Award } as const;

/**
 * The reputation panel on a profile: the member's COMMUNITY STANDING tier plus a
 * transparent, expandable "why this tier" breakdown of the earned signals.
 *
 * Framing is deliberately honest — this is participation/credibility in the
 * community, NOT a measure of trading skill, returns or any verified track
 * record of trades. The copy says so plainly. All inputs are earned and the
 * formula is documented (see features/community/reputation.ts).
 */
export function ReputationBreakdown({ reputation }: { reputation: ProfileReputation }) {
  const [open, setOpen] = React.useState(false);
  const meta = tierMeta(reputation.tier);
  const Icon = TIER_ICON[meta.icon];
  // Only positive earned signals are worth listing; the penalties line (if any)
  // is shown too so the breakdown is honest both ways.
  const lines = reputation.components.filter((c) => c.points !== 0 || c.detail > 0);

  return (
    <section
      data-reputation-panel
      aria-label="Community standing"
      className="mt-3 rounded-xl border bg-surface p-4"
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2/70",
            meta.colorClass
          )}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
            <span data-reputation-tier={reputation.tier} className={meta.colorClass}>
              {reputation.tierLabel}
            </span>
            <span className="font-normal text-muted">member</span>
          </p>
          <p className="text-xs text-muted">{meta.blurb}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Hide standing breakdown" : "Show standing breakdown"}
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          Why?
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-1.5 border-t pt-3" data-reputation-detail>
          <ul className="space-y-1.5">
            {lines.map((c) => (
              <li
                key={c.key}
                className="flex items-center justify-between gap-3 text-xs"
                data-component={c.key}
              >
                <span className="text-muted">
                  {c.label}
                  {c.key !== "tenure" && (
                    <span className="ml-1.5 font-money text-foreground/70">{c.detail}</span>
                  )}
                </span>
                <span
                  className={cn(
                    "font-money font-medium tabular-nums",
                    c.points < 0 ? "text-loss" : "text-foreground"
                  )}
                >
                  {c.points > 0 ? "+" : ""}
                  {c.points}
                </span>
              </li>
            ))}
          </ul>
          <p className="flex items-start gap-1.5 pt-1 text-[11px] leading-4 text-muted">
            <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            Standing reflects community participation and credibility — how long you&apos;ve been
            here, the posts and comments you share, and genuine engagement from other members. It is{" "}
            <strong>not</strong> a measure of trading skill, returns, or any track record of trades.
          </p>
        </div>
      )}
    </section>
  );
}
