/**
 * Community reputation / standing — a pure, DOM-free, well-documented credibility
 * signal derived ONLY from EARNED, hard-to-fake activity already in the schema.
 *
 * ── What this IS ──
 * A transparent measure of a member's PARTICIPATION and STANDING in the
 * community: how long they've been around, whether their posts earned genuine
 * reactions/bookmarks FROM OTHER PEOPLE, whether their comments drew engagement,
 * how many people follow them (with diminishing returns), and how consistently
 * they show up — MINUS penalties for moderation flags and bans.
 *
 * ── What this is NOT ──
 * It is NOT a measure of trading skill, returns, P&L, or any "track record" of
 * trades. We never claim a member is a good or bad trader. The tier names are
 * deliberately descriptive of COMMUNITY participation (New / Contributing /
 * Established / Trusted), never evaluative of investment performance. Copy on
 * every surface must keep that framing honest.
 *
 * ── Anti-gaming (the whole point) ──
 * Reputation must be HARD to inflate. The guards, all enforced in this module:
 *   1. SELF-reactions never count. A user reacting to / bookmarking their own
 *      posts contributes nothing (the server excludes them; the model also
 *      defends in depth by capping per-reactor contribution).
 *   2. PER-AUTHOR CAP on reaction contribution: one enthusiastic (or sock-puppet)
 *      fan can only push a member's "reactions received" up to a small cap, so
 *      buying / botting a single account's reactions can't snowball a score.
 *   3. DIMINISHING RETURNS everywhere: every count is passed through a concave
 *      curve (log/sqrt-shaped). The 1000th follower / reaction adds far less than
 *      the 1st. The score is BOUNDED at 100, so there is a hard ceiling no amount
 *      of volume can exceed.
 *   4. DELETED / FLAGGED content is excluded upstream (the server only counts
 *      live, unflagged posts), so spamming flagged posts cannot help.
 *   5. PENALTIES: quality flags, moderation actions, and a ban each subtract,
 *      and a ban floors the score so a sanctioned account can't look "Trusted".
 *
 * The model is a PURE function: same signals in → same score + tier + breakdown
 * out, every time. The server fills `ReputationSignals` from existing tables; the
 * profile/post UI renders the tier chip and the "why this tier" breakdown.
 *
 * This module never imports React, the DB, or any other feature module.
 */

/* ── Tiers ───────────────────────────────────────────────────────────────────── */

/**
 * Discrete standing levels, lowest → highest. Descriptive of COMMUNITY
 * participation only — never of trading skill or returns.
 */
export const REPUTATION_TIERS = ["new", "contributing", "established", "trusted"] as const;
export type ReputationTier = (typeof REPUTATION_TIERS)[number];

export interface ReputationTierMeta {
  tier: ReputationTier;
  /** Short, plain label shown on the chip and profile. */
  label: string;
  /** One-line, honest description (participation/credibility — not skill). */
  blurb: string;
  /** lucide-react icon name (resolved to a component in the UI). NO emoji. */
  icon: "Sprout" | "Leaf" | "ShieldCheck" | "Award";
  /** Tailwind text-color class for the chip's icon/label. Semantic tokens only. */
  colorClass: string;
  /** Inclusive lower bound of the score band that maps to this tier (0–100). */
  minScore: number;
}

/**
 * Tier metadata + thresholds, in ascending order. The bands are intentionally
 * wide and conservative: reaching "Trusted" takes sustained, genuine, multi-
 * signal participation — not a single viral post.
 */
export const REPUTATION_TIER_META: Record<ReputationTier, ReputationTierMeta> = {
  new: {
    tier: "new",
    label: "New",
    blurb: "Just getting started in the community.",
    icon: "Sprout",
    colorClass: "text-muted",
    minScore: 0,
  },
  contributing: {
    tier: "contributing",
    label: "Contributing",
    blurb: "Actively posting and taking part in discussions.",
    icon: "Leaf",
    colorClass: "text-emerald-500",
    minScore: 25,
  },
  established: {
    tier: "established",
    label: "Established",
    blurb: "A consistent member whose posts resonate with others.",
    icon: "ShieldCheck",
    colorClass: "text-sky-500",
    minScore: 55,
  },
  trusted: {
    tier: "trusted",
    label: "Trusted",
    blurb: "A long-standing, widely-followed and engaged contributor.",
    icon: "Award",
    colorClass: "text-amber-500",
    minScore: 80,
  },
};

/** Ordered list (lowest → highest), handy for thresholds and rendering. */
export const REPUTATION_TIER_LIST: ReputationTierMeta[] = REPUTATION_TIERS.map(
  (t) => REPUTATION_TIER_META[t]
);

/* ── Signals (the raw, earned inputs) ───────────────────────────────────────── */

/**
 * A single reactor's contribution to a member's "reactions received" tally.
 * Counting per-reactor (not a raw total) is what lets us cap any ONE fan's
 * influence — see `REACTIONS_PER_REACTOR_CAP`.
 */
export interface ReactorTally {
  /** The reacting user's id. The member's OWN id must never appear here. */
  reactorId: string;
  /** How many of the member's (live, unflagged) posts this reactor reacted to. */
  count: number;
}

/**
 * Everything the score is computed from. Every field is an EARNED signal already
 * present in the platform schema. The server is responsible for excluding
 * self-reactions, deleted posts and flagged content BEFORE filling this — the
 * model then defends in depth (per-reactor cap, diminishing returns, penalties).
 */
export interface ReputationSignals {
  /** Account age in days (tenure). Clamped at 0. */
  tenureDays: number;
  /** Number of the member's LIVE, UNFLAGGED posts. */
  posts: number;
  /** Number of comments the member has written (their participation in threads). */
  comments: number;
  /**
   * Per-reactor reaction tallies on the member's posts, with SELF-reactions
   * already excluded by the server. Each reactor's contribution is capped so one
   * account can't inflate the score (anti-sock-puppet).
   */
  reactionsFromOthers: ReactorTally[];
  /**
   * Bookmarks of the member's posts BY OTHER users (self-bookmarks excluded). A
   * save is a stronger "this was useful" signal than a one-tap reaction.
   */
  bookmarksFromOthers: number;
  /**
   * Engagement the member's COMMENTS earned from others — e.g. likes on their
   * comments (self-likes excluded). A proxy for "helpful in discussion".
   */
  helpfulCommentSignals: number;
  /** Distinct followers (self-follow is impossible). Diminishing returns applied. */
  followers: number;
  /**
   * Number of distinct ISO weeks in which the member posted or commented —
   * rewards CONSISTENCY over a one-day burst. Clamped at 0.
   */
  activeWeeks: number;
  /**
   * Count of the member's posts currently carrying a moderation `quality_flag`
   * (rank-13 anti-tip/spam gate). Each is a small penalty.
   */
  qualityFlags: number;
  /**
   * Count of moderator actions taken against the member's content (rank-14
   * mod-queue: content deletions, etc.). Each is a penalty.
   */
  modActions: number;
  /** True when the account is currently suspended/banned (rank-14). Floors the score. */
  banned: boolean;
}

/** A zeroed signal set — a brand-new account with no activity. */
export const EMPTY_SIGNALS: ReputationSignals = {
  tenureDays: 0,
  posts: 0,
  comments: 0,
  reactionsFromOthers: [],
  bookmarksFromOthers: 0,
  helpfulCommentSignals: 0,
  followers: 0,
  activeWeeks: 0,
  qualityFlags: 0,
  modActions: 0,
  banned: false,
};

/* ── Weights & caps (documented constants — no ML, no magic) ────────────────── */

/** Max points from account tenure. Tops out at ~TENURE_DAYS_FOR_MAX days. */
export const W_TENURE = 14;
/** Days of tenure at which the tenure component is ~maxed (diminishing before). */
export const TENURE_DAYS_FOR_MAX = 365;

/** Max points from authoring (live, unflagged) posts. */
export const W_POSTS = 18;
/** Max points from writing comments (taking part in threads). */
export const W_COMMENTS = 8;

/**
 * Max points from reactions OTHERS gave the member's posts — the single biggest
 * earned component, but the hardest to fake (per-reactor capped + concave).
 */
export const W_REACTIONS = 26;
/** Max points from OTHERS bookmarking the member's posts (a strong save signal). */
export const W_BOOKMARKS = 8;
/** Max points from the member's comments earning engagement. */
export const W_HELPFUL = 8;

/** Max points from follower count (heavily diminishing — see below). */
export const W_FOLLOWERS = 12;
/** Max points from consistency (distinct active weeks). */
export const W_CONSISTENCY = 6;

/**
 * The MOST a single reactor can contribute to the reaction tally, no matter how
 * many of the member's posts they react to. The core anti-sock-puppet guard:
 * 1000 reactions from ONE account count the same as ~3. Genuine reach comes from
 * MANY distinct reactors, which this rewards.
 */
export const REACTIONS_PER_REACTOR_CAP = 3;

/** Penalty (points) per post currently carrying a moderation quality flag. */
export const PENALTY_PER_QUALITY_FLAG = 6;
/** Penalty (points) per moderator action against the member's content. */
export const PENALTY_PER_MOD_ACTION = 12;
/** A banned account is floored at this score (well inside the "New" band). */
export const BANNED_SCORE_CEILING = 5;

/** The score is always within [0, 100]. */
export const MAX_SCORE = 100;

/* ── Concave helpers (diminishing returns) ──────────────────────────────────── */

/**
 * Maps a non-negative count to a 0..1 fraction with DIMINISHING RETURNS via a
 * logarithmic curve: f(n) = ln(1+n) / ln(1+saturate), clamped to 1. The first
 * units move the needle a lot; later ones barely. At n === saturate the fraction
 * is exactly 1 (the component's weight is fully earned). Pure + monotonic non-
 * decreasing in n, so more is never worse — but it can never exceed 1.
 */
export function diminishing(n: number, saturate: number): number {
  const count = Math.max(0, n);
  if (saturate <= 0) return count > 0 ? 1 : 0;
  const frac = Math.log1p(count) / Math.log1p(saturate);
  return Math.min(1, frac);
}

/** Saturation points — the count at which each component is ~fully earned. */
export const SAT_POSTS = 40;
export const SAT_COMMENTS = 60;
export const SAT_REACTIONS = 80;
export const SAT_BOOKMARKS = 30;
export const SAT_HELPFUL = 40;
export const SAT_FOLLOWERS = 250;
export const SAT_ACTIVE_WEEKS = 26;

/**
 * Effective reaction units from per-reactor tallies, applying the per-reactor cap
 * so any ONE reactor contributes at most `REACTIONS_PER_REACTOR_CAP`. Self-
 * reactions should already be excluded by the server, but if the member's own id
 * slips in it's ignored here too (defense in depth) when `selfId` is provided.
 */
export function cappedReactionUnits(
  tallies: ReactorTally[],
  selfId?: string,
  perReactorCap = REACTIONS_PER_REACTOR_CAP
): number {
  let units = 0;
  for (const t of tallies) {
    if (selfId && t.reactorId === selfId) continue; // never count self
    units += Math.min(Math.max(0, t.count), perReactorCap);
  }
  return units;
}

/* ── The component breakdown ────────────────────────────────────────────────── */

/** One transparent line of the "why this tier" breakdown. */
export interface ReputationComponent {
  key:
    | "tenure"
    | "posts"
    | "comments"
    | "reactions"
    | "bookmarks"
    | "helpful"
    | "followers"
    | "consistency"
    | "penalties";
  /** Human label for the breakdown UI. */
  label: string;
  /** Points this component contributed (already weighted; penalties are negative). */
  points: number;
  /** The raw earned count behind it (for "12 reactions from others", etc.). */
  detail: number;
}

export interface ReputationResult {
  /** Bounded final score, 0..100, integer. */
  score: number;
  /** The tier the score maps to. */
  tier: ReputationTier;
  /** Per-component contributions (positive earns + the single penalties line). */
  components: ReputationComponent[];
  /** True when the account is currently banned (score floored). */
  banned: boolean;
}

/* ── The scorer ─────────────────────────────────────────────────────────────── */

/**
 * Computes a member's reputation from earned signals. Pure + deterministic.
 *
 * Earned points (each a weight × a diminishing fraction of its signal):
 *   tenure, posts, comments, reactions-from-others (per-reactor capped),
 *   bookmarks-from-others, helpful-comment engagement, followers, consistency.
 * Penalties subtract: quality flags + moderator actions. A ban floors the score
 * at `BANNED_SCORE_CEILING` regardless of earned points so a sanctioned account
 * can never display a high tier.
 *
 * The result is clamped to [0, 100] and rounded to an integer.
 */
export function computeReputation(signals: ReputationSignals, selfId?: string): ReputationResult {
  const s = sanitizeSignals(signals);

  const tenurePts = W_TENURE * diminishing(s.tenureDays, TENURE_DAYS_FOR_MAX);
  const postPts = W_POSTS * diminishing(s.posts, SAT_POSTS);
  const commentPts = W_COMMENTS * diminishing(s.comments, SAT_COMMENTS);

  const reactionUnits = cappedReactionUnits(s.reactionsFromOthers, selfId);
  const reactionPts = W_REACTIONS * diminishing(reactionUnits, SAT_REACTIONS);
  const bookmarkPts = W_BOOKMARKS * diminishing(s.bookmarksFromOthers, SAT_BOOKMARKS);
  const helpfulPts = W_HELPFUL * diminishing(s.helpfulCommentSignals, SAT_HELPFUL);

  const followerPts = W_FOLLOWERS * diminishing(s.followers, SAT_FOLLOWERS);
  const consistencyPts = W_CONSISTENCY * diminishing(s.activeWeeks, SAT_ACTIVE_WEEKS);

  const penalty = s.qualityFlags * PENALTY_PER_QUALITY_FLAG + s.modActions * PENALTY_PER_MOD_ACTION;

  const earned =
    tenurePts +
    postPts +
    commentPts +
    reactionPts +
    bookmarkPts +
    helpfulPts +
    followerPts +
    consistencyPts;

  let raw = earned - penalty;
  if (s.banned) raw = Math.min(raw, BANNED_SCORE_CEILING);

  const score = Math.round(clamp(raw, 0, MAX_SCORE));

  const components: ReputationComponent[] = [
    {
      key: "tenure",
      label: "Time in the community",
      points: round1(tenurePts),
      detail: s.tenureDays,
    },
    { key: "posts", label: "Posts shared", points: round1(postPts), detail: s.posts },
    { key: "comments", label: "Comments written", points: round1(commentPts), detail: s.comments },
    {
      key: "reactions",
      label: "Reactions from others",
      points: round1(reactionPts),
      detail: reactionUnits,
    },
    {
      key: "bookmarks",
      label: "Saves from others",
      points: round1(bookmarkPts),
      detail: s.bookmarksFromOthers,
    },
    {
      key: "helpful",
      label: "Helpful comments",
      points: round1(helpfulPts),
      detail: s.helpfulCommentSignals,
    },
    { key: "followers", label: "Followers", points: round1(followerPts), detail: s.followers },
    {
      key: "consistency",
      label: "Active weeks",
      points: round1(consistencyPts),
      detail: s.activeWeeks,
    },
  ];
  if (penalty > 0) {
    components.push({
      key: "penalties",
      label: "Moderation penalties",
      points: -round1(penalty),
      detail: s.qualityFlags + s.modActions,
    });
  }

  return { score, tier: tierForScore(score), components, banned: s.banned };
}

/** Maps a bounded score to its tier band (highest band whose minScore ≤ score). */
export function tierForScore(score: number): ReputationTier {
  let tier: ReputationTier = "new";
  for (const meta of REPUTATION_TIER_LIST) {
    if (score >= meta.minScore) tier = meta.tier;
  }
  return tier;
}

/** Metadata (label/icon/color/blurb) for a tier — handy for the chip + breakdown. */
export function tierMeta(tier: ReputationTier): ReputationTierMeta {
  return REPUTATION_TIER_META[tier];
}

/** Validates/normalizes a stored tier string back to a known tier (defaults "new"). */
export function normalizeTier(value: string | null | undefined): ReputationTier {
  return REPUTATION_TIERS.includes(value as ReputationTier) ? (value as ReputationTier) : "new";
}

/* ── Internals ──────────────────────────────────────────────────────────────── */

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

/** One-decimal rounding for breakdown display (keeps the math honest, the UI tidy). */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Defensive clamping so a garbled/negative signal can never corrupt the score. */
function sanitizeSignals(s: ReputationSignals): ReputationSignals {
  const nn = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  return {
    tenureDays: nn(s.tenureDays),
    posts: nn(s.posts),
    comments: nn(s.comments),
    reactionsFromOthers: Array.isArray(s.reactionsFromOthers)
      ? s.reactionsFromOthers
          .filter((t) => t && typeof t.reactorId === "string")
          .map((t) => ({ reactorId: t.reactorId, count: nn(t.count) }))
      : [],
    bookmarksFromOthers: nn(s.bookmarksFromOthers),
    helpfulCommentSignals: nn(s.helpfulCommentSignals),
    followers: nn(s.followers),
    activeWeeks: nn(s.activeWeeks),
    qualityFlags: nn(s.qualityFlags),
    modActions: nn(s.modActions),
    banned: Boolean(s.banned),
  };
}
