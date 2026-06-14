"use client";

import * as React from "react";
import {
  Bookmark,
  CalendarCheck,
  CalendarClock,
  Flame,
  HandHeart,
  Heart,
  Lock,
  MessagesSquare,
  PenLine,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AWARD_TIER_COLOR,
  awardMeta,
  featuredAward,
  splitAwards,
  type AwardIconName,
  type AwardId,
} from "../awards";

/** lucide icon component for each catalogue icon name. No emoji. */
const AWARD_ICON: Record<AwardIconName, React.ComponentType<{ className?: string }>> = {
  CalendarCheck,
  CalendarClock,
  PenLine,
  MessagesSquare,
  Heart,
  Sparkles,
  Bookmark,
  Users,
  Flame,
  HandHeart,
};

/* ── Profile header badges row ─────────────────────────────────────────────────
 * A compact, scannable row of the member's EARNED achievement badges (icon +
 * tooltip with label + the honest one-line criteria). Renders nothing when the
 * member holds none, so brand-new / sanctioned accounts show no row at all.
 */
export function AwardBadgesRow({
  awards,
  className,
}: {
  awards: AwardId[] | undefined | null;
  className?: string;
}) {
  if (!awards || awards.length === 0) return null;
  return (
    <TooltipProvider delayDuration={150}>
      <ul
        data-award-badges
        aria-label="Achievement badges"
        className={cn("mt-2 flex flex-wrap items-center gap-1.5", className)}
      >
        {awards.map((id) => {
          const meta = awardMeta(id);
          const Icon = AWARD_ICON[meta.icon];
          return (
            <li key={id}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    data-award={id}
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full bg-surface-2/70 ring-1 ring-inset ring-border",
                      AWARD_TIER_COLOR[meta.tier]
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    <span className="sr-only">
                      {meta.label} — {meta.criteria}
                    </span>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-[220px] text-center">
                  <span className="font-medium">{meta.label}</span>
                  <br />
                  {meta.criteria}
                </TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </TooltipProvider>
  );
}

/* ── Achievements section (earned + a few notable unearned) ────────────────────
 * The full Achievements panel on a profile: every EARNED badge (icon + label +
 * criteria) followed by a few notable UNEARNED ones, greyed with a "how to earn"
 * line — motivational but honest. Always honest framing: participation only.
 */
export function AchievementsSection({ awards }: { awards: AwardId[] }) {
  const { earned, unearned } = splitAwards(awards);

  return (
    <section
      data-achievements
      aria-label="Achievements"
      className="mt-3 rounded-xl border bg-surface p-4"
    >
      <div className="flex items-center gap-2">
        <Trophy className="h-4 w-4 text-amber-500" aria-hidden />
        <h2 className="text-sm font-semibold">Achievements</h2>
        <span className="ml-auto font-money text-xs text-muted" data-earned-count>
          {earned.length} earned
        </span>
      </div>

      {earned.length === 0 ? (
        <p className="mt-3 text-xs text-muted">
          No badges yet — take part in the community to earn your first.
        </p>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {earned.map((b) => {
            const Icon = AWARD_ICON[b.icon];
            return (
              <li
                key={b.id}
                data-award-earned={b.id}
                className="flex items-start gap-2.5 rounded-lg border bg-surface-2/40 p-2.5"
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface ring-1 ring-inset ring-border",
                    AWARD_TIER_COLOR[b.tier]
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium leading-tight">{b.label}</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-muted">{b.criteria}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {unearned.length > 0 && (
        <>
          <p className="mt-4 text-[11px] font-medium uppercase tracking-wide text-muted">
            How to earn more
          </p>
          <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2" data-unearned>
            {unearned.map((b) => {
              const Icon = AWARD_ICON[b.icon];
              return (
                <li
                  key={b.id}
                  data-award-unearned={b.id}
                  className="flex items-start gap-2.5 rounded-lg border border-dashed p-2.5 opacity-70"
                >
                  <span className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2/60 text-muted">
                    <Icon className="h-4 w-4" aria-hidden />
                    <Lock
                      className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-surface p-[1px] text-muted"
                      aria-hidden
                    />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium leading-tight text-muted">{b.label}</p>
                    <p className="mt-0.5 text-[11px] leading-4 text-muted">{b.criteria}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <p className="mt-3 text-[11px] leading-4 text-muted">
        Badges reflect your participation and standing in the community — never trading skill,
        returns, or any track record of trades.
      </p>
    </section>
  );
}

/* ── Author-chip featured badge ────────────────────────────────────────────────
 * One tiny, subtle featured badge (the member's rarest) next to the author name
 * in the feed. Deliberately quiet — a single lucide icon with a tooltip, hidden
 * entirely when the member holds no badges so the feed never clutters.
 */
export function FeaturedAwardChip({
  awards,
  className,
}: {
  awards: AwardId[] | undefined | null;
  className?: string;
}) {
  if (!awards || awards.length === 0) return null;
  const badge = featuredAward(awards);
  if (!badge) return null;
  const Icon = AWARD_ICON[badge.icon];
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-featured-award={badge.id}
            className={cn(
              "inline-flex shrink-0 items-center justify-center",
              AWARD_TIER_COLOR[badge.tier],
              className
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">Achievement: {badge.label}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[220px] text-center">
          <span className="font-medium">{badge.label}</span>
          <br />
          {badge.criteria}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
