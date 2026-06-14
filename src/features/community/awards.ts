/**
 * Community awards / achievement badges (rank-20) — a pure, DOM-free, data-driven
 * registry of EARNED, hard-to-fake achievements derived from the SAME signal
 * bundle the reputation engine (rank-16) already collects.
 *
 * ── What this IS ──
 * A curated set of discrete, honest achievement badges that celebrate genuine
 * COMMUNITY PARTICIPATION: how long you've been around, posts and comments that
 * earned real engagement FROM OTHER PEOPLE, the people who follow you, and how
 * consistently you show up. Each badge has a one-line criteria description so a
 * member always knows exactly how it was (or could be) earned.
 *
 * ── What this is NOT ──
 * NOT a measure of trading skill, returns, P&L, or any "track record" of trades.
 * There are deliberately NO badges for profit, win-rate, or returns — those would
 * be misleading and out of scope. Every badge reflects participation/credibility
 * in the community ONLY, and the copy on every surface keeps that framing honest.
 *
 * ── Anti-gaming (the whole point) ──
 * Badges must be HARD to fake. The guards, all enforced here:
 *   1. A BANNED or QUALITY-FLAGGED member earns NOTHING positive (and any badges
 *      they'd otherwise hold are suppressed) — `evaluateAwards` returns [] for a
 *      sanctioned account. A bad actor can never display achievement badges.
 *   2. Engagement badges count engagement FROM OTHERS only. Self-reactions /
 *      self-bookmarks / self-comment-likes are already excluded by the server
 *      when it fills `ReputationSignals`, and the per-reactor cap (reused from
 *      rank-16) means one enthusiastic / sock-puppet fan can't unlock a badge —
 *      it takes MANY distinct reactors.
 *   3. No badge is earned from self-generated VOLUME alone. Posting 100 times
 *      with zero reception unlocks nothing — the contribution badges require
 *      genuine engagement (capped reactions from distinct others) alongside the
 *      volume, never volume on its own.
 *   4. DELETED / FLAGGED content is excluded upstream (the server only counts
 *      live, unflagged posts toward these signals), so spamming flagged content
 *      cannot help.
 *
 * Each badge exposes a PURE `earned(signals): boolean` predicate over the shared
 * `ReputationSignals`, so the catalogue is fully deterministic and unit-testable:
 * same signals in → same earned set out, every time. The server evaluates the set
 * inside the existing 6h reputation refresh (one aggregation pass, no extra cron)
 * and denormalizes the earned badge-ids onto `profiles.awards`.
 *
 * This module never imports React, the DB, or any other feature module.
 */

import { cappedReactionUnits, type ReputationSignals } from "./reputation";

/* ── Tiers / rarity ─────────────────────────────────────────────────────────── */

/**
 * A badge's rarity tier, lowest → highest. Drives the chip colour and conveys how
 * much sustained, genuine participation a badge represents. Descriptive of effort
 * only — never of trading skill.
 */
export const AWARD_TIERS = ["bronze", "silver", "gold"] as const;
export type AwardTier = (typeof AWARD_TIERS)[number];

/** Tailwind text-color token per tier (semantic palette only, no raw hex). */
export const AWARD_TIER_COLOR: Record<AwardTier, string> = {
  bronze: "text-amber-600",
  silver: "text-slate-400",
  gold: "text-amber-500",
};

/** Sort weight so higher-rarity badges render first. */
const TIER_RANK: Record<AwardTier, number> = { gold: 3, silver: 2, bronze: 1 };

/* ── Badge definition ───────────────────────────────────────────────────────── */

/**
 * One badge in the catalogue. `earned` is a PURE predicate over the shared
 * reputation signal bundle — the single source of truth for whether a member
 * holds the badge.
 */
export interface AwardBadge {
  /** Stable id — persisted in `profiles.awards`; never change once shipped. */
  id: AwardId;
  /** Short, plain label shown on the chip and Achievements list. */
  label: string;
  /** One honest line describing exactly how the badge is earned. */
  criteria: string;
  /** lucide-react icon name (resolved to a component in the UI). NO emoji. */
  icon: AwardIconName;
  /** Rarity tier — drives colour + ordering. */
  tier: AwardTier;
  /**
   * Pure earned-predicate. Receives the SAME `ReputationSignals` the reputation
   * engine collects; returns true iff this member has earned the badge. MUST be
   * monotonic-ish and free of side effects — same input → same output.
   *
   * Note: the per-account ANTI-GAMING gate (banned / quality-flagged → no badges)
   * lives in `evaluateAwards`, NOT in each predicate, so the predicates stay
   * simple and the gate is enforced in exactly one place.
   */
  earned: (signals: ReputationSignals) => boolean;
}

/** lucide icon names used by the catalogue (kept explicit so the UI can map them). */
export type AwardIconName =
  | "CalendarCheck"
  | "CalendarClock"
  | "PenLine"
  | "MessagesSquare"
  | "Heart"
  | "Sparkles"
  | "Bookmark"
  | "Users"
  | "Flame"
  | "HandHeart";

/** The fixed set of award ids. Persisted verbatim — additive only, never rename. */
export type AwardId =
  | "first-post"
  | "six-months"
  | "one-year"
  | "wordsmith"
  | "conversationalist"
  | "well-received"
  | "crowd-favourite"
  | "saved-for-later"
  | "community-pillar"
  | "consistent"
  | "helpful-voice";

/* ── Earned thresholds (documented constants — no magic numbers inline) ───────── */

/** Tenure (days) for the half-year and full-year tenure badges. */
export const SIX_MONTHS_DAYS = 182;
export const ONE_YEAR_DAYS = 365;

/**
 * Posts needed for the "Wordsmith" contribution badge — but ONLY alongside
 * genuine reception (see `MIN_RECEIVED_FOR_CONTRIBUTION`). Volume alone earns
 * nothing.
 */
export const WORDSMITH_POSTS = 10;
/** Comments needed for the "Conversationalist" badge (taking part in threads). */
export const CONVERSATIONALIST_COMMENTS = 25;

/**
 * The minimum capped reaction UNITS from DISTINCT others a contribution badge
 * requires, so a 100-post spammer with no reception unlocks nothing. Because the
 * per-reactor cap (rank-16) is 3, this can't be met by a single fan — it needs
 * engagement spread across multiple genuine reactors.
 */
export const MIN_RECEIVED_FOR_CONTRIBUTION = 3;

/** Capped reaction units from others for the engagement badges. */
export const WELL_RECEIVED_REACTIONS = 10;
export const CROWD_FAVOURITE_REACTIONS = 40;
/** Bookmarks from others for the "Saved for later" badge (a strong save signal). */
export const SAVED_BOOKMARKS = 10;
/** Distinct followers for the "Community pillar" badge. */
export const COMMUNITY_PILLAR_FOLLOWERS = 25;
/** Distinct active weeks for the "Consistent" badge (shows up week after week). */
export const CONSISTENT_WEEKS = 8;
/** Comment-likes from others for the "Helpful voice" badge. */
export const HELPFUL_VOICE_SIGNALS = 5;

/**
 * Capped reaction units from DISTINCT others — the engagement currency every
 * reception/contribution badge spends. Reusing rank-16's `cappedReactionUnits`
 * (and its per-reactor cap) is what makes a single spammy fan unable to unlock a
 * badge: the same aggregation, the same anti-sock-puppet guard, one source of
 * truth. Self-reactions are already excluded by the server; we pass no `selfId`
 * here because the predicate operates on the already-cleaned bundle.
 */
function receivedReactionUnits(signals: ReputationSignals): number {
  return cappedReactionUnits(signals.reactionsFromOthers);
}

/* ── The catalogue ──────────────────────────────────────────────────────────── */

/**
 * The curated badge catalogue, ordered hardest/rarest → easiest for stable
 * iteration. Each `earned` predicate is pure and reads ONLY the shared signals.
 * Anti-gaming for sanctioned accounts is applied once, in `evaluateAwards`.
 */
export const AWARD_BADGES: readonly AwardBadge[] = [
  /* ── Tenure (genuinely un-gameable — time only) ── */
  {
    id: "one-year",
    label: "One Year",
    criteria: "A member of the community for over a year.",
    icon: "CalendarCheck",
    tier: "gold",
    earned: (s) => s.tenureDays >= ONE_YEAR_DAYS,
  },
  {
    id: "six-months",
    label: "Six Months",
    criteria: "A member of the community for over six months.",
    icon: "CalendarClock",
    tier: "silver",
    earned: (s) => s.tenureDays >= SIX_MONTHS_DAYS,
  },

  /* ── Genuine reach / reception (engagement FROM OTHERS, per-reactor capped) ── */
  {
    id: "crowd-favourite",
    label: "Crowd Favourite",
    criteria: "Posts earned reactions from many different members.",
    icon: "Sparkles",
    tier: "gold",
    earned: (s) => receivedReactionUnits(s) >= CROWD_FAVOURITE_REACTIONS,
  },
  {
    id: "community-pillar",
    label: "Community Pillar",
    criteria: `Followed by ${COMMUNITY_PILLAR_FOLLOWERS}+ members of the community.`,
    icon: "Users",
    tier: "gold",
    earned: (s) => s.followers >= COMMUNITY_PILLAR_FOLLOWERS,
  },
  {
    id: "well-received",
    label: "Well Received",
    criteria: "Posts earned genuine reactions from other members.",
    icon: "Heart",
    tier: "silver",
    earned: (s) => receivedReactionUnits(s) >= WELL_RECEIVED_REACTIONS,
  },
  {
    id: "saved-for-later",
    label: "Worth Saving",
    criteria: `Other members bookmarked your posts ${SAVED_BOOKMARKS}+ times.`,
    icon: "Bookmark",
    tier: "silver",
    earned: (s) => s.bookmarksFromOthers >= SAVED_BOOKMARKS,
  },
  {
    id: "helpful-voice",
    label: "Helpful Voice",
    criteria: "Your comments earned reactions from other members.",
    icon: "HandHeart",
    tier: "silver",
    earned: (s) => s.helpfulCommentSignals >= HELPFUL_VOICE_SIGNALS,
  },

  /* ── Consistency ── */
  {
    id: "consistent",
    label: "Consistent",
    criteria: `Active in the community across ${CONSISTENT_WEEKS}+ different weeks.`,
    icon: "Flame",
    tier: "silver",
    earned: (s) => s.activeWeeks >= CONSISTENT_WEEKS,
  },

  /* ── Contribution (volume + genuine reception — never volume alone) ── */
  {
    id: "wordsmith",
    label: "Wordsmith",
    criteria: `Shared ${WORDSMITH_POSTS}+ posts that resonated with others.`,
    icon: "PenLine",
    tier: "bronze",
    // Volume AND genuine reception — a spammer with no engagement never qualifies.
    earned: (s) =>
      s.posts >= WORDSMITH_POSTS && receivedReactionUnits(s) >= MIN_RECEIVED_FOR_CONTRIBUTION,
  },
  {
    id: "conversationalist",
    label: "Conversationalist",
    criteria: `Wrote ${CONVERSATIONALIST_COMMENTS}+ comments and joined the discussion.`,
    icon: "MessagesSquare",
    tier: "bronze",
    // Comment volume AND some helpful reception — empty spam comments earn nothing.
    earned: (s) =>
      s.comments >= CONVERSATIONALIST_COMMENTS &&
      s.helpfulCommentSignals >= MIN_RECEIVED_FOR_CONTRIBUTION,
  },

  /* ── Getting started (the gentlest milestone — still needs reception) ── */
  {
    id: "first-post",
    label: "First Steps",
    criteria: "Shared a post and got a reaction from another member.",
    icon: "Sparkles",
    tier: "bronze",
    // Even the entry badge needs reception so a single throwaway post + a self-like
    // (already stripped) can't unlock it; one genuine reaction from another member.
    earned: (s) => s.posts >= 1 && receivedReactionUnits(s) >= 1,
  },
] as const;

/** Fast lookup by id. */
const BADGE_BY_ID: Record<AwardId, AwardBadge> = Object.fromEntries(
  AWARD_BADGES.map((b) => [b.id, b])
) as Record<AwardId, AwardBadge>;

/* ── Evaluation ─────────────────────────────────────────────────────────────── */

/**
 * Evaluates the full earned badge-id set for a member from their reputation
 * signals. THE single anti-gaming gate for sanctioned accounts lives here:
 *
 *   - A BANNED member earns NOTHING (returns []), so a sanctioned account can
 *     never display achievement badges.
 *   - A member currently carrying ANY moderation quality flag earns NOTHING —
 *     flagged content disqualifies positive achievements until it's cleared.
 *
 * Otherwise the result is the ids of every catalogue badge whose pure `earned`
 * predicate is satisfied, in catalogue (rarity) order. Deterministic + pure.
 */
export function evaluateAwards(signals: ReputationSignals): AwardId[] {
  // Hard gate: a sanctioned / flagged account earns no positive badges.
  if (signals.banned) return [];
  if (signals.qualityFlags > 0) return [];
  return AWARD_BADGES.filter((b) => b.earned(signals)).map((b) => b.id);
}

/** Validates/normalizes a stored awards array back to known ids (drops unknowns). */
export function normalizeAwards(value: unknown): AwardId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<AwardId>();
  for (const v of value) {
    if (typeof v === "string" && v in BADGE_BY_ID) seen.add(v as AwardId);
  }
  // Preserve catalogue (rarity) order for stable rendering.
  return AWARD_BADGES.filter((b) => seen.has(b.id)).map((b) => b.id);
}

/** Parses the denormalized `profiles.awards` JSON column into a known id set. */
export function parseStoredAwards(raw: string | null | undefined): AwardId[] {
  if (!raw) return [];
  try {
    return normalizeAwards(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Serializes an earned id set to the compact JSON stored on the profile row. */
export function serializeAwards(ids: AwardId[]): string {
  return JSON.stringify(normalizeAwards(ids));
}

/** Metadata for a single badge id (label/criteria/icon/tier) — for the UI. */
export function awardMeta(id: AwardId): AwardBadge {
  return BADGE_BY_ID[id];
}

/** True iff the id is a known catalogue badge. */
export function isKnownAward(id: string): id is AwardId {
  return id in BADGE_BY_ID;
}

/**
 * Splits the catalogue into the member's EARNED badges and a few notable UNEARNED
 * ones (for the motivational "how to earn" list on the profile). Earned badges
 * come first (rarity order); unearned are the rarest still-attainable ones,
 * limited to `unearnedLimit`. Pure — derives entirely from the earned id set.
 */
export function splitAwards(
  earnedIds: AwardId[],
  unearnedLimit = 4
): { earned: AwardBadge[]; unearned: AwardBadge[] } {
  const earnedSet = new Set(earnedIds);
  const earned = AWARD_BADGES.filter((b) => earnedSet.has(b.id)).slice();
  const unearned = AWARD_BADGES.filter((b) => !earnedSet.has(b.id))
    // Show the most aspirational (highest tier) first among the unearned.
    .slice()
    .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier])
    .slice(0, unearnedLimit);
  return { earned, unearned };
}

/**
 * Picks ONE small "featured" badge to show near an author chip in the feed — the
 * member's single rarest earned badge — or null when they hold none. Kept subtle
 * (one badge max) so the feed never clutters. Deterministic.
 */
export function featuredAward(earnedIds: AwardId[]): AwardBadge | null {
  const earned = AWARD_BADGES.filter((b) => earnedIds.includes(b.id));
  if (earned.length === 0) return null;
  // Catalogue is rarity-ordered, but be explicit so re-ordering the array can't
  // silently change which badge is featured.
  return earned.reduce((best, b) => (TIER_RANK[b.tier] > TIER_RANK[best.tier] ? b : best));
}
