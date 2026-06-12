import { Award, Flame, Medal, Trophy, type LucideIcon } from "lucide-react";

/**
 * LeetCode-style milestone badges, earned permanently from the BEST streak.
 * Tier colors are Tailwind classes so badges render consistently everywhere
 * (streak popover, community profiles, leaderboard).
 */
export interface StreakBadgeDef {
  days: number;
  name: string;
  icon: LucideIcon;
  /** Icon + ring color classes. */
  color: string;
  bg: string;
}

export const STREAK_BADGES: StreakBadgeDef[] = [
  { days: 7, name: "Week Warrior", icon: Flame, color: "text-amber-600", bg: "bg-amber-600/15" },
  { days: 30, name: "Iron Month", icon: Medal, color: "text-slate-300", bg: "bg-slate-400/15" },
  {
    days: 100,
    name: "Century Club",
    icon: Award,
    color: "text-yellow-400",
    bg: "bg-yellow-400/15",
  },
  { days: 365, name: "Year of Discipline", icon: Trophy, color: "text-accent", bg: "bg-accent/15" },
];

export function badgesFor(bestStreak: number): StreakBadgeDef[] {
  return STREAK_BADGES.filter((b) => bestStreak >= b.days);
}

export function topBadge(bestStreak: number): StreakBadgeDef | null {
  const earned = badgesFor(bestStreak);
  return earned[earned.length - 1] ?? null;
}

export function nextBadge(bestStreak: number): { badge: StreakBadgeDef; daysLeft: number } | null {
  const next = STREAK_BADGES.find((b) => bestStreak < b.days);
  return next ? { badge: next, daysLeft: next.days - bestStreak } : null;
}
